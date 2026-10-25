import cors from "cors";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.ts";
import { startScheduler } from "./scheduler.ts";
import { createContext } from "./trpc.ts";

const port = Number(process.env.PORT ?? 3000);

createHTTPServer({
  router: appRouter,
  createContext,
  middleware: cors({ origin: /^http:\/\/localhost:\d+$/ }),
}).listen(port);

console.log(`tRPC backend listening on http://localhost:${port}`);
void startScheduler();
