import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, getAuth, GoogleAuthProvider,
  onIdTokenChanged, setPersistence, signInWithPopup,
  signOut as firebaseSignOut, type Auth, type User as FirebaseUser,
} from "firebase/auth";

export const apiUrl = (import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "/api")).replace(/\/$/, "");
export type AuthUser = { id: string; email: string; name: string | null; role: string };
type FirebaseConfig = { apiKey: string; authDomain: string; projectId: string; appId: string };

async function publicQuery<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${apiUrl}/${path}`, {
    cache: "no-store", credentials: "omit",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  if (!response.ok || body.error || !body.result) throw new Error(body.error?.message ?? "Unable to connect to authentication.");
  return body.result.data as T;
}

let initialization: Promise<Auth | null> | undefined;
export function initializeAuth(): Promise<Auth | null> {
  return initialization ??= (async () => {
    const config = await publicQuery<FirebaseConfig>("auth.config");
    if (!config || ![config.apiKey, config.authDomain, config.projectId, config.appId].every((value) => typeof value === "string" && value.trim())) return null;
    const auth = getAuth(initializeApp(config, "scanner-auth"));
    await setPersistence(auth, browserLocalPersistence);
    await auth.authStateReady();
    return auth;
  })();
}

/** Firebase refreshes expiring ID tokens; credentials are never stored in application URLs. */
export async function getAuthToken(): Promise<string | undefined> {
  const auth = await initializeAuth();
  return auth?.currentUser?.getIdToken();
}

export async function observeAuth(callback: (user: FirebaseUser | null) => void, onError: (error: Error) => void) {
  const auth = await initializeAuth();
  if (!auth) {
    onError(new Error("Google sign-in is not configured."));
    callback(null);
    return () => {};
  }
  // Includes automatic refreshes, storage events from other tabs, and logout.
  return onIdTokenChanged(auth, callback, onError);
}

export async function signIn() {
  const auth = await initializeAuth();
  if (!auth) throw new Error("Google sign-in is not configured.");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "auth/popup-blocked") throw new Error("Allow pop-ups for this site, then try again.");
    if (code === "auth/operation-not-supported-in-this-environment") throw new Error("Open this site in a regular browser window.");
    throw error;
  }
}

export async function signOut() {
  const auth = await initializeAuth();
  if (auth) await firebaseSignOut(auth);
}

export async function resolveAuthUser(user: FirebaseUser): Promise<AuthUser> {
  const result = await publicQuery<{ user: AuthUser | null; configured: boolean }>("auth.me", await user.getIdToken());
  if (!result.configured || !result.user) throw new Error("Sign-in failed. Try again.");
  return result.user;
}
