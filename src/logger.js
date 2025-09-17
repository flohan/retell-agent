import pino from "pino";
import { CONFIG } from "./config.js";

export const logger = pino({
  level: CONFIG.logLevel,
  base: undefined,
  redact: {
    paths: ["req.headers.authorization", "authorization", "token", "apiKey", "RETELL_API_KEY"],
    remove: true,
  },
});
