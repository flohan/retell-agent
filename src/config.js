import { z } from "zod";

const RawEnv = z.object({
  NODE_ENV: z.enum(["dev","development","test","production"]).default("dev"),
  PORT: z.string().default("10000"),
  CORS_ORIGIN: z.string().default("*"),
  TOOL_SECRET: z.string().min(8).optional(),
  ENABLE_LLM: z.enum(["0","1"]).default("0"),
  RETELL_API_KEY: z.string().optional(),
  RETELL_WS_URL: z.string().url().optional(),
  LOG_LEVEL: z.string().optional(),
});

const env = RawEnv.parse(process.env);

function parseCors(origins) {
  if (origins === "*") return "*";
  return origins.split(",").map(s => s.trim()).filter(Boolean);
}

export const CONFIG = {
  env: env.NODE_ENV === "development" ? "dev" : env.NODE_ENV,
  port: Number(env.PORT),
  corsOrigin: parseCors(env.CORS_ORIGIN),
  toolSecret: env.TOOL_SECRET,
  enableLLM: env.ENABLE_LLM === "1",
  retellApiKey: env.RETELL_API_KEY,
  retellWsUrl: env.RETELL_WS_URL || "wss://api.retellai.com/audio-websocket",
  logLevel: env.LOG_LEVEL || (env.NODE_ENV.startsWith("dev") ? "debug" : "info"),
};
