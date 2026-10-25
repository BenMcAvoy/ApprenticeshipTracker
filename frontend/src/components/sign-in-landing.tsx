import { Loader2, Radar } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SignInLanding() {
  const { signIn, error } = useAuth();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSignIn() {
    setPending(true);
    setFailure(null);
    try { await signIn(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "Could not sign in. Please try again."); }
    finally { setPending(false); }
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex h-16 items-center justify-between px-6">
        <span className="flex items-center gap-2 text-sm font-semibold"><Radar className="size-5" /> Apprentice Scanner</span>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 items-center px-6 pb-16">
        <Card className="w-full">
          <CardHeader className="gap-3">
            <CardTitle className="text-2xl leading-tight">Your next apprenticeship, in one place.</CardTitle>
            <CardDescription className="leading-relaxed">Explore degree apprenticeships, tailor applications with your CV, and keep track of the roles you've applied for.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button className="w-full" disabled={pending} onClick={() => void handleSignIn()}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? "Signing in…" : "Continue with Google"}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">Create an account or sign in with any verified Google email. Your CV, tailored applications and applied listings stay with your account across devices.</p>
            {(failure || error) && <p role="alert" className="text-sm text-destructive">{failure || error}</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
