// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const TOOL_SECRET = process.env.TOOL_SECRET || "";

// Parsers für JSON & x-www-form-urlencoded
app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"] }));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

/* ---------- Utils ---------- */
const toDate = (s) => new Date(s);
const nightsBetween = (a, b) => {
  const ms = toDate(a) && toDate(b) ? (toDate(b) - toDate(a)) : NaN;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : 0;
};
const euro = (n) => Math.round(n * 100) / 100;

// Monatsnamen (de) inkl. Abkürzungen & Umlaute
const MONTHS_DE = {
  januar:1, jan:1,
  februar:2, feb:2,
  maerz:3, märz:3, mrz:3, mar:3,
  april:4, apr:4,
  mai:5,
  juni:6, jun:6,
  juli:7, jul:7,
  august:8, aug:8,
  september:9, sep:9, sept:9,
  oktober:10, okt:10, oct:10,
  november:11, nov:11,
  dezember:12, dez:12, dec:12
};
const normalize = (s="") => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss");

// flexibles Datums-Parsing: ISO, dd.mm(.yyyy), dd/mm(/yyyy), dd. <Monat>(.yyyy), „heute/morgen“
const parseDateAny = (input) => {
  if (!input) return null;
  const str = String(input).trim();

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // dd.mm(.yyyy)
  let m = str.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
  if (m) {
    const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : (new Date()).getFullYear();
    if (y < 100) y = 2000 + y;
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : dt.toISOString().slice(0,10);
  }

  // dd/mm(/yyyy)
  m = str.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (m) {
    const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : (new Date()).getFullYear();
    if (y < 100) y = 2000 + y;
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : dt.toISOString().slice(0,10);
  }

  // dd. <Monat> (.yyyy)
  const n = normalize(str);
  m = n.match(/^(\d{1,2})\.\s*([a-z]+)(?:\s*(\d{2,4}))?$/);
  if (m) {
    const d = +m[1]; const monKey = m[2]; let y = m[3] ? +m[3] : (new Date()).getFullYear();
    if (y < 100) y = 2000 + y;
    const mo = MONTHS_DE[monKey];
    if (mo) {
      const dt = new Date(y, mo - 1, d);
      return isNaN(dt) ? null : dt.toISOString().slice(0,10);
    }
  }

  // natürlichsprachlich: heute / morgen
  if (n.includes("heute")) {
    const dt = new Date(); return dt.toISOString().slice(0,10);
  }
  if (n.includes("morgen")) {
    const dt = new Date(); dt.setDate(dt.getDate() + 1); return dt.toISOString().slice(0,10);
  }

  // Fallback: Date-Parser
  const dt = new Date(str);
  return isNaN(dt) ? null : dt.toISOString().slice(0,10);
};

const coerceInt = (v, def=0) => {
  if (v === null || v === undefined) return def;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : def;
};

/* ---------- Auth for /retell/tool/* ---------- */
const requireToolSecret = (req, res, next) => {
  const got = req.header("tool-secret");
  if (!TOOL_SECRET || got !== TOOL_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
};

/* ---------- Health ---------- */
app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.4.0",
    node: process.version,
    env: "render",
    timestamp: new Date().toISOString(),
    config: { maxGuests: 10, maxNights: 30, hasToolSecret: !!TOOL_SECRET }
  });
});

/* ---------- Public: extract_core (robust) ---------- */
app.post("/retell/public/extract_core", (req, res) => {
  try {
    const b = req.body || {};

    // Sammle mögliche Felder (versch. Retell-Varianten)
    const utterance =
      b.utterance || b.text || b.message || b.query ||
      b.user_text || b.userMessage ||
      (b.input && (b.input.utterance || b.input.text || b.input.message)) ||
      (b.arguments && (b.arguments.utterance || b.arguments.text)) ||
      "";

    const raw = String(utterance || "");
    const t = normalize(raw);

    // Datumssuche: dd.mm(.yyyy), dd/mm(/yyyy), dd. <monat> (.yyyy)
    const dateTokens = [];

    // dd.mm(.yyyy)
    for (const m of raw.matchAll(/(\b\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g)) {
      const [_, d, mo, y] = m;
      dateTokens.push(parseDateAny(`${d}.${mo}.${y || ""}`.trim()));
    }
    // dd/mm(/yyyy)
    for (const m of raw.matchAll(/(\b\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/g)) {
      const [_, d, mo, y] = m;
      dateTokens.push(parseDateAny(`${d}/${mo}/${y || ""}`.trim()));
    }
    // dd. <Monat> (.yyyy)
    const monRegex = new RegExp(String.raw`(\b\d{1,2})\.\s*(${Object.keys(MONTHS_DE).join("|")})(?:\s*(\d{2,4}))?`, "gi");
    for (const m of raw.matchAll(monRegex)) {
      const [_, d, mon, y] = m;
      dateTokens.push(parseDateAny(`${d}. ${mon} ${y || ""}`.trim()));
    }

    // Duos extrahieren (erste zwei Werte)
    const dates = dateTokens.filter(Boolean);
    let check_in  = dates[0] || null;
    let check_out = dates[1] || null;

    // Erwachsene / Kinder
    let adults = 1, children = 0;

    const adultsNum = t.match(/(\d+)\s*(erwachsene|erwachsener|personen|person)\b/);
    if (adultsNum) adults = coerceInt(adultsNum[1], 1);
    else if (/\bein(e|en)?\s*person\b/.test(t) || /\bein(e|en)?\s*erwachsene(r)?\b/.test(t)) adults = 1;

    const kidsNum = t.match(/(\d+)\s*(kind|kinder)\b/);
    if (kidsNum) children = coerceInt(kidsNum[1], 0);
    if (/\bkeine\s*kinder\b|\bohne\s*kinder\b/.test(t)) children = 0;

    return res.json({ ok: true, check_in, check_out, adults, children, raw: raw || null });
  } catch (e) {
    return res.status(200).json({ ok: false, error: "parse_error" });
  }
});

/* ---------- Tool: availability (SLIM, robust) ---------- */
app.post("/retell/tool/check_availability_slim", requireToolSecret, (req, res) => {
  try {
    const b = req.body || {};

    // nehme bevorzugt exakt benannte Felder, sonst Aliasse
    const from_date = parseDateAny(b.from_date || b.check_in || b.start || b.start_date);
    const to_date   = parseDateAny(b.to_date   || b.check_out || b.end   || b.end_date);
    const adults    = coerceInt(b.adults ?? b.adult ?? b.guests, 2);
    const children  = coerceInt(b.children ?? b.kids, 0);

    if (!from_date || !to_date) {
      return res.status(200).json({
        ok: false,
        code: "MISSING_DATES",
        availability_ok: false,
        nights: 0,
        spoken: "Damit ich prüfen kann, brauche ich An- und Abreisedatum."
      });
    }

    const nights = nightsBetween(from_date, to_date);
    const totalGuests = adults + children;
    const available = nights > 0 && totalGuests <= 4;

    const fmt = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
    const spoken = available
      ? `Für ${nights} Nacht${nights > 1 ? "e" : ""} vom ${fmt(from_date)} bis ${fmt(to_date)} haben wir passende Zimmer verfügbar.`
      : "Für die gewählten Daten ist derzeit nichts frei.";

    return res.json({ ok: true, availability_ok: available, nights, spoken });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      code: "INTERNAL_ERROR",
      availability_ok: false,
      nights: 0,
      spoken: "Es gab ein technisches Problem bei der Prüfung."
    });
  }
});

/* ---------- Public: quote ---------- */
app.post("/retell/public/quote", (req, res) => {
  try {
    const { check_in, check_out, adults = 2, children = 0, board = "frühstück", club_care = false } = req.body || {};
    const nights = nightsBetween(check_in, check_out);
    if (!check_in || !check_out || nights <= 0) {
      return res.status(400).json({ ok: false, error: "invalid dates" });
    }
    const basePerNight = 90;
    const boardAddMap = { "ohne verpflegung": 0, "frühstück": 8, "halbpension": 18, "vollpension": 28 };
    const boardAdd = boardAddMap[String(board).toLowerCase()] ?? 8;
    const clubCareAdd = club_care ? 220 : 0;
    const total_eur = euro(nights * (basePerNight + boardAdd) + clubCareAdd);
    const fx = 48.0;
    const total_try = Math.round(total_eur * fx);

    return res.json({
      ok: true,
      data: { total_eur, total_try, fx, nights, breakdown: { basePerNight, boardAdd, clubCareAdd, board, adults, children } }
    });
  } catch {
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ---------- Tool: commit booking ---------- */
app.post("/retell/tool/commit_booking", requireToolSecret, (req, res) => {
  const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });
  return res.json({
    ok: true,
    data: { booking_id: "bk_" + Date.now(), email, check_in, check_out, adults, children, board, club_care: !!club_care }
  });
});

/* ---------- Tool: send offer ---------- */
app.post("/retell/tool/send_offer", requireToolSecret, (req, res) => {
  const { email, quote_eur, quote_try, fx, details } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });
  return res.json({
    ok: true,
    data: { sent: true, to: email, subject: "Ihr Angebot – Erendiz Hotel", preview: `Gesamt: €${quote_eur} (~₺${quote_try} @ ${fx})`, details }
  });
});

/* ---------- Start ---------- */
app.listen(PORT, () => { console.log(`[retell-agent] listening on :${PORT}`); });
