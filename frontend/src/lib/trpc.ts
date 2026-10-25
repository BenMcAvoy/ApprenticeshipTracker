import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import type { AppRouter } from "backend";
import { EventSource } from "eventsource";
import { apiUrl, getAuthToken } from "./auth";

const url = apiUrl;

const subscriptions = new Set<EventSource>();
class AuthenticatedEventSource extends EventSource {
  constructor(url: string | URL, options?: ConstructorParameters<typeof EventSource>[1]) {
    super(url, {
      ...options,
      fetch: async (input, init) => {
        const token = await getAuthToken();
        if (!token) throw new Error("Sign in with Google first.");
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers, credentials: "omit" });
      },
    });
    subscriptions.add(this);
  }
  override close() {
    subscriptions.delete(this);
    super.close();
  }
}

export function closeAuthSubscriptions() {
  for (const subscription of subscriptions) subscription.close();
}

export const queryClient = new QueryClient();

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

function clientFor(apiUrl: string) {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url: apiUrl, EventSource: AuthenticatedEventSource }),
        false: httpBatchLink({
          url: apiUrl,
          headers: async () => {
            const token = await getAuthToken();
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
        }),
      }),
    ],
  });
}

export const trpcClient = clientFor(url);
export const manualScanApiUrl = url;
export const manualTrpcClient = trpcClient;
