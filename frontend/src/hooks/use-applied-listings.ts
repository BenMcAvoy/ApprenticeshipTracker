import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

export function useAppliedListings() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const applied = useQuery({ ...trpc.applied.list.queryOptions(), refetchOnWindowFocus: "always" });
  const mark = useMutation(trpc.applied.set.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries(trpc.applied.list.queryFilter()),
  }));
  return { applied, mark };
}
