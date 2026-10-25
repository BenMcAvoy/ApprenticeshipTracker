import cors from "cors";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.ts";
import { startScheduler } from "./scheduler.ts";
import { createLogger } from "./logger.ts";
import { createContext } from "./trpc.ts";

const port = Number(process.env.PORT ?? 3000);

createHTTPServer({
  router: appRouter,
  createContext,
  middleware: cors({ origin: /^http:\/\/localhost:\d+$/ }),
}).listen(port);

createLogger("server").info({ port }, "tRPC backend listening");
void startScheduler();
