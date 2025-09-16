// server.js - Retell AI Hotel Agent Backend v2.5.1 (optimized)
// - LLM + Rules hybrid extractor
// - Compiled RegEx with per-request clones (no lastIndex races)
// - LLM response caching, circuit breaker & concurrency semaphore
// - Structured logging, robust error handling
// - Designed for Render.com (Node 20+ / 22+)
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

/* -------------------- Configuration & Performance Tuning -------------------- */
const CONFIG = Object.freeze({
  server: {
    port: parseInt(process.env.PORT) || 10000,
    environment: process.env.NODE_ENV || "development",
    jsonLimit: "200kb",
    maxConcurrentLLMRequests: parseInt(process.env.MAX_CONCURRENT_LLM_REQUESTS || "5", 10)
  },
  security: {
    toolSecret: process.env.TOOL_SECRET || "",
    corsOrigin: process.env.CORS_ORIGIN || "*"
  },
  llm: {
    apiBase: (process.env.LLM_API_BASE || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    apiKey: process.env.LLM_API_KEY || "",
    timeout: parseInt(process.env.LLM_TIMEOUT || "5000", 10),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES || "2", 10),
    temperature: 0
  },
  cache: {
    llmTtl: 300000, // 5 min cache
    maxSize: 1000   // Max cached responses
  },
  booking: {
    maxGuests: 10,
    maxNights: 30,
    baseRate: 90,
    boardRates: { "ohne verpflegung": 0, "frühstück": 8, "halbpension": 18, "vollpension": 28 },
    clubCareRate: 220,
    exchangeRate: 48.0
  }
});

const app = express();

/* -------------------- Precompiled RegEx -------------------- */
const REGEX_PATTERNS = Object.freeze({
  iso: /^\d{4}-\d{2}-\d{2}$/,
  dotDate: /(\b\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g,
  slashDate: /(\b\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g,
  monthDate: null, // set below
  adults: /(\d+)\s*(?:erwachsene|erwachsener|personen|person)\b/i,
  children: /(\d+)\s*(?:kind|kinder)\b/i,
  singlePerson: /\bein(?:e|en)?\s*(?:person|erwachsene(?:r)?)\b/i,
  noChildren: /\b(?:keine|ohne)\s*kinder\b/i,
  whitespace: /\s+/g,
  accents: /[\u0300-\u036f]/g,
  umlaut: { "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss" }
});

/* -------------------- Memory-Optimized Lookups -------------------- */
const LOOKUP_TABLES = Object.freeze({
  months: new Map([
    ["januar", 1], ["jan", 1], ["februar", 2], ["feb", 2],
    ["maerz", 3], ["märz", 3], ["mrz", 3], ["mar", 3],
    ["april", 4], ["apr", 4], ["mai", 5],
    ["juni", 6], ["jun", 6], ["juli", 7], ["jul", 7],
    ["august", 8], ["aug", 8], ["september", 9], ["sep", 9], ["sept", 9],
    ["oktober", 10], ["okt", 10], ["november", 11], ["nov", 11],
    ["dezember", 12], ["dez", 12]
  ]),
  relativeDates: new Map([
    ["heute", 0], ["morgen", 1], ["übermorgen", 2], ["uebermorgen", 2]
  ])
});

// Build month regex once (keys are already normalized)
REGEX_PATTERNS.monthDate = new RegExp(
  String.raw`(\b\d{1,2})\.\s*(${Array.from(LOOKUP_TABLES.months.keys()).join("|")})(?:\s*(\d{2,4}))?`,
  "gi"
);

// Per-request RegExp clones (prevent lastIndex races)
const RE_CLONE = {
  dot:   () => new RegExp(REGEX_PATTERNS.dotDate.source,   "g"),
  slash: () => new RegExp(REGEX_PATTERNS.slashDate.source, "g"),
  month: () => new RegExp(REGEX_PATTERNS.monthDate.source, "gi")
};

/* -------------------- Structured Logger -------------------- */
const logger = {
  debug: (msg, meta = {}) => CONFIG.server.environment === "development" &&
    console.log(JSON.stringify({ level: "DEBUG", msg, meta, ts: Date.now() })),
  info: (msg, meta = {}) =>
    console.log(JSON.stringify({ level: "INFO", msg, meta, ts: Date.now() })),
  warn: (msg, error = null, meta = {}) =>
    console.warn(JSON.stringify({ level: "WARN", msg, error: error?.message, meta, ts: Date.now() })),
  error: (msg, error = null, meta = {}) =>
    console.error(JSON.stringify({ level: "ERROR", msg, error: error?.message, stack: error?.stack?.split("\n").slice(0,3), meta, ts: Date.now() }))
};

/* -------------------- LLM Response Cache -------------------- */
class LLMCache {
  constructor(maxSize = 1000, ttl = 300000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
    this.cleanupInterval = setInterval(() => this.cleanup(), Math.max(1000, ttl / 2));
  }
  key(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(16);
  }
  get(text) {
    const k = this.key(text);
    const entry = this.cache.get(k);
    if (entry && Date.now() - entry.timestamp < this.ttl) { logger.debug("LLM cache hit", { key: k }); return entry.data; }
    return null;
  }
  set(text, data) {
    const k = this.key(text);
    if (this.cache.size >= this.maxSize) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(k, { data, timestamp: Date.now() });
    logger.debug("LLM cache set", { key: k, size: this.cache.size });
  }
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache) if (now - entry.timestamp >= this.ttl) this.cache.delete(key);
  }
  destroy() { clearInterval(this.cleanupInterval); this.cache.clear(); }
}
const llmCache = new LLMCache(CONFIG.cache.maxSize, CONFIG.cache.llmTtl);

/* -------------------- Circuit Breaker -------------------- */
class CircuitBreaker {
  constructor(threshold = 5, timeout = 30000) {
    this.failureThreshold = threshold; this.resetTimeout = timeout;
    this.state = "CLOSED"; this.failureCount = 0; this.nextAttempt = Date.now();
  }
  canExecute() { if (this.state === "OPEN") { if (Date.now() > this.nextAttempt) { this.state = "HALF_OPEN"; return true; } return false; } return true; }
  onSuccess() { this.failureCount = 0; this.state = "CLOSED"; }
  onFailure() { this.failureCount++; if (this.failureCount >= this.failureThreshold) { this.state = "OPEN"; this.nextAttempt = Date.now() + this.resetTimeout; logger.warn("Circuit breaker opened", null, { failureCount: this.failureCount }); } }
}
const llmCircuitBreaker = new CircuitBreaker();

/* -------------------- Concurrency Semaphore for LLM -------------------- */
class Semaphore {
  constructor(capacity) { this.free = capacity; this.q = []; }
  async acquire() { if (this.free > 0) { this.free--; return; } await new Promise(res => this.q.push(res)); }
  release() { this.free++; if (this.q.length) { this.free--; this.q.shift()(); } }
}
const llmSem = new Semaphore(CONFIG.server.maxConcurrentLLMRequests || 5);

/* -------------------- Utils -------------------- */
const utils = {
  normalize: (s = "") => {
    if (!s || typeof s !== "string") return "";
    let result = s.toLowerCase();
    for (const [from, to] of Object.entries(REGEX_PATTERNS.umlaut)) {
      if (result.includes(from)) result = result.replace(new RegExp(from, "g"), to);
    }
    return result.normalize("NFKD").replace(REGEX_PATTERNS.accents, "").replace(REGEX_PATTERNS.whitespace, " ").trim();
  },
  toDate: (s) => { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; },
  parseDateAny: (() => {
    const cache = new Map();
    return (input) => {
      if (!input) return null;
      const str = String(input).trim();
      if (cache.has(str)) return cache.get(str);
      let result = null;
      if (REGEX_PATTERNS.iso.test(str)) { result = str; }
      else {
        let m = str.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
        if (m) {
          const [, d, mo, y] = m; let year = y ? parseInt(y) : new Date().getFullYear();
          if (year < 100) year += 2000; const dt = new Date(year, parseInt(mo) - 1, parseInt(d));
          result = isNaN(dt) ? null : dt.toISOString().slice(0,10);
        } else {
          m = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
          if (m) {
            const [, d, mo, y] = m; let year = y ? parseInt(y) : new Date().getFullYear();
            if (year < 100) year += 2000; const dt = new Date(year, parseInt(mo) - 1, parseInt(d));
            result = isNaN(dt) ? null : dt.toISOString().slice(0,10);
          } else {
            const n = utils.normalize(str);
            m = n.match(/^(\d{1,2})\.\s*([a-z]+)(?:\s*(\d{2,4}))?$/);
            if (m) {
              const [, d, mon, y] = m; const mo = LOOKUP_TABLES.months.get(mon);
              if (mo) { let year = y ? parseInt(y) : new Date().getFullYear(); if (year < 100) year += 2000;
                const dt = new Date(year, mo - 1, parseInt(d)); result = isNaN(dt) ? null : dt.toISOString().slice(0,10); }
            } else {
              for (const [key, offset] of LOOKUP_TABLES.relativeDates) {
                if (n.includes(key)) { const dt = new Date(); dt.setDate(dt.getDate() + offset); result = dt.toISOString().slice(0,10); break; }
              }
              if (!result) { const dt = new Date(str); result = isNaN(dt) ? null : dt.toISOString().slice(0,10); }
            }
          }
        }
      }
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(str, result);
      return result;
    };
  })(),
  nightsBetween: (a, b) => {
    const A = utils.toDate(a); const B = utils.toDate(b);
    if (!A || !B) return 0; const ms = B - A;
    return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : 0;
  },
  coerceInt: (v, def = 0) => {
    if (v === null || v === undefined || v === "") return def;
    const n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : def;
  },
  euro: (n) => Math.round(n * 100) / 100
};

/* -------------------- Rule-Based Extraction -------------------- */
function extractWithRules(rawText) {
  if (!rawText || typeof rawText !== "string") return { check_in: null, check_out: null, adults: 1, children: 0 };
  const text = utils.normalize(rawText);
  const dates = new Set();
  const DOT = RE_CLONE.dot();
  for (const match of rawText.matchAll(DOT)) {
    const [, d, mo, y] = match; const parsed = utils.parseDateAny(`${d}.${mo}.${y || ""}`);
    if (parsed) dates.add(parsed);
  }
  const SLASH = RE_CLONE.slash();
  for (const match of rawText.matchAll(SLASH)) {
    const [, d, mo, y] = match; const parsed = utils.parseDateAny(`${d}/${mo}/${y || ""}`);
    if (parsed) dates.add(parsed);
  }
  const MONTH = RE_CLONE.month();
  for (const match of rawText.matchAll(MONTH)) {
    const [, d, mon, y] = match; const parsed = utils.parseDateAny(`${d}. ${mon} ${y || ""}`);
    if (parsed) dates.add(parsed);
  }
  const sortedDates = Array.from(dates).sort();
  const [check_in, check_out] = sortedDates;
  let adults = 1, children = 0;
  const adultsMatch = text.match(REGEX_PATTERNS.adults);
  if (adultsMatch) adults = utils.coerceInt(adultsMatch[1], 1);
  else if (REGEX_PATTERNS.singlePerson.test(text)) adults = 1;
  const childrenMatch = text.match(REGEX_PATTERNS.children);
  if (childrenMatch) children = utils.coerceInt(childrenMatch[1], 0);
  else if (REGEX_PATTERNS.noChildren.test(text)) children = 0;
  return { check_in: check_in || null, check_out: check_out || null, adults, children };
}

/* -------------------- Express Setup -------------------- */
app.use(cors({ origin: CONFIG.security.corsOrigin, methods: ["GET","POST","OPTIONS"], credentials: false }));

app.use(express.json({ limit: CONFIG.server.jsonLimit }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.server.jsonLimit }));

/* -------------------- Auth Middleware -------------------- */
const requireToolSecret = (req, res, next) => {
  const providedSecret = req.header("tool-secret");
  if (!CONFIG.security.toolSecret) {
    logger.error("Tool secret not configured");
    return res.status(500).json({ ok: false, error: "server_configuration_error", message: "Authentication not properly configured" });
  }
  if (!providedSecret || providedSecret !== CONFIG.security.toolSecret) {
    logger.warn("Unauthorized access attempt", null, { ip: req.ip, path: req.path, hasSecret: !!providedSecret });
    return res.status(401).json({ ok: false, error: "unauthorized", message: "Valid tool-secret header required" });
  }
  next();
};

/* -------------------- LLM Integration -------------------- */
async function callLLMWithRetry(prompt, maxRetries = CONFIG.llm.maxRetries) {
  if (!llmCircuitBreaker.canExecute()) { logger.warn("LLM circuit breaker open, skipping request"); return null; }
  const cached = llmCache.get(prompt); if (cached) return cached;
  await llmSem.acquire();
  try {
    const systemPrompt = [
      "Du extrahierst Buchungsdaten für ein Hotel aus deutscher Sprache.",
      "Gib **nur** gültiges JSON zurück, keine Erklärungen oder Markdown.",
      "Schema:",
      "{",
      '  "check_in": "YYYY-MM-DD | null",',
      '  "check_out": "YYYY-MM-DD | null",',
      '  "adults": number,',
      '  "children": number',
      "}",
      "Regeln:",
      "- Fehlendes/unklares Datum → null",
      "- Deutsche Datumsformate (22.10., 22. Oktober) korrekt konvertieren",
      "- Zahlen als Integer, minimum adults=1, children=0",
      "- Bei Unsicherheit: konservativ schätzen"
    ].join("\n");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.llm.timeout);

        const resp = await fetch(`${CONFIG.llm.apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${CONFIG.llm.apiKey}`,
            "User-Agent": "Retell-Hotel-Agent/2.5.1"
          },
          body: JSON.stringify({
            model: CONFIG.llm.model,
            temperature: CONFIG.llm.temperature,
            max_tokens: 200,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: prompt }
            ]
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
          const errText = await resp.text().catch(() => "unknown");
          throw new Error(`LLM API error ${resp.status}: ${errText}`);
        }

        const data = await resp.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error("Empty LLM response");

        const parsed = JSON.parse(content);
        const result = {
          check_in: typeof parsed.check_in === "string" ? parsed.check_in : null,
          check_out: typeof parsed.check_out === "string" ? parsed.check_out : null,
          adults: utils.coerceInt(parsed.adults, 1),
          children: utils.coerceInt(parsed.children, 0)
        };

        llmCache.set(prompt, result);
        llmCircuitBreaker.onSuccess();
        logger.debug("LLM extraction successful", { attempt, model: CONFIG.llm.model });
        return result;

      } catch (err) {
        logger.warn(`LLM attempt ${attempt} failed`, err, { prompt: prompt.slice(0, 80) });
        if (attempt === maxRetries) llmCircuitBreaker.onFailure();
        if (attempt < maxRetries && (err.name === "AbortError" or err.code === "ECONNRESET")) {
          await new Promise(r => setTimeout(r, 100 * attempt));
        }
      }
    }
    logger.error("LLM extraction failed after all retries");
    return null;
  } finally {
    llmSem.release();
  }
}

/* -------------------- API Endpoints -------------------- */
app.get("/healthz", (req, res) => {
  const today = new Date(); today.setHours(0,0,0,0);
  const health = {
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.5.1-optimized",
    node: process.version,
    env: CONFIG.server.environment,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heap_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    },
    config: {
      maxGuests: CONFIG.booking.maxGuests,
      maxNights: CONFIG.booking.maxNights,
      hasToolSecret: !!CONFIG.security.toolSecret,
      hasLLM: !!CONFIG.llm.apiKey,
      cacheSize: llmCache.cache.size,
      circuitBreakerState: llmCircuitBreaker.state,
      todayISO: today.toISOString().slice(0,10)
    }
  };
  logger.debug("Health check", { ip: req.ip, cacheSize: health.config.cacheSize });
  res.json(health);
});

// Public: Rule-based extraction
app.post("/retell/public/extract_core", (req, res) => {
  const start = Date.now();
  try {
    const b = req.body || {};
    const utterance =
      b.utterance || b.text || b.message || b.query ||
      b.user_text || b.userMessage ||
      (b.input && (b.input.utterance || b.input.text || b.input.message)) ||
      (b.arguments && (b.arguments.utterance || b.arguments.text)) || "";
    const raw = String(utterance || "");
    const slots = extractWithRules(raw);
    logger.info("Rule-based extraction", { ms: Date.now() - start, hasInput: !!raw });
    return res.json({ ok: true, ...slots, raw, source: "rules" });
  } catch (e) {
    logger.error("Rule extraction failed", e);
    return res.status(200).json({ ok: false, error: "parse_error", message: "Failed to parse input" });
  }
});

// Tool: LLM-enhanced extraction
app.post("/retell/tool/extract_core_llm", requireToolSecret, async (req, res) => {
  const start = Date.now();
  try {
    const b = req.body || {};
    const utterance =
      b.utterance || b.text || b.message || b.query ||
      b.user_text || b.userMessage || b.asr_text ||
      b.transcript || b.user_message || b.raw_user_text ||
      (b.conversation && b.conversation.last_user_message) || "";
    const raw = String(utterance || "").trim();
    if (!raw) {
      logger.debug("Empty input for LLM extraction");
      return res.json({ ok: true, check_in: null, check_out: null, adults: 1, children: 0, raw: null, source: "empty" });
    }
    const [llmRes, ruleRes] = await Promise.allSettled([
      CONFIG.llm.apiKey ? callLLMWithRetry(raw) : Promise.resolve(null),
      Promise.resolve(extractWithRules(raw))
    ]);
    const llmData = llmRes.status === "fulfilled" ? llmRes.value : null;
    const ruleData = ruleRes.status === "fulfilled" ? ruleRes.value : { check_in: null, check_out: null, adults: 1, children: 0 };
    const out = {
      check_in:  llmData?.check_in  || ruleData.check_in  || null,
      check_out: llmData?.check_out || ruleData.check_out || null,
      adults:    utils.coerceInt(llmData?.adults ?? ruleData.adults, 1),
      children:  utils.coerceInt(llmData?.children ?? ruleData.children, 0),
      raw,
      source: llmData ? "llm+rules" : "rules",
      processing_time_ms: Date.now() - start
    };
    logger.info("LLM extraction completed", { ms: out.processing_time_ms, source: out.source, hasDates: !!(out.check_in && out.check_out) });
    return res.json({ ok: true, ...out });
  } catch (e) {
    logger.error("LLM extraction error", e);
    try {
      const raw = String((req.body && (req.body.utterance || req.body.text || "")) || "");
      const fb = extractWithRules(raw);
      return res.json({ ok: true, ...fb, raw, source: "rules-fallback", processing_time_ms: Date.now() - start, warning: "LLM extraction failed" });
    } catch (e2) {
      logger.error("Complete extraction failure", e2);
      return res.status(200).json({ ok: false, error: "extraction_failed", message: "Both LLM and rules failed" });
    }
  }
});

// Tool: Slim availability
app.post("/retell/tool/check_availability_slim", requireToolSecret, (req, res) => {
  const start = Date.now();
  try {
    const b = req.body || {};
    const fromDate = utils.parseDateAny(b.from_date || b.check_in || b.start || b.start_date);
    const toDate   = utils.parseDateAny(b.to_date   || b.check_out || b.end   || b.end_date);
    const adults   = utils.coerceInt(b.adults ?? b.adult ?? b.guests, 2);
    const children = utils.coerceInt(b.children ?? b.kids, 0);
    if (!fromDate || !toDate) {
      return res.json({ ok: false, code: "MISSING_DATES", availability_ok: false, nights: 0, spoken: "Damit ich die Verfügbarkeit prüfen kann, brauche ich sowohl An- als auch Abreisedatum." });
    }
    const nights = utils.nightsBetween(fromDate, toDate);
    const totalGuests = adults + children;
    const today = new Date(); today.setHours(0,0,0,0);
    const isNotPastDate = new Date(fromDate) >= today;
    const isValidStay = nights > 0 && nights <= CONFIG.booking.maxNights;
    const hasCapacity = totalGuests > 0 && totalGuests <= CONFIG.booking.maxGuests;
    const available = isValidStay && hasCapacity && isNotPastDate;
    const fmt = (d) => new Date(d).toLocaleDateString("de-DE", { day:"2-digit", month:"long", year:"numeric" });
    const spoken = available
      ? `Für ${nights} Nacht${nights > 1 ? "e" : ""} vom ${fmt(fromDate)} bis ${fmt(toDate)} haben wir passende Unterkünfte verfügbar.`
      : nights <= 0
        ? "Das Abreisedatum muss nach dem Anreisedatum liegen."
        : !isNotPastDate
          ? "Das Anreisedatum darf nicht in der Vergangenheit liegen."
          : totalGuests > CONFIG.booking.maxGuests
            ? `Für ${totalGuests} Gäste können wir leider keine Unterkunft anbieten. Maximum sind ${CONFIG.booking.maxGuests} Gäste.`
            : "Für die gewählten Daten ist derzeit nichts verfügbar.";
    logger.info("Availability check", { ms: Date.now() - start, nights, totalGuests, available, dates: { from: fromDate, to: toDate } });
    return res.json({ ok: true, availability_ok: available, nights, spoken, details: { total_guests: totalGuests, adults, children, check_in: fromDate, check_out: toDate } });
  } catch (e) {
    logger.error("Availability check failed", e);
    return res.json({ ok: false, code: "INTERNAL_ERROR", availability_ok: false, nights: 0, spoken: "Es gab ein technisches Problem bei der Verfügbarkeitsprüfung." });
  }
});

// Public: Quote
app.post("/retell/public/quote", (req, res) => {
  try {
    const { check_in, check_out, adults = 2, children = 0, board = "frühstück", club_care = false } = req.body || {};
    const nights = utils.nightsBetween(check_in, check_out);
    if (!check_in || !check_out || nights <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_dates", message: "Valid check-in and check-out dates required" });
    }
    const boardKey = String(board).toLowerCase();
    const boardRate = CONFIG.booking.boardRates[boardKey] ?? CONFIG.booking.boardRates["frühstück"];
    const clubCareRate = club_care ? CONFIG.booking.clubCareRate : 0;
    const totalEur = utils.euro(nights * (CONFIG.booking.baseRate + boardRate) + clubCareRate);
    const totalTry = Math.round(totalEur * CONFIG.booking.exchangeRate);
    logger.info("Quote generated", { nights, totalEur, totalTry, board: boardKey, club_care });
    return res.json({ ok: true, data: { total_eur: totalEur, total_try: totalTry, fx: CONFIG.booking.exchangeRate, nights,
      breakdown: { basePerNight: CONFIG.booking.baseRate, boardAdd: boardRate, clubCareAdd: clubCareRate, board: boardKey, adults: utils.coerceInt(adults,1), children: utils.coerceInt(children,0) } } });
  } catch (e) {
    logger.error("Quote generation failed", e);
    return res.status(500).json({ ok: false, error: "internal_error", message: "Failed to generate quote" });
  }
});

// Tool: Commit booking
app.post("/retell/tool/commit_booking", requireToolSecret, (req, res) => {
  try {
    const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email", message: "Valid email address required" });
    }
    const bookingId = `bk_${Date.now()}_${Math.random().toString(36).substr(2,8)}`;
    const booking = {
      booking_id: bookingId,
      email: email.toLowerCase().trim(),
      check_in,
      check_out,
      adults: utils.coerceInt(adults, 1),
      children: utils.coerceInt(children, 0),
      board: String(board || "frühstück").toLowerCase(),
      club_care: !!club_care,
      created_at: new Date().toISOString()
    };
    logger.info("Booking committed", { bookingId, email: booking.email });
    return res.json({ ok: true, data: booking });
  } catch (e) {
    logger.error("Booking commit failed", e);
    return res.status(500).json({ ok: false, error: "internal_error", message: "Failed to commit booking" });
  }
});

// Tool: Send offer
app.post("/retell/tool/send_offer", requireToolSecret, (req, res) => {
  try {
    const { email, quote_eur, quote_try, fx, details } = req.body || {};
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return res.status(400).json({ ok: false, error: "invalid_email", message: "Valid email address required" });
    }
    const offer = {
      sent: true,
      to: email.toLowerCase().trim(),
      subject: "Ihr persönliches Angebot – Erendiz Hotel",
      preview: `Gesamtpreis: €${quote_eur} (ca. ₺${quote_try} zum Kurs ${fx})`,
      details,
      sent_at: new Date().toISOString()
    };
    logger.info("Offer sent", { email: offer.to, quote_eur, quote_try });
    return res.json({ ok: true, data: offer });
  } catch (e) {
    logger.error("Offer sending failed", e);
    return res.status(500).json({ ok: false, error: "internal_error", message: "Failed to send offer" });
  }
});

/* -------------------- Global Error Handler -------------------- */
app.use((err, req, res, next) => {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
  logger.error("Unhandled request error", err, { errorId, method: req.method, path: req.path, ip: req.ip });
  if (err.status === 400 && err.message === "Invalid JSON") {
    return res.status(400).json({ ok: false, error: "invalid_json", message: "Request body must be valid JSON", errorId });
  }
  res.status(err.status || 500).json({ ok: false, error: "internal_error", message: CONFIG.server.environment === "development" ? err.message : "An unexpected error occurred", errorId });
});

/* -------------------- 404 Handler -------------------- */
app.use("*", (req, res) => {
  logger.info("404 - Route not found", { method: req.method, path: req.path, ip: req.ip });
  res.status(404).json({
    ok: false,
    error: "route_not_found",
    path: req.path,
    method: req.method,
    available_endpoints: [
      "GET  /healthz",
      "POST /retell/public/extract_core",
      "POST /retell/public/quote",
      "POST /retell/tool/extract_core_llm",
      "POST /retell/tool/check_availability_slim",
      "POST /retell/tool/commit_booking",
      "POST /retell/tool/send_offer"
    ]
  });
});

/* -------------------- Graceful Shutdown -------------------- */
const shutdown = (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  llmCache.destroy();
  server.close((err) => {
    if (err) { logger.error("Error during shutdown", err); process.exit(1); }
    logger.info("Server closed successfully"); process.exit(0);
  });
  setTimeout(() => { logger.error("Forced shutdown after timeout"); process.exit(1); }, 10000);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* -------------------- Server Start -------------------- */
const server = app.listen(CONFIG.server.port, () => {
  logger.info("Server started successfully", {
    port: CONFIG.server.port,
    environment: CONFIG.server.environment,
    nodeVersion: process.version,
    hasToolSecret: !!CONFIG.security.toolSecret,
    hasLLMKey: !!CONFIG.llm.apiKey,
    llmModel: CONFIG.llm.model
  });
  console.log(`🚀 Retell Hotel Agent v2.5.1-optimized running on port ${CONFIG.server.port}`);
  console.log(`📊 Health: http://localhost:${CONFIG.server.port}/healthz`);
  console.log(`🔐 Tool Secret: ${CONFIG.security.toolSecret ? "✓ Configured" : "✗ Missing"}`);
  console.log(`🤖 LLM: ${CONFIG.llm.apiKey ? "✓ " + CONFIG.llm.model : "✗ No API key"}`);
  console.log(`🌍 Environment: ${CONFIG.server.environment}`);
});

export default app;
