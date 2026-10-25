import { useAuth } from "@/components/auth-provider";

/** Manual scans use the signed-in administrator's normal account session. */
export function useManualScanAccess() {
  const { isAdmin, loading } = useAuth();
  const run = async (action: () => unknown | Promise<unknown>) => {
    if (!loading && isAdmin) await action();
  };
  return { run, dialog: null, busy: loading || !isAdmin };
}
