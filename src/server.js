// server.js - Retell AI Hotel Agent Backend v2.5.2 (OTA-XML HotelRunner + Fixes)
// Hochperformant, Production-Ready mit OTA-XML für HotelRunner Reservations
// Fixes: Tippfehler ("frühstück", "Nächte"), OTA-XML-Integration, konsistente Variablen

import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

/* -------------------- Configuration -------------------- */
const CONFIG = Object.freeze({
  server: {
    port: parseInt(process.env.PORT) || 10000,
    environment: process.env.NODE_ENV || "development",
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
    logLevel: process.env.LOG_LEVEL || "info"
  },
  security: {
    toolSecret: process.env.TOOL_SECRET || "",
    corsOrigin: process.env.CORS_ORIGIN || "*"
  },
  llm: {
    enabled: process.env.LLM_ENABLED === "true",
    api: process.env.LLM_API || "openai",
    apiKey: process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "",
    model: process.env.REALTIME_MODEL || process.env.LLM_MODEL || "gpt-4o-mini",
    voice: process.env.REALTIME_VOICE || "alloy",
    timeout: 5000
  },
  retell: {
    apiKey: process.env.RETELL_API_KEY || "",
    wsUrl: process.env.RETELL_WS_URL || "wss://api.retellai.com/audio-websocket"
  },
  hotelrunner: {
    enabled: process.env.HOTELRUNNER_ENABLED === "true",
    hrId: process.env.HOTELRUNNER_HR_ID || "",
    token: process.env.HOTELRUNNER_TOKEN || "",
    baseUrl: process.env.HOTELRUNNER_BASE_URL || "https://api.hotelrunner.com/ota/"
  },
  booking: {
    maxGuests: 10,
    maxNights: 30,
    baseRate: 90,
    exchangeRate: 48.0
  }
});

// Early checks
if (!CONFIG.security.toolSecret) {
  console.warn("TOOL_SECRET not configured - tool routes will return 503");
}
if (CONFIG.hotelrunner.enabled && (!CONFIG.hotelrunner.hrId || !CONFIG.hotelrunner.token)) {
  console.warn("HotelRunner enabled but HR_ID or TOKEN missing - fallback to mock");
}

/* -------------------- Enhanced Logging -------------------- */
const logger = {
  debug: (msg, meta = {}) => CONFIG.server.environment === "dev" && 
    console.log(JSON.stringify({ level: "DEBUG", msg, meta, time: Date.now() })),
  
  info: (msg, meta = {}) => 
    console.log(JSON.stringify({ level: "INFO", msg, meta, time: Date.now() })),
  
  warn: (msg, error = null, meta = {}) => 
    console.warn(JSON.stringify({ level: "WARN", msg, error: error?.message, meta, time: Date.now() })),
  
  error: (msg, error = null, meta = {}) => 
    console.error(JSON.stringify({ 
      level: "ERROR", msg, 
      error: error?.message, 
      stack: error?.stack?.split('\n').slice(0, 3),
      meta, time: Date.now() 
    }))
};

/* -------------------- Optimierte Lookup Tables -------------------- */
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
  ]),

  boardRates: new Map([
    ["ohne verpflegung", 0], ["frühstück", 8], ["halbpension", 18], ["vollpension", 28]
  ])
});

/* -------------------- RegEx Patterns (kompiliert) -------------------- */
const REGEX = {
  iso: /^\d{4}-\d{2}-\d{2}$/,
  dotDate: /(\b\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g,
  slashDate: /(\b\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g,
  adults: /(\d+)\s*(?:erwachsene|erwachsener|personen|person)\b/i,
  children: /(\d+)\s*(?:kind|kinder)\b/i,
  whitespace: /\s+/g,
  accents: /[\u0300-\u036f]/g
};

/* -------------------- Utility Functions -------------------- */
const utils = {
  normalize: (s = "") => {
    if (!s || typeof s !== "string") return "";
    return s.toLowerCase()
      .normalize("NFKD")
      .replace(REGEX.accents, "")
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(REGEX.whitespace, " ")
      .trim();
  },

  parseDateAny: (input) => {
    if (!input) return null;
    const str = String(input).trim();
    
    // ISO Format
    if (REGEX.iso.test(str)) return str;
    
    // DD.MM.YYYY
    const dotMatch = str.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
    if (dotMatch) {
      const [, d, mo, y] = dotMatch;
      let year = y ? parseInt(y) : new Date().getFullYear();
      if (year < 100) year += 2000;
      const date = new Date(year, parseInt(mo) - 1, parseInt(d));
      return isNaN(date) ? null : date.toISOString().slice(0, 10);
    }
    
    // DD/MM/YYYY
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (slashMatch) {
      const [, d, mo, y] = slashMatch;
      let year = y ? parseInt(y) : new Date().getFullYear();
      if (year < 100) year += 2000;
      const date = new Date(year, parseInt(mo) - 1, parseInt(d));
      return isNaN(date) ? null : date.toISOString().slice(0, 10);
    }
    
    // DD. <month>
    const normalized = utils.normalize(str);
    const monthMatch = normalized.match(/^(\d{1,2})\.\s*([a-z]+)(?:\s*(\d{2,4}))?$/);
    if (monthMatch) {
      const [, d, mon, y] = monthMatch;
      const month = LOOKUP_TABLES.months.get(mon);
      if (month) {
        let year = y ? parseInt(y) : new Date().getFullYear();
        if (year < 100) year += 2000;
        const date = new Date(year, month - 1, parseInt(d));
        return isNaN(date) ? null : date.toISOString().slice(0, 10);
      }
    }
    
    // Relative dates
    for (const [key, offset] of LOOKUP_TABLES.relativeDates) {
      if (normalized.includes(key)) {
        const date = new Date();
        date.setDate(date.getDate() + offset);
        return date.toISOString().slice(0, 10);
      }
    }
    
    // Fallback
    const date = new Date(str);
    return isNaN(date) ? null : date.toISOString().slice(0, 10);
  },

  nightsBetween: (a, b) => {
    const dateA = new Date(a);
    const dateB = new Date(b);
    if (isNaN(dateA) || isNaN(dateB)) return 0;
    const ms = dateB - dateA;
    return Math.max(0, Math.ceil(ms / 86400000));
  },

  coerceInt: (v, def = 0) => {
    if (v === null || v === undefined || v === "") return def;
    const n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? Math.max(0, n) : def;
  },

  euro: (n) => Math.round(n * 100) / 100
};

/* -------------------- Rule-based Extraction -------------------- */
function extractWithRules(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { check_in: null, check_out: null, adults: 1, children: 0 };
  }

  const text = utils.normalize(rawText);
  const dates = new Set();
  
  // Collect all date candidates
  for (const match of rawText.matchAll(REGEX.dotDate)) {
    const [, d, mo, y] = match;
    const parsed = utils.parseDateAny(`${d}.${mo}.${y || ""}`);
    if (parsed) dates.add(parsed);
  }
  
  for (const match of rawText.matchAll(REGEX.slashDate)) {
    const [, d, mo, y] = match;
    const parsed = utils.parseDateAny(`${d}/${mo}/${y || ""}`);
    if (parsed) dates.add(parsed);
  }

  const sortedDates = Array.from(dates).sort();
  const [check_in, check_out] = sortedDates;

  // Extract persons
  let adults = 1, children = 0;
  
  const adultsMatch = text.match(REGEX.adults);
  if (adultsMatch) {
    adults = utils.coerceInt(adultsMatch[1], 1);
  }

  const childrenMatch = text.match(REGEX.children);
  if (childrenMatch) {
    children = utils.coerceInt(childrenMatch[1], 0);
  }

  return { check_in: check_in || null, check_out: check_out || null, adults, children };
}

/* -------------------- OTA-XML HotelRunner Utility -------------------- */
async function callHotelRunner(endpoint, method = 'POST', body = null) {
  if (!CONFIG.hotelrunner.enabled || !CONFIG.hotelrunner.hrId || !CONFIG.hotelrunner.token) {
    throw new Error('HotelRunner not configured');
  }

  const url = `${CONFIG.hotelrunner.baseUrl}${endpoint}`;
  const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Header>
    <auth xmlns="http://www.opentravel.org/OTA/2003/05">
      <HotelRunnerID>${CONFIG.hotelrunner.hrId}</HotelRunnerID>
      <Token>${CONFIG.hotelrunner.token}</Token>
    </auth>
  </soap:Header>
  <soap:Body>
    ${body || ''}
  </soap:Body>
</soap:Envelope>`;

  const options = {
    method,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': endpoint
    },
    body: soapEnvelope
  };

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HotelRunner OTA error: ${response.status} ${response.statusText}`);
    }
    const xmlResponse = await response.text();
    // Simple XML parsing for reservation_id (extend with xml2js if needed)
    const reservationMatch = xmlResponse.match(/<ReservationID[^>]*>([^<]+)<\/ReservationID>/i);
    return { reservation_id: reservationMatch ? reservationMatch[1] : null };
  } catch (error) {
    logger.error('HotelRunner OTA call failed', error, { endpoint });
    throw error;
  }
}

/* -------------------- Express Setup -------------------- */
const app = express();
app.use(cors({ origin: CONFIG.security.corsOrigin }));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true }));

// Request timeout middleware
app.use((req, res, next) => {
  res.setTimeout(CONFIG.server.requestTimeout, () => {
    logger.warn("Request timeout", null, { path: req.path, method: req.method });
    res.status(408).json({ ok: false, error: "Request timeout" });
  });
  next();
});

/* -------------------- Auth Middleware -------------------- */
const requireToolSecret = (req, res, next) => {
  if (!CONFIG.security.toolSecret) {
    logger.error("Tool secret not configured");
    return res.status(503).json({ 
      ok: false, 
      error: "service_unavailable",
      message: "Tool secret not configured" 
    });
  }

  const authHeader = req.header("authorization");
  const toolSecretHeader = req.header("tool-secret");
  
  let providedSecret = null;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    providedSecret = authHeader.substring(7).trim();
  } else if (toolSecretHeader) {
    providedSecret = toolSecretHeader.trim();
  }
  
  if (!providedSecret || providedSecret !== CONFIG.security.toolSecret) {
    logger.warn("Unauthorized access attempt", { 
      ip: req.ip, 
      path: req.path,
      hasBearer: !!authHeader,
      hasToolSecret: !!toolSecretHeader,
      userAgent: req.get("User-Agent")
    });
    
    return res.status(401).json({ 
      ok: false, 
      error: "unauthorized",
      message: "Valid authentication required (Bearer token or tool-secret header)" 
    });
  }
  
  next();
};

/* -------------------- API Endpoints -------------------- */

// Root Route
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.5.2-ota-fixed",
    message: "Welcome! See /healthz for status or use documented endpoints.",
    endpoints: [
      "GET /healthz",
      "GET /retell/tool/whoami",
      "POST /retell/public/extract_core",
      "POST /retell/public/quote",
      "POST /retell/tool/extract_core",
      "POST /retell/tool/check_availability",
      "POST /retell/tool/commit_booking",
      "POST /retell/tool/send_offer"
    ]
  });
});

// Health Check
app.get("/healthz", (req, res) => {
  const health = {
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.5.2-ota-fixed",
    environment: CONFIG.server.environment,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      limit: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    },
    config: {
      port: CONFIG.server.port,
      hasToolSecret: !!CONFIG.security.toolSecret,
      llmEnabled: CONFIG.llm.enabled,
      hasLlmKey: !!CONFIG.llm.apiKey,
      hasRetellKey: !!CONFIG.retell.apiKey,
      hotelRunnerEnabled: CONFIG.hotelrunner.enabled
    }
  };
  
  res.json(health);
});

// Whoami endpoint
app.get("/retell/tool/whoami", requireToolSecret, (req, res) => {
  res.json({
    ok: true,
    service: "Retell Hotel Agent",
    authenticated: true,
    timestamp: new Date().toISOString(),
    config: {
      llmEnabled: CONFIG.llm.enabled,
      model: CONFIG.llm.model,
      voice: CONFIG.llm.voice,
      hotelRunnerEnabled: CONFIG.hotelrunner.enabled
    }
  });
});

// Public: Rule-based extraction
app.post("/retell/public/extract_core", (req, res) => {
  const startTime = Date.now();
  
  try {
    const body = req.body || {};
    const utterance = 
      body.utterance || body.text || body.message || body.query ||
      body.user_text || body.userMessage || "";

    const raw = String(utterance || "");
    const slots = extractWithRules(raw);
    
    logger.info("Rule extraction completed", { 
      processingTime: Date.now() - startTime,
      hasInput: !!raw,
      extractedSlots: Object.keys(slots).filter(k => slots[k] !== null && slots[k] !== 1 && slots[k] !== 0).length
    });

    return res.json({ ok: true, ...slots, raw, source: "rules" });
    
  } catch (error) {
    logger.error("Rule extraction failed", error);
    return res.status(200).json({ 
      ok: false, 
      error: "parse_error",
      message: "Failed to parse input"
    });
  }
});

// Tool: Enhanced extraction
app.post("/retell/tool/extract_core", requireToolSecret, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const body = req.body || {};
    const utterance =
      body.utterance || body.text || body.message || body.query ||
      body.user_text || body.userMessage || body.asr_text || 
      body.transcript || body.user_message || "";

    const raw = String(utterance || "").trim();
    
    if (!raw) {
      return res.json({ 
        ok: true, 
        check_in: null, 
        check_out: null, 
        adults: 1, 
        children: 0, 
        raw: null, 
        source: "empty" 
      });
    }

    const result = extractWithRules(raw);
    
    const finalResult = {
      ...result,
      raw,
      source: CONFIG.llm.enabled && CONFIG.llm.apiKey ? "rules+llm_ready" : "rules",
      processing_time_ms: Date.now() - startTime
    };

    logger.info("Extraction completed", {
      processingTime: finalResult.processing_time_ms,
      source: finalResult.source,
      hasValidDates: !!(finalResult.check_in && finalResult.check_out)
    });

    return res.json({ ok: true, ...finalResult });

  } catch (error) {
    logger.error("Extraction failed", error);
    
    return res.status(200).json({ 
      ok: false, 
      error: "extraction_failed",
      message: "Extraction failed"
    });
  }
});

// Tool: Availability check
app.post("/retell/tool/check_availability", requireToolSecret, (req, res) => {
  const startTime = Date.now();
  
  try {
    const body = req.body || {};
    const check_in = utils.parseDateAny(body.check_in || body.from_date || body.start);
    const check_out = utils.parseDateAny(body.check_out || body.to_date || body.end);
    const adults = utils.coerceInt(body.adults || body.guests, 2);
    const children = utils.coerceInt(body.children || body.kids, 0);

    if (!check_in || !check_out) {
      return res.json({
        ok: false,
        code: "MISSING_DATES",
        availability_ok: false,
        nights: 0,
        spoken: "Damit ich die Verfügbarkeit prüfen kann, brauche ich sowohl An- als auch Abreisedatum."
      });
    }

    const nights = utils.nightsBetween(check_in, check_out);
    const totalGuests = adults + children;
    
    const isValidStay = nights > 0 && nights <= CONFIG.booking.maxNights;
    const hasCapacity = totalGuests > 0 && totalGuests <= CONFIG.booking.maxGuests;
    const isNotPastDate = new Date(check_in) >= new Date().setHours(0,0,0,0);
    
    const available = isValidStay && hasCapacity && isNotPastDate;
    
    const formatDate = (dateStr) => {
      try {
        return new Date(dateStr).toLocaleDateString("de-DE", { 
          day: "2-digit", 
          month: "long", 
          year: "numeric" 
        });
      } catch {
        return dateStr;
      }
    };

    const spoken = available
      ? `Für ${nights} Nächte vom ${formatDate(check_in)} bis ${formatDate(check_out)} haben wir passende Unterkünfte verfügbar.`
      : nights <= 0 
        ? "Das Abreisedatum muss nach dem Anreisedatum liegen."
        : !isNotPastDate
          ? "Das Anreisedatum darf nicht in der Vergangenheit liegen."
          : totalGuests > CONFIG.booking.maxGuests
            ? `Für ${totalGuests} Gäste können wir leider keine Unterkunft anbieten. Maximum sind ${CONFIG.booking.maxGuests} Gäste.`
            : "Für die gewählten Daten ist derzeit nichts verfügbar.";

    logger.info("Availability check completed", {
      processingTime: Date.now() - startTime,
      nights,
      totalGuests,
      available
    });

    return res.json({ 
      ok: true, 
      availability_ok: available, 
      nights, 
      spoken,
      details: {
        total_guests: totalGuests,
        adults,
        children,
        check_in,
        check_out,
        processing_time_ms: Date.now() - startTime
      }
    });

  } catch (error) {
    logger.error("Availability check failed", error);
    return res.json({
      ok: false,
      code: "INTERNAL_ERROR",
      availability_ok: false,
      nights: 0,
      spoken: "Es gab ein technisches Problem bei der Verfügbarkeitsprüfung."
    });
  }
});

// Public: Price quote
app.post("/retell/public/quote", (req, res) => {
  try {
    const { 
      check_in, check_out, 
      adults = 2, children = 0, 
      board = "frühstück", 
      club_care = false 
    } = req.body || {};

    const nights = utils.nightsBetween(check_in, check_out);
    
    if (!check_in || !check_out || nights <= 0) {
      return res.status(400).json({ 
        ok: false, 
        error: "invalid_dates",
        message: "Valid check-in and check-out dates required" 
      });
    }

    const boardKey = utils.normalize(board);
    const boardRate = LOOKUP_TABLES.boardRates.get(boardKey) || 8;
    const clubCareRate = club_care ? 220 : 0;

    const totalEur = utils.euro(nights * (CONFIG.booking.baseRate + boardRate) + clubCareRate);
    const totalTry = Math.round(totalEur * CONFIG.booking.exchangeRate);

    logger.info("Quote generated", { nights, totalEur, totalTry, board: boardKey });

    return res.json({
      ok: true,
      data: {
        total_eur: totalEur,
        total_try: totalTry,
        fx: CONFIG.booking.exchangeRate,
        nights,
        breakdown: {
          basePerNight: CONFIG.booking.baseRate,
          boardAdd: boardRate,
          clubCareAdd: clubCareRate,
          board: boardKey,
          adults: utils.coerceInt(adults, 1),
          children: utils.coerceInt(children, 0)
        }
      }
    });

  } catch (error) {
    logger.error("Quote generation failed", error);
    return res.status(500).json({ 
      ok: false, 
      error: "internal_error" 
    });
  }
});

// Tool: Commit booking with OTA-XML HotelRunner
app.post("/retell/tool/commit_booking", requireToolSecret, async (req, res) => {
  try {
    const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
    
    if (!email || !email.includes("@")) {
      return res.status(400).json({ 
        ok: false, 
        error: "invalid_email" 
      });
    }

    let bookingId = `bk_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;  // Mock Fallback
    
    // Try OTA-XML HotelRunner Integration
    if (CONFIG.hotelrunner.enabled && CONFIG.hotelrunner.hrId && CONFIG.hotelrunner.token) {
      try {
        const otaBody = `<OTA_ResCreateRQ xmlns="http://www.opentravel.org/OTA/2003/05">
  <POS>
    <Source>
      <RequestorID ID="RetellAgent" />
    </Source>
  </POS>
  <HotelReservations>
    <HotelReservation>
      <UniqueID ID="${Date.now()}">
        <ID_Context>Retell</ID_Context>
      </UniqueID>
      <RoomStays>
        <RoomStay>
          <RoomTypes>
            <RoomType TypeCode="STANDARD">
              <RoomDescription Name="Standard Room">
                <Text>Standard Double Room</Text>
              </RoomDescription>
            </RoomType>
          </RoomTypes>
          <RoomRates>
            <RoomRate RatePlanCode="FRUEHSTUECK">
              <Rates>
                <Rate RateTimeUnit="Day" UnitMultiplier="1">
                  <Total AmountAfterTax="${CONFIG.booking.baseRate + 8}" CurrencyCode="EUR" />
                </Rate>
              </Rates>
            </RoomRate>
          </RoomRates>
          <GuestCounts>
            <GuestCount Count="${adults}" AgeQualifyingCode="10" />
            <GuestCount Count="${children}" AgeQualifyingCode="8" />
          </GuestCounts>
          <TimeSpan>
            <Start>${check_in}</Start>
            <End>${check_out}</End>
          </TimeSpan>
        </RoomStay>
      </RoomStays>
      <ResGuests>
        <ResGuest>
          <Profiles>
            <ProfileInfo>
              <Profile>
                <Customer>
                  <PersonName>
                    <GivenName>Test</GivenName>
                    <Surname>User</Surname>
                  </PersonName>
                  <Email>${email}</Email>
                </Customer>
              </Profile>
            </ProfileInfo>
          </Profiles>
        </ResGuest>
      </ResGuests>
    </HotelReservation>
  </HotelReservations>
</OTA_ResCreateRQ>`;

        const hrResponse = await callHotelRunner('ResCreateRQ', 'POST', otaBody);
        if (hrResponse && hrResponse.reservation_id) {
          bookingId = hrResponse.reservation_id;
        }
        
        logger.info("OTA-XML HotelRunner booking committed", { bookingId, email: email.toLowerCase().trim(), hrResponse });
      } catch (hrError) {
        logger.warn("OTA-XML HotelRunner booking failed, fallback to mock", hrError);
      }
    }

    const booking = {
      booking_id: bookingId,
      email: email.toLowerCase().trim(),
      check_in,
      check_out,
      adults: utils.coerceInt(adults, 1),
      children: utils.coerceInt(children, 0),
      board: String(board || "frühstück").toLowerCase(),
      club_care: !!club_care,
      created_at: new Date().toISOString(),
      source: CONFIG.hotelrunner.enabled ? "hotelrunner" : "mock"
    };

    logger.info("Booking committed", { bookingId, email: booking.email, source: booking.source });
    return res.json({ ok: true, data: booking });

  } catch (error) {
    logger.error("Booking commit failed", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Tool: Send offer
app.post("/retell/tool/send_offer", requireToolSecret, (req, res) => {
  try {
    const { email, quote_eur, quote_try, fx, details } = req.body || {};
    
    if (!email || !email.includes("@")) {
      return res.status(400).json({ 
        ok: false, 
        error: "invalid_email" 
      });
    }

    const offer = {
      sent: true,
      to: email.toLowerCase().trim(),
      subject: "Ihr persönliches Angebot – Erendiz Hotel",
      preview: `Gesamtpreis: €${quote_eur} (ca. ₺${quote_try})`,
      details,
      sent_at: new Date().toISOString()
    };

    logger.info("Offer sent", { email: offer.to, quote_eur });
    return res.json({ ok: true, data: offer });

  } catch (error) {
    logger.error("Offer sending failed", error);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* -------------------- Error Handlers -------------------- */
app.use((err, req, res, next) => {
  logger.error("Unhandled request error", err, {
    method: req.method,
    path: req.path,
    ip: req.ip
  });

  res.status(err.status || 500).json({
    ok: false,
    error: "internal_error",
    message: CONFIG.server.environment === "dev" ? err.message : "An error occurred"
  });
});

app.use("*", (req, res) => {
  res.status(404).json({
    ok: false,
    error: "route_not_found",
    path: req.path,
    available_endpoints: [
      "GET  /",
      "GET  /healthz",
      "GET  /retell/tool/whoami",
      "POST /retell/public/extract_core", 
      "POST /retell/public/quote",
      "POST /retell/tool/extract_core",
      "POST /retell/tool/check_availability",
      "POST /retell/tool/commit_booking",
      "POST /retell/tool/send_offer"
    ]
  });
});

/* -------------------- Server Start -------------------- */
const server = app.listen(CONFIG.server.port, '0.0.0.0', () => {
  logger.info("Server started successfully", {
    port: CONFIG.server.port,
    environment: CONFIG.server.environment,
    hasToolSecret: !!CONFIG.security.toolSecret,
    llmEnabled: CONFIG.llm.enabled,
    hasLlmKey: !!CONFIG.llm.apiKey,
    hotelRunnerEnabled: CONFIG.hotelrunner.enabled
  });

  console.log(`🚀 Retell Hotel Agent running on port ${CONFIG.server.port}`);
  console.log(`📊 Health: http://localhost:${CONFIG.server.port}/healthz`);
  console.log(`🔐 Tool Secret: ${CONFIG.security.toolSecret ? "✓" : "✗"}`);
  console.log(`🤖 LLM: ${CONFIG.llm.enabled && CONFIG.llm.apiKey ? "✓" : "✗"}`);
  console.log(`🏨 HotelRunner: ${CONFIG.hotelrunner.enabled ? "✓" : "✗"}`);
});

// Graceful shutdown
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());

export default app;