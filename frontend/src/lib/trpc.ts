import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "backend";
import { apiUrl, getAuthToken } from "./auth";

const url = apiUrl;

export const queryClient = new QueryClient();

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function clientFor(apiUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: apiUrl,
        headers: async () => {
          const token = await getAuthToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

export const trpcClient = clientFor(url);
