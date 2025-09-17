/**
 * Minimal Retell websocket client helper (skeleton).
 * In production you would authenticate and stream audio frames.
 * Here we only validate presence of API key and provide a placeholder.
 */
import WebSocket from "ws";
import { CONFIG } from "../config.js";

export function ensureApiKey() {
  if (!CONFIG.retellApiKey) {
    const err = new Error("RETELL_API_KEY is not configured");
    err.status = 503;
    throw err;
  }
}

export async function connectRetell() {
  ensureApiKey();
  const url = CONFIG.retellWsUrl;
  // Placeholder: do not actually connect by default to avoid surprise network activity
  // Return a mock descriptor
  return { ok: true, url, note: "WS not opened in skeleton client" };
}
