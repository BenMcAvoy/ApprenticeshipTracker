import { Link } from "@tanstack/react-router";
import { Check, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Theme, useTheme } from "@/lib/theme";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AccountMenu() {
  const { user, isAdmin, signOut, error } = useAuth();
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
        <DropdownMenuTrigger render={<button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-medium hover:bg-accent" aria-label={`Account menu for ${user.name || user.email}`} title={user.name || user.email} />}>
          {(user.name || user.email).trim().slice(0, 1).toUpperCase()}
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-64 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block truncate text-sm text-foreground">{user.name || user.email}</span>
              <span className="block truncate">{user.email}</span>
              {isAdmin && <span className="mt-1 block">Administrator</span>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11 md:min-h-8" render={<Link to="/settings" />}><Settings /> Settings</DropdownMenuItem>
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
