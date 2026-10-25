import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

export function AdminUsersCard() {
  const { user } = useAuth();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const users = useQuery({ ...trpc.admin.users.queryOptions(), refetchOnWindowFocus: "always" });
  const setRole = useMutation(trpc.admin.setRole.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries(trpc.admin.users.queryFilter()),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="size-4" /> Accounts &amp; roles</CardTitle>
        <CardDescription>New Google accounts join as members. Administrators manage the shared catalogue and service settings.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {users.isPending && <p role="status" className="text-sm text-muted-foreground">Loading accounts…</p>}
        {users.isError && <p role="alert" className="text-sm text-destructive">{users.error.message}</p>}
        {setRole.isError && <p role="alert" className="text-sm text-destructive">{setRole.error.message}</p>}
        <ul className="flex max-h-96 flex-col divide-y overflow-y-auto">
          {users.data?.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1 text-sm"><p className="truncate font-medium">{account.name || account.email}{account.id === user?.id ? " (you)" : ""}</p><p className="truncate text-xs text-muted-foreground">{account.email}</p></div>
              <Badge variant="secondary">{account.role === "ADMIN" ? "Admin" : "Member"}</Badge>
              <Button size="xs" variant="outline" disabled={setRole.isPending || account.id === user?.id} title={account.id === user?.id ? "Ask another administrator to change your role" : undefined} onClick={() => setRole.mutate({ userId: account.id, role: account.role === "ADMIN" ? "MEMBER" : "ADMIN" })}>{account.role === "ADMIN" ? "Make member" : "Make admin"}</Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
