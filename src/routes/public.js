import { Router } from "express";

export const publicRouter = Router();

publicRouter.get("/ping", (_req, res) => {
  res.json({ pong: true, ts: Date.now() });
});

publicRouter.post("/echo", (req, res) => {
  res.json({ ok: true, you_sent: req.body ?? null });
});
