import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Theme, useTheme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AccountMenu() {
  const { user, isAdmin, signOut, error } = useAuth();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!user) return null;

  async function handleSignOut() {
    setPending(true);
    setFailure(null);
    try { await signOut(); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : "Sign-out failed."); }
    finally { setPending(false); }
  }

  return (
    <div className="min-w-0">
      {(failure || error) && <span role="alert" className="mb-1 block truncate px-2 text-xs text-destructive" title={failure || error || undefined}>{failure || error}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton size="lg" tooltip={`${user.name || user.email} (${user.email})`} aria-label={`Account menu for ${user.name || user.email}`} />}>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><UserRound className="size-4" /></div>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left leading-tight">
            <span className="w-full truncate font-medium">{user.name || user.email}</span>
            <span className="w-full truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side={!isMobile && state === "collapsed" ? "right" : "top"} align="start" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block truncate text-sm text-foreground">{user.name || user.email}</span>
              <span className="block truncate">{user.email}</span>
              {isAdmin && <span className="mt-1 block">Administrator</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 md:min-h-8" render={<Link to="/settings" onClick={() => { if (isMobile) setOpenMobile(false); }} />}><Settings /> Settings</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><Sun /> Appearance</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
                    <Icon /> {label} {theme === value && <Check className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={pending} onClick={() => void handleSignOut()}><LogOut />{pending ? "Signing out…" : "Sign out"}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
