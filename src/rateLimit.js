// src/rateLimit.js
import rateLimit from "express-rate-limit";

export const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 120, // 120 Requests pro Minute
  standardHeaders: true,
  legacyHeaders: false,
  // Kein store: Nutzt MemoryStore (default)
});

export const toolLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // Strenger für Tool-Routes
  standardHeaders: true,
  legacyHeaders: false,
});