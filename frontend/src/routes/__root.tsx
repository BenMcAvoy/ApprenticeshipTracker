import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/components/auth-provider";
import { SignInLanding } from "@/components/sign-in-landing";

const titles: Record<string, string> = { "/": "Home", "/applications": "Applications", "/settings": "Settings" };

function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();

  if (loading) return <div role="status" className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <SignInLanding />;

  return (
    <TooltipProvider>
      <SidebarProvider key={user.id}>
        <AppSidebar />
        <SidebarInset className="h-dvh min-w-0 overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
            <SidebarTrigger className="size-11 md:size-7" />
            <h1 className="hidden text-sm font-medium md:block">{titles[pathname] ?? ""}</h1>
            <div id="header-actions" className="ml-auto flex min-w-0 items-center gap-2" />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <main className="mx-auto w-full min-w-0 max-w-5xl p-3 sm:p-4 lg:p-6">
              <Outlet />
            </main>
          </div>
          {/* Docked bottom panel slot (VS Code-style), filled via portal by pages. */}
          <div id="bottom-panel" />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export const Route = createRootRoute({ component: Layout });
