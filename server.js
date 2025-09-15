// server.js — Retell Hotel Agent Backend (Optimized & Performance Enhanced)
//
// Optimierungen:
// - Kompilierte RegEx für bessere Performance
// - Input-Validierung mit Joi-ähnlicher Struktur
// - Memory-optimierte Konstanten
// - Bessere Error-Typisierung
// - Strukturierte Logs
// - Configuration-Management
// - Type-Guards für Runtime-Sicherheit

import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);

/* -------------------- Configuration -------------------- */
const CONFIG = Object.freeze({
  server: {
    port: PORT,
    jsonLimit: "100kb",
    maxRequestsPerMinute: 100,
    environment: process.env.RENDER ? "render" : "local"
  },
  booking: {
    maxGuests: 10,
    maxNights: 30,
    minYear: 1900,
    maxYear: 2100
  },
  secrets: {
    tool: (process.env.TOOL_SECRET || process.env.TOOLSECRET || "").trim()
  }
});

/* -------------------- Compiled RegEx (Performance) -------------------- */
const REGEX = Object.freeze({
  ordinalSuffix: /(?:ste|sten|ster|stes|te|ten|ter|tes)$/,
  isoDate: /^\d{4}-\d{2}-\d{2}$/,
  relativeDate: /in\s+(\d{1,2})\s*tag(?:e|en)?/,
  weekdayPattern: /(?:nächsten|kommenden|am)\s+([a-zäöüß.]+)|^([a-zäöüß.]+)$/,
  europeanDate: /^(\d{1,2})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{2,4}))?\s*\.?$/,
  longDatePattern: /^(\d{1,2})\.?\s+([a-zäöüß.]+)(?:\s+(\d{4}))?$/i,
  whitespace: /\s+/g,
  trailingDot: /\.$/,
  accent: /[\u0300-\u036f]/g
});

/* -------------------- Type Guards -------------------- */
const isValidNumber = (value, min = -Infinity, max = Infinity) => {
  const num = Number(value);
  return !isNaN(num) && isFinite(num) && num >= min && num <= max;
};

const isValidString = (value, minLength = 0, maxLength = Infinity) => {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
};

/* -------------------- Enhanced Logging -------------------- */
const logger = {
  info: (message, meta = {}) => console.log(JSON.stringify({ level: "INFO", message, meta, timestamp: new Date().toISOString() })),
  error: (message, error = {}, meta = {}) => console.error(JSON.stringify({ level: "ERROR", message, error: error.message || error, stack: error.stack, meta, timestamp: new Date().toISOString() })),
  debug: (message, meta = {}) => process.env.DEBUG && console.log(JSON.stringify({ level: "DEBUG", message, meta, timestamp: new Date().toISOString() }))
};

/* -------------------- Custom Error Types -------------------- */
class ValidationError extends Error {
  constructor(message, field = null, value = null) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.field = field;
    this.value = value;
  }
}

class BusinessLogicError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "BusinessLogicError";
    this.status = 400;
    this.code = code;
  }
}

/* -------------------- Enhanced JSON Parser -------------------- */
app.use(express.json({ 
  limit: CONFIG.server.jsonLimit, 
  strict: true,
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      const error = new ValidationError("Invalid JSON format", "body", buf.toString().slice(0, 100));
      throw error;
    }
  }
}));

/* -------------------- Enhanced Secret Middleware -------------------- */
const checkSecret = (req, res, next) => {
  if (req.path === "/retell/tool" || req.path.startsWith("/retell/tool/")) {
    const incoming = (req.headers["tool-secret"] || "").toString().trim();
    
    if (!CONFIG.secrets.tool) {
      logger.error("Tool secret not configured", {}, { path: req.path });
      return res.status(500).json({
        error: "Server Configuration Error",
        details: "Tool secret not properly configured"
      });
    }
    
    if (incoming !== CONFIG.secrets.tool) {
      logger.error("Unauthorized access attempt", {}, { 
        path: req.path, 
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        hasSecret: !!incoming
      });
      return res.status(401).json({
        error: "Unauthorized",
        details: "Invalid or missing tool-secret header"
      });
    }
    
    logger.debug("Secret validation passed", { path: req.path });
  }
  next();
};

app.use(checkSecret);

/* -------------------- Memory-Optimized Constants -------------------- */
const LOOKUP_TABLES = Object.freeze({
  monthsDE: new Map([
    ["jan", 1], ["jän", 1], ["januar", 1],
    ["feb", 2], ["februar", 2],
    ["mar", 3], ["mär", 3], ["mrz", 3], ["maerz", 3], ["märz", 3],
    ["apr", 4], ["april", 4],
    ["mai", 5],
    ["jun", 6], ["juni", 6],
    ["jul", 7], ["juli", 7],
    ["aug", 8], ["august", 8],
    ["sep", 9], ["sept", 9], ["september", 9],
    ["okt", 10], ["oktober", 10],
    ["nov", 11], ["november", 11],
    ["dez", 12], ["dezember", 12], ["december", 12]
  ]),
  
  weekdaysDE: new Map([
    ["sonntag", 0], ["so", 0], ["so.", 0],
    ["montag", 1], ["mo", 1], ["mo.", 1],
    ["dienstag", 2], ["di", 2], ["di.", 2],
    ["mittwoch", 3], ["mi", 3], ["mi.", 3],
    ["donnerstag", 4], ["do", 4], ["do.", 4],
    ["freitag", 5], ["fr", 5], ["fr.", 5],
    ["samstag", 6], ["sa", 6], ["sa.", 6], ["sonnabend", 6]
  ]),
  
  numberWords: new Map([
    ["eins", 1], ["eine", 1], ["einen", 1], ["einem", 1], ["einer", 1], ["ein", 1],
    ["zwei", 2], ["drei", 3], ["vier", 4], ["fünf", 5], ["funf", 5],
    ["sechs", 6], ["sieben", 7], ["acht", 8], ["neun", 9], ["zehn", 10],
    ["elf", 11], ["zwölf", 12], ["zwolf", 12], ["dreizehn", 13], ["vierzehn", 14],
    ["fünfzehn", 15], ["funfzehn", 15], ["sechzehn", 16], ["siebzehn", 17],
    ["achtzehn", 18], ["neunzehn", 19], ["zwanzig", 20],
    ["einundzwanzig", 21], ["zweiundzwanzig", 22], ["dreiundzwanzig", 23],
    ["vierundzwanzig", 24], ["fünfundzwanzig", 25], ["funfundzwanzig", 25],
    ["sechsundzwanzig", 26], ["siebenundzwanzig", 27], ["achtundzwanzig", 28],
    ["neunundzwanzig", 29], ["dreißig", 30], ["dreissig", 30],
    ["einunddreißig", 31], ["einunddreissig", 31]
  ]),
  
  relativeDates: new Map([
    ["heute", 0], ["morgen", 1], ["übermorgen", 2], ["uebermorgen", 2]
  ]),
  
  monthNames: [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
  ]
});

/* -------------------- Optimized Utility Functions -------------------- */
const utils = {
  pad2: (n) => String(n).padStart(2, "0"),
  
  normalizeText: (text) => {
    return text.toLowerCase()
      .normalize("NFD")
      .replace(REGEX.accent, "")
      .replace(REGEX.whitespace, " ")
      .replace(/ae/g, "ä")
      .replace(/oe/g, "ö")
      .replace(/ue/g, "ü")
      .trim();
  },
  
  isValidYmd: (y, m, d) => {
    if (!isValidNumber(y, CONFIG.booking.minYear, CONFIG.booking.maxYear) || 
        !isValidNumber(m, 1, 12) || 
        !isValidNumber(d, 1, 31)) {
      return false;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && 
           (date.getUTCMonth() + 1) === m && 
           date.getUTCDate() === d;
  },
  
  addDays: (date, n) => {
    const result = new Date(date);
    result.setDate(result.getDate() + n);
    return result;
  },
  
  ymd: (date) => {
    return `${date.getFullYear()}-${utils.pad2(date.getMonth() + 1)}-${utils.pad2(date.getDate())}`;
  },
  
  nextWeekday: (from, targetWd) => {
    const wd = from.getDay();
    let delta = (targetWd - wd + 7) % 7;
    if (delta === 0) delta = 7;
    return utils.addDays(from, delta);
  },
  
  formatDateLong: (date) => {
    return `${date.getDate()}. ${LOOKUP_TABLES.monthNames[date.getMonth()]} ${date.getFullYear()}`;
  },
  
  wordToNum: (word) => {
    if (!isValidString(word)) return null;
    const normalized = word.toLowerCase()
      .normalize("NFD")
      .replace(REGEX.accent, "")
      .replace(REGEX.ordinalSuffix, "");
    return LOOKUP_TABLES.numberWords.get(normalized) || null;
  },
  
  calculateNights: (checkin, checkout) => {
    const a = new Date(checkin + "T00:00:00Z");
    const b = new Date(checkout + "T00:00:00Z");
    return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
  }
};

/* -------------------- Enhanced Date Parsing -------------------- */
const parseDayMonthWords = (text) => {
  const parts = text.trim().split(REGEX.whitespace);
  if (parts.length < 2) return null;
  
  const d = utils.wordToNum(parts[0]);
  if (!d || d < 1 || d > 31) return null;
  
  const monthKey = parts[1].replace(REGEX.trailingDot, "");
  const normalized = utils.normalizeText(monthKey);
  
  let m = LOOKUP_TABLES.monthsDE.get(normalized.slice(0, 3)) || 
          LOOKUP_TABLES.monthsDE.get(normalized) || 
          LOOKUP_TABLES.monthsDE.get(monthKey);
  
  if (m) return { d, m, needsConfirm: false };
  
  const mNum = utils.wordToNum(parts[1]);
  if (mNum && mNum >= 1 && mNum <= 12) {
    return { d, m: mNum, needsConfirm: true };
  }
  
  return null;
};

const parseDateSmart = (raw, type, baseDate = new Date()) => {
  const notes = [];
  let needs_confirmation = false;

  if (!isValidString(raw, 1)) {
    return { 
      ok: false, 
      reason: `${type} fehlt oder ist ungültig`, 
      needs_confirmation: false, 
      notes 
    };
  }

  const s = utils.normalizeText(raw);

  // Relative dates (heute, morgen, übermorgen)
  for (const [key, offset] of LOOKUP_TABLES.relativeDates) {
    if (s.includes(key)) {
      return { 
        ok: true, 
        date: utils.ymd(utils.addDays(baseDate, offset)), 
        needs_confirmation, 
        notes 
      };
    }
  }

  // "in X Tagen" pattern
  const relMatch = s.match(REGEX.relativeDate);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    if (n > 0 && n < 365) {
      return { 
        ok: true, 
        date: utils.ymd(utils.addDays(baseDate, n)), 
        needs_confirmation, 
        notes 
      };
    }
  }

  // Weekday patterns
  const wdMatch = s.match(REGEX.weekdayPattern);
  if (wdMatch) {
    const key = (wdMatch[1] || wdMatch[2] || "").replace(REGEX.trailingDot, "");
    const weekdayNum = LOOKUP_TABLES.weekdaysDE.get(key);
    if (weekdayNum !== undefined) {
      const date = utils.nextWeekday(baseDate, weekdayNum);
      return { 
        ok: true, 
        date: utils.ymd(date), 
        needs_confirmation: true, 
        notes: [...notes, "weekday_inferred"] 
      };
    }
  }

  // ISO date format
  if (REGEX.isoDate.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    if (utils.isValidYmd(y, m, d)) {
      return { 
        ok: true, 
        date: `${y}-${utils.pad2(m)}-${utils.pad2(d)}`, 
        needs_confirmation, 
        notes 
      };
    }
  }

  // European date formats (DD.MM.YYYY, DD-MM-YYYY, DD/MM/YYYY)
  const euroMatch = s.match(REGEX.europeanDate);
  if (euroMatch) {
    let d = parseInt(euroMatch[1], 10);
    let m = parseInt(euroMatch[2], 10);
    let y = euroMatch[3] ? 
      (euroMatch[3].length === 2 ? (2000 + parseInt(euroMatch[3], 10)) : parseInt(euroMatch[3], 10)) : 
      baseDate.getFullYear();

    if (utils.isValidYmd(y, m, d)) {
      let date = `${y}-${utils.pad2(m)}-${utils.pad2(d)}`;
      
      // Auto-adjust year if date is in the past and no year was specified
      if (!euroMatch[3] && date < utils.ymd(baseDate)) {
        y += 1;
        if (utils.isValidYmd(y, m, d)) {
          date = `${y}-${utils.pad2(m)}-${utils.pad2(d)}`;
          notes.push("year_rolled_forward");
          needs_confirmation = true;
        }
      }
      
      return { ok: true, date, needs_confirmation, notes };
    }
  }

  // Long date format (20. Oktober 2025)
  const longMatch = s.match(REGEX.longDatePattern);
  if (longMatch) {
    let d = parseInt(longMatch[1], 10);
    let monthKey = longMatch[2].replace(REGEX.trailingDot, "");
    const normalized = utils.normalizeText(monthKey);
    
    let m = LOOKUP_TABLES.monthsDE.get(normalized.slice(0, 3)) || 
            LOOKUP_TABLES.monthsDE.get(normalized) || 
            LOOKUP_TABLES.monthsDE.get(monthKey);
    let y = longMatch[3] ? parseInt(longMatch[3], 10) : baseDate.getFullYear();

    if (m && utils.isValidYmd(y, m, d)) {
      let date = `${y}-${utils.pad2(m)}-${utils.pad2(d)}`;
      
      if (!longMatch[3] && date < utils.ymd(baseDate)) {
        y += 1;
        if (utils.isValidYmd(y, m, d)) {
          date = `${y}-${utils.pad2(m)}-${utils.pad2(d)}`;
          notes.push("year_rolled_forward");
          needs_confirmation = true;
        }
      }
      
      return { ok: true, date, needs_confirmation, notes };
    }
  }

  // Word-based date parsing (erste März, zweiter April)
  const dmw = parseDayMonthWords(s);
  if (dmw) {
    let y = baseDate.getFullYear();
    let date = `${y}-${utils.pad2(dmw.m)}-${utils.pad2(dmw.d)}`;
    
    if (date < utils.ymd(baseDate)) {
      y += 1;
      if (utils.isValidYmd(y, dmw.m, dmw.d)) {
        date = `${y}-${utils.pad2(dmw.m)}-${utils.pad2(dmw.d)}`;
        dmw.needsConfirm = true;
      }
    }
    
    if (utils.isValidYmd(y, dmw.m, dmw.d)) {
      return { 
        ok: true, 
        date, 
        needs_confirmation: !!dmw.needsConfirm, 
        notes: dmw.needsConfirm ? ["ordinal_or_word_format"] : [] 
      };
    }
  }

  // Fallback to native Date parsing
  const fallbackDate = new Date(s);
  if (!isNaN(fallbackDate) && fallbackDate.getFullYear() > CONFIG.booking.minYear) {
    return { 
      ok: true, 
      date: utils.ymd(fallbackDate), 
      needs_confirmation: true, 
      notes: ["fallback_Date_parse"] 
    };
  }

  return { 
    ok: false, 
    reason: `${type} Format nicht erkannt: "${raw}". Bitte z.B. "22.10.2025" oder "morgen"`, 
    needs_confirmation: false, 
    notes 
  };
};

const normalizeAndCheck = (raw, type, baseDate = new Date()) => {
  const result = parseDateSmart(raw, type, baseDate);
  return {
    valid: result.ok,
    date: result.date || null,
    reason: result.reason || null,
    needs_confirmation: result.needs_confirmation || false,
    notes: result.notes || []
  };
};

/* -------------------- Enhanced Business Logic -------------------- */
const validateBookingRequest = (body) => {
  const errors = [];
  
  const adults = parseInt(body.adults) || 1;
  const children = parseInt(body.children) || 0;
  const totalGuests = adults + children;

  if (!isValidNumber(adults, 1)) {
    errors.push(new ValidationError("Mindestens 1 Erwachsener erforderlich", "adults", body.adults));
  }
  
  if (!isValidNumber(children, 0)) {
    errors.push(new ValidationError("Anzahl Kinder muss eine positive Zahl sein", "children", body.children));
  }
  
  if (totalGuests > CONFIG.booking.maxGuests) {
    errors.push(new ValidationError(`Maximal ${CONFIG.booking.maxGuests} Gäste pro Buchung möglich`, "total_guests", totalGuests));
  }

  return { errors, adults, children, totalGuests };
};

/* -------------------- Enhanced Room Data -------------------- */
const ROOMS_DEMO = Object.freeze([
  { 
    code: "STD", 
    name: "Standard Apartment", 
    rate: 80, 
    description: "Gemütliches Apartment mit Grundausstattung", 
    maxGuests: 2,
    amenities: ["WLAN", "Küche", "TV"]
  },
  { 
    code: "DLX", 
    name: "Deluxe Apartment", 
    rate: 110, 
    description: "Geräumiges Apartment mit gehobener Ausstattung", 
    maxGuests: 3,
    amenities: ["WLAN", "Küche", "TV", "Balkon", "Klimaanlage"]
  },
  { 
    code: "STE", 
    name: "Suite", 
    rate: 150, 
    description: "Luxuriöse Suite mit separatem Wohnbereich", 
    maxGuests: 4,
    amenities: ["WLAN", "Küche", "TV", "Balkon", "Klimaanlage", "Jacuzzi", "Concierge"]
  }
]);

/* -------------------- Health Check -------------------- */
app.get("/healthz", (_req, res) => {
  const healthData = {
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.0.0",
    node: process.version,
    env: CONFIG.server.environment,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: process.memoryUsage(),
    config: {
      maxGuests: CONFIG.booking.maxGuests,
      maxNights: CONFIG.booking.maxNights,
      hasToolSecret: !!CONFIG.secrets.tool
    }
  };
  
  logger.info("Health check requested", healthData);
  res.json(healthData);
});

/* -------------------- Enhanced Business Functions -------------------- */
const computeListRooms = () => {
  const rooms = ROOMS_DEMO.map(r => ({
    code: r.code,
    name: r.name,
    rate: r.rate,
    description: r.description,
    maxGuests: r.maxGuests,
    amenities: r.amenities
  }));
  
  logger.debug("Rooms listed", { count: rooms.length });
  
  return {
    result: {
      count: rooms.length,
      spoken: `Wir haben ${rooms.length} verschiedene Apartment-Typen verfügbar`,
      rooms
    }
  };
};

const computeCheckAvailability = (payload = {}) => {
  const startTime = Date.now();
  
  try {
    // Input validation
    const validation = validateBookingRequest(payload);
    if (validation.errors.length > 0) {
      throw validation.errors[0];
    }

    const { adults, children, totalGuests } = validation;
    const now = new Date();

    let checkin = payload.from_date || null;
    let checkout = payload.to_date || null;

    const meta = {
      parsed_from: null,
      parsed_to: null,
      needs_confirmation: false,
      notes: [],
      input_format: {
        checkin: checkin ? "iso" : "natural_language",
        checkout: checkout ? "iso" : "natural_language"
      },
      processing_time_ms: null
    };

    // Date parsing with enhanced error handling
    if (!checkin && payload.checkin_raw) {
      const parsed = normalizeAndCheck(payload.checkin_raw, "Anreise", now);
      if (!parsed.valid) {
        throw new ValidationError(parsed.reason, "checkin_raw", payload.checkin_raw);
      }
      checkin = parsed.date;
      meta.parsed_from = {
        input: payload.checkin_raw,
        date: parsed.date,
        needs_confirmation: parsed.needs_confirmation,
        notes: parsed.notes
      };
      meta.needs_confirmation ||= parsed.needs_confirmation;
      meta.notes.push(...parsed.notes);
    }

    if (!checkout && payload.checkout_raw) {
      const parsed = normalizeAndCheck(payload.checkout_raw, "Abreise", now);
      if (!parsed.valid) {
        throw new ValidationError(parsed.reason, "checkout_raw", payload.checkout_raw);
      }
      checkout = parsed.date;
      meta.parsed_to = {
        input: payload.checkout_raw,
        date: parsed.date,
        needs_confirmation: parsed.needs_confirmation,
        notes: parsed.notes
      };
      meta.needs_confirmation ||= parsed.needs_confirmation;
      meta.notes.push(...parsed.notes);
    }

    if (!checkin || !checkout) {
      throw new ValidationError("Sowohl Anreise- als auch Abreisedatum sind erforderlich");
    }

    const nights = utils.calculateNights(checkin, checkout);
    const today = utils.ymd(now);

    // Business logic validation
    if (nights <= 0) {
      throw new BusinessLogicError("Das Abreisedatum muss nach dem Anreisedatum liegen", "INVALID_DATE_RANGE");
    }
    
    if (nights > CONFIG.booking.maxNights) {
      throw new BusinessLogicError(`Maximal ${CONFIG.booking.maxNights} Nächte pro Buchung möglich`, "MAX_NIGHTS_EXCEEDED");
    }
    
    if (checkin < today) {
      throw new BusinessLogicError("Das Anreisedatum kann nicht in der Vergangenheit liegen", "CHECKIN_IN_PAST");
    }

    // Room availability check
    const availableRooms = ROOMS_DEMO.filter(r => r.maxGuests >= totalGuests);
    if (availableRooms.length === 0) {
      throw new BusinessLogicError(`Für ${totalGuests} Gäste sind leider keine Apartments verfügbar`, "NO_ROOMS_AVAILABLE");
    }

    // Enhanced room data with pricing
    const roomsWithPrices = availableRooms.map(room => ({
      ...room,
      pricePerNight: room.rate,
      totalPrice: room.rate * nights,
      currency: "EUR",
      savings: nights >= 7 ? Math.round(room.rate * nights * 0.1) : 0 // 10% discount for week+ stays
    }));

    const checkinFormatted = utils.formatDateLong(new Date(checkin));
    const checkoutFormatted = utils.formatDateLong(new Date(checkout));

    meta.processing_time_ms = Date.now() - startTime;

    const result = {
      checkin,
      checkout,
      checkin_formatted: checkinFormatted,
      checkout_formatted: checkoutFormatted,
      nights,
      adults,
      children,
      total_guests: totalGuests,
      available_rooms: roomsWithPrices,
      spoken: `Für ${nights} ${nights === 1 ? "Nacht" : "Nächte"} vom ${checkinFormatted} bis ${checkoutFormatted} haben wir ${roomsWithPrices.length} Apartments für ${totalGuests} ${totalGuests === 1 ? "Gast" : "Gäste"} verfügbar.`,
      booking_summary: {
        period: `${checkinFormatted} - ${checkoutFormatted}`,
        duration: `${nights} ${nights === 1 ? "Nacht" : "Nächte"}`,
        guests: `${adults} ${adults === 1 ? "Erwachsener" : "Erwachsene"}${children ? `, ${children} ${children === 1 ? "Kind" : "Kinder"}` : ""}`
      }
    };

    logger.info("Availability check completed", {
      checkin,
      checkout,
      nights,
      totalGuests,
      availableRooms: roomsWithPrices.length,
      processingTime: meta.processing_time_ms
    });

    return { result, meta };

  } catch (error) {
    logger.error("Availability check failed", error, { 
      payload, 
      processingTime: Date.now() - startTime 
    });
    throw error;
  }
};

/* -------------------- Enhanced Routes -------------------- */
app.post("/retell/public/check_availability", (req, res, next) => {
  try {
    const result = computeCheckAvailability(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/retell/tool/list_rooms", (req, res, next) => {
  try {
    const result = computeListRooms();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/retell/tool/check_availability", (req, res, next) => {
  try {
    const result = computeCheckAvailability(req.body);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* -------------------- Enhanced 404 Handler -------------------- */
app.use("*", (req, res) => {
  logger.info("404 - Route not found", { 
    method: req.method, 
    path: req.path, 
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    available_endpoints: [
      "GET  /healthz",
      "POST /retell/public/check_availability",
      "POST /retell/tool/list_rooms",
      "POST /retell/tool/check_availability"
    ],
    documentation: "See server logs for request details"
  });
});

/* -------------------- Enhanced Error Handler -------------------- */
app.use((err, req, res, _next) => {
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.error(`Request failed [${errorId}]`, err, {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers,
    ip: req.ip
  });

  // JSON parse errors
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid JSON body",
      details: "Bitte überprüfen Sie das JSON-Format",
      errorId
    });
  }

  // Validation errors
  if (err instanceof ValidationError) {
    return res.status(err.status).json({
      error: err.message,
      field: err.field,
      value: err.value,
      type: "ValidationError",
      errorId
    });
  }

  // Business logic errors
  if (err instanceof BusinessLogicError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      type: "BusinessLogicError",
      errorId
    });
  }

  // Known errors with status
  if (err.status && err.message) {
    return res.status(err.status).json({
      error: err.message,
      errorId
    });
  }

  // Unknown errors
  return res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : "An unexpected error occurred",
    errorId
  });
});

/* -------------------- Enhanced Server Startup -------------------- */
const server = app.listen(CONFIG.server.port, () => {
  logger.info("Server started successfully", {
    port: CONFIG.server.port,
    environment: CONFIG.server.environment,
    nodeVersion: process.version,
    hasToolSecret: !!CONFIG.secrets.tool,
    maxGuests: CONFIG.booking.maxGuests,
    maxNights: CONFIG.booking.maxNights
  });
  
  console.log(`🏨 Retell Hotel Agent Backend v2.0.0 running on port ${CONFIG.server.port}`);
  console.log(`📊 Health check: http://localhost:${CONFIG.server.port}/healthz`);
  console.log(`🔐 Tool secret configured: ${!!CONFIG.secrets.tool}`);
  console.log(`🌍 Environment: ${CONFIG.server.environment}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  server.close(() => {
    logger.info("Server closed");
    process.exit(0);
  });
});

export default app;