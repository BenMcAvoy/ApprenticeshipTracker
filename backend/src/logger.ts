import pino from "pino";

const production = process.env.NODE_ENV === "production";

/**
 * Structured logger for the backend. JSON lines in production (what Docker collects),
 * coloured output when running `npm run dev` in a terminal. Set LOG_LEVEL to override.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (production ? "info" : "debug"),
  redact: {
    paths: ["token", "password", "apiKey", "*.token", "*.password", "*.apiKey", "req.headers.authorization"],
    censor: "[redacted]",
  },
  ...(!production && process.stdout.isTTY
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" } } }
    : {}),
});

/** A child logger tagged with the subsystem, e.g. `createLogger("scheduler")`. */
export const createLogger = (scope: string) => logger.child({ scope });
