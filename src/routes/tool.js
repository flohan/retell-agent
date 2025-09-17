import { Router } from "express";
import { CONFIG } from "../config.js";
import { connectRetell } from "../retell/client.js";

export const toolRouter = Router();

function requireToolSecret(req, res, next) {
  const header = req.headers["authorization"] || req.headers["x-tool-secret"];
  const token = typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : (typeof header === "string" ? header : undefined);

  if (!CONFIG.toolSecret) {
    return res.status(503).json({ error: "config_error", message: "TOOL_SECRET not configured" });
  }
  if (!token || token !== CONFIG.toolSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

toolRouter.use(requireToolSecret);

toolRouter.get("/whoami", (_req, res) => {
  res.json({ role: "retell-tool", env: CONFIG.env, llm: CONFIG.enableLLM });
});

toolRouter.post("/echo", (req, res) => {
  res.json({ ok: true, payload: req.body ?? null });
});

toolRouter.post("/retell-check", async (_req, res, next) => {
  try {
    const info = await connectRetell();
    res.json({ ok: true, retell: info });
  } catch (e) {
    next(e);
  }
});
