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
      <CvCard />
      {isAdmin && <>
        <h2 className="mt-4 text-sm font-medium text-muted-foreground">Admin</h2>
        <DailyScanCard />
        <StatusCard />
        <AdminUsersCard />
      </>}
    </div>
  );
}
