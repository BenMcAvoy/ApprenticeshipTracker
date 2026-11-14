import cors from "cors";
import { createHTTPServer } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.ts";
import { createLogger } from "./logger.ts";
import { createContext } from "./trpc.ts";
import { syncVacanciesFromSnapshot } from "./vacancies.ts";

const port = Number(process.env.PORT ?? 3000);

const imported = await syncVacanciesFromSnapshot();
createLogger("vacancies").info(imported, "Imported The Apprentice Guide vacancy snapshot");

createHTTPServer({
  router: appRouter,
  createContext,
  middleware: cors({ origin: /^http:\/\/localhost:\d+$/ }),
}).listen(port);

createLogger("server").info({ port }, "tRPC backend listening");
