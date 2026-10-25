import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { observeAuth, resolveAuthUser, signIn as googleSignIn, signOut as googleSignOut, type AuthUser } from "@/lib/auth";
import { closeAuthSubscriptions, queryClient } from "@/lib/trpc";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  error: string | null;
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const message = (error: unknown) => error instanceof Error ? error.message : "Authentication failed.";

function clearPrivateData() {
  closeAuthSubscriptions();
  void queryClient.cancelQueries();
  queryClient.clear();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef<string | null | undefined>(undefined);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void observeAuth((firebaseUser) => {
      if (!active) return;
      const version = ++revision.current;
      const changed = identity.current !== (firebaseUser?.uid ?? null);
      if (changed) {
        identity.current = firebaseUser?.uid ?? null;
        clearPrivateData();
        setUser(null);
        setLoading(Boolean(firebaseUser));
      }
      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      void resolveAuthUser(firebaseUser).then((resolved) => {
        if (!active || version !== revision.current) return;
        setUser(resolved);
        setError(null);
      }).catch((cause: unknown) => {
        if (!active || version !== revision.current) return;
        clearPrivateData();
        setUser(null);
        setError(message(cause));
      }).finally(() => {
        if (active && version === revision.current) setLoading(false);
      });
    }, (cause) => {
      if (!active) return;
      ++revision.current;
      clearPrivateData();
      setUser(null);
      setError(message(cause));
      setLoading(false);
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    }).catch((cause: unknown) => {
      if (active) {
        setError(message(cause));
        setLoading(false);
      }
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try { await googleSignIn(); }
    catch (cause) { setError(message(cause)); }
  }, []);

  const signOut = useCallback(async () => {
    ++revision.current;
    clearPrivateData();
    setUser(null);
    setLoading(true);
    setError(null);
    try { await googleSignOut(); }
    catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, []);

  const value = useMemo(() => ({ user, loading, isAdmin: user?.role === "ADMIN", signIn, signOut, error }), [user, loading, signIn, signOut, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
