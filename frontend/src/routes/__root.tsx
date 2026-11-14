import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/components/auth-provider";
import { SignInLanding } from "@/components/sign-in-landing";

function Layout() {
  const { user, loading } = useAuth();

  if (loading) return <div role="status" className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <SignInLanding />;

  return (
    <TooltipProvider>
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-3 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold" aria-label="Apprenticeship Tracker home">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><GraduationCap className="size-4" /></span>
            <span className="hidden sm:inline">Apprenticeship Tracker</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Main navigation">
            <Link to="/" className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" activeProps={{ className: "bg-muted text-foreground" }} activeOptions={{ exact: true }}>Find roles</Link>
            <Link to="/applications" className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" activeProps={{ className: "bg-muted text-foreground" }}>Applications</Link>
          </nav>
          <div id="header-actions" className="ml-auto flex min-w-0 items-center gap-2" />
          <AccountMenu />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <main className="w-full min-w-0 p-3 sm:p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: Layout });
