import { Loader2, Radar } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export function SignInLanding() {
  const { signIn, error } = useAuth();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSignIn() {
    setPending(true);
    setFailure(null);
    try { await signIn(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "Sign-in failed."); }
    finally { setPending(false); }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-6">
        <span className="flex items-center gap-2 text-sm font-semibold"><Radar className="size-4" /> Apprentice Scanner</span>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-24">
        <Button className="w-full max-w-xs" disabled={pending} onClick={() => void handleSignIn()}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "Signing in…" : "Sign in with Google"}
        </Button>
        {(failure || error) && <p role="alert" className="text-sm text-destructive">{failure || error}</p>}
      </main>
    </div>
  );
}
