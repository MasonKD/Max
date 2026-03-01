import pino from "pino";
import { config } from "./config.js";

const transport = config.LOG_PRETTY
  ? pino.transport({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname"
      }
    })
  : undefined;

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: undefined
  },
  transport
);
