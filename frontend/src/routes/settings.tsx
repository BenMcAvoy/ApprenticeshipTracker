import { createFileRoute } from "@tanstack/react-router";
import { CvCard } from "@/components/cv-card";
import { DailyScanCard } from "@/components/daily-scan-card";
import { StatusCard } from "@/components/status-card";
import { useAuth } from "@/components/auth-provider";
import { AdminUsersCard } from "@/components/admin-users-card";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const { isAdmin } = useAuth();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Your CV is saved to your account. Track submitted roles in Applications.</p>
      <CvCard />
      {isAdmin && <>
        <div className="mt-2 border-t pt-5">
          <h2 className="text-sm font-medium">Administration</h2>
          <p className="mt-1 text-xs text-muted-foreground">Shared catalogue, scan schedule and ChatGPT connection for the service.</p>
        </div>
        <DailyScanCard />
        <StatusCard />
        <AdminUsersCard />
      </>}
    </div>
  );
}
