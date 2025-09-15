// server.js — Retell Hotel Agent Backend (Optimized & Fixed Order)
//
// - Public:  POST /retell/public/check_availability   (kein Secret, für Retell-Flow)
// - Secure:  POST /retell/tool/check_availability     (mit tool-secret)
//            POST /retell/tool/list_rooms             (mit tool-secret)
// - Robuste DE-Datumserkennung (inkl. Zahlwörter), Sanity-Checks, ISO-CANON.
// - Einheitliche JSON-Fehlerausgaben (Error-Handler nun am ENDE!)
// - Secret-Check deckt "/retell/tool" UND "/retell/tool/*" ab.
//
// Start lokal:  TOOL_SECRET=MYSECRET123 node server.js
// Health:       curl -s http://localhost:10000/healthz

import express from "express";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);

/* -------------------- JSON-Parser -------------------- */
app.use(express.json({ limit: "100kb", strict: true }));

/* -------------------- Secret für /retell/tool[/*] --- */
const TOOL_SECRET = (process.env.TOOL_SECRET || process.env.TOOLSECRET || "").trim();
function checkSecret(req, res, next) {
  // WICHTIG: deckt "/retell/tool" und "/retell/tool/..." ab
  if (req.path === "/retell/tool" || req.path.startsWith("/retell/tool/")) {
    const incoming = (req.headers["tool-secret"] || "").toString().trim();
    if (!TOOL_SECRET || incoming !== TOOL_SECRET) {
      return res.status(401).json({
        error: "Unauthorized",
        details: "Invalid or missing tool-secret header"
      });
    }
  }
  next();
}
app.use(checkSecret);

/* -------------------- Health ------------------------- */
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "1.1.1",
    node: process.version,
    env: process.env.RENDER ? "render" : "local",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/* -------------------- Datum-Utilities ---------------- */
const MONTHS_DE = Object.freeze({
  jan: 1, jän: 1, januar: 1,
  feb: 2, februar: 2,
  mar: 3, mär: 3, mrz: 3, maerz: 3, märz: 3,
  apr: 4, april: 4,
  mai: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10,
  nov: 11, november: 11,
  dez: 12, dezember: 12, december: 12
});

const WEEKDAYS_DE = Object.freeze({
  sonntag: 0, so: 0, "so.": 0,
  montag: 1, mo: 1, "mo.": 1,
  dienstag: 2, di: 2, "di.": 2,
  mittwoch: 3, mi: 3, "mi.": 3,
  donnerstag: 4, do: 4, "do.": 4,
  freitag: 5, fr: 5, "fr.": 5,
  samstag: 6, sa: 6, "sa.": 6, sonnabend: 6
});

const NUM_WORDS = Object.freeze({
  "eins":1,"eine":1,"einen":1,"einem":1,"einer":1,"ein":1,
  "zwei":2,"drei":3,"vier":4,"fünf":5,"funf":5,"sechs":6,"sieben":7,"acht":8,"neun":9,"zehn":10,
  "elf":11,"zwölf":12,"zwolf":12,"dreizehn":13,"vierzehn":14,"fünfzehn":15,"funfzehn":15,
  "sechzehn":16,"siebzehn":17,"achtzehn":18,"neunzehn":19,"zwanzig":20,
  "einundzwanzig":21,"zweiundzwanzig":22,"dreiundzwanzig":23,"vierundzwanzig":24,"fünfundzwanzig":25,"funfundzwanzig":25,
  "sechsundzwanzig":26,"siebenundzwanzig":27,"achtundzwanzig":28,"neunundzwanzig":29,
  "dreißig":30,"dreissig":30,"einunddreißig":31,"einunddreissig":31
});
const ORD_SUFFIX_REGEX = /(?:ste|sten|ster|stes|te|ten|ter|tes)$/;

const pad2 = (n) => String(n).padStart(2, "0");
function isValidYmd(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}
function addDays(date, n) { const r = new Date(date); r.setDate(r.getDate() + n); return r; }
function ymd(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`; }
function nextWeekday(from, targetWd) {
  const wd = from.getDay();
  let delta = (targetWd - wd + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(from, delta);
}
function formatDateLong(date) {
  const months = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
  return `${date.getDate()}. ${months[date.getMonth()]} ${date.getFullYear()}`;
}
function wordToNum(word) {
  if (!word) return null;
  let s = word.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(ORD_SUFFIX_REGEX,"");
  return NUM_WORDS[s] ?? null;
}
function parseDayMonthWords(text) {
  const parts = text.trim().toLowerCase().split(/\s+/);
  if (parts.length < 2) return null;
  const d = wordToNum(parts[0]);
  if (!d || d < 1 || d > 31) return null;
  const monKey = parts[1].replace(/\.$/,"");
  const norm = monKey.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  let m = MONTHS_DE[norm.slice(0,3)] || MONTHS_DE[norm] || MONTHS_DE[monKey];
  if (m) return { d, m, needsConfirm: false };
  const mNum = wordToNum(parts[1]);
  if (mNum && mNum >= 1 && mNum <= 12) return { d, m: mNum, needsConfirm: true };
  return null;
}

function parseDateSmart(raw, type, baseDate = new Date()) {
  const notes = [];
  let needs_confirmation = false;
  let used_default_year = false;

  if (!raw || typeof raw !== "string") {
    return { ok:false, reason:`${type} fehlt oder ist ungültig`, needs_confirmation:false, notes };
  }

  const s = raw.trim().toLowerCase()
    .replace(/\s+/g," ")
    .replace(/ae/g,"ä").replace(/oe/g,"ö").replace(/ue/g,"ü");

  // heute / morgen / übermorgen
  const relMap = { "heute":0, "morgen":1, "übermorgen":2, "uebermorgen":2 };
  for (const [k,off] of Object.entries(relMap)) {
    if (s.includes(k)) return { ok:true, date: ymd(addDays(baseDate, off)), needs_confirmation, notes };
  }

  // in X Tagen
  const rel = s.match(/in\s+(\d{1,2})\s*tag(?:e|en)?/);
  if (rel) {
    const n = +rel[1]; if (n>0 && n<365) return { ok:true, date: ymd(addDays(baseDate, n)), needs_confirmation, notes };
  }

  // Wochentage
  const wd = s.match(/(?:nächsten|kommenden|am)\s+([a-zäöüß.]+)|^([a-zäöüß.]+)$/);
  if (wd) {
    const key = (wd[1] || wd[2] || "").replace(/\.$/,"");
    if (typeof WEEKDAYS_DE[key] === "number") {
      const d = nextWeekday(baseDate, WEEKDAYS_DE[key]);
      return { ok:true, date: ymd(d), needs_confirmation:true, notes:[...notes,"weekday_inferred"] };
    }
  }

  // ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y,m,d] = s.split("-").map(Number);
    if (isValidYmd(y,m,d)) return { ok:true, date:`${y}-${pad2(m)}-${pad2(d)}`, needs_confirmation, notes };
  }

  // DD.MM(.YYYY) / DD-MM(-YYYY) / DD/MM(/YYYY), optionaler Schluss-Punkt
  const m1 = s.match(/^(\d{1,2})[.\-/]\s*(\d{1,2})(?:[.\-/]\s*(\d{2,4}))?\s*\.?$/);
  if (m1) {
    let d = +m1[1], m = +m1[2];
    let y = m1[3] ? +(m1[3].length===2 ? ("20"+m1[3]) : m1[3]) : baseDate.getFullYear();
    if (isValidYmd(y,m,d)) {
      let date = `${y}-${pad2(m)}-${pad2(d)}`;
      if (!m1[3] && date < ymd(baseDate)) { // Jahr ergänzt & Vergangenheit → nächstes Jahr
        y += 1;
        if (isValidYmd(y,m,d)) { date = `${y}-${pad2(m)}-${pad2(d)}`; notes.push("year_rolled_forward"); needs_confirmation = true; }
      }
      return { ok:true, date, needs_confirmation, notes };
    }
  }

  // 20. Oktober (2025)
  const m2 = s.match(/^(\d{1,2})\.?\s+([a-zäöüß.]+)(?:\s+(\d{4}))?$/i);
  if (m2) {
    let d = +m2[1], monKey = m2[2].replace(/\.$/,"");
    const norm = monKey.normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let m = MONTHS_DE[norm.slice(0,3)] || MONTHS_DE[norm] || MONTHS_DE[monKey];
    let y = m2[3] ? +m2[3] : baseDate.getFullYear();
    if (m && isValidYmd(y,m,d)) {
      let date = `${y}-${pad2(m)}-${pad2(d)}`;
      if (!m2[3] && date < ymd(baseDate)) {
        y += 1;
        if (isValidYmd(y,m,d)) { date = `${y}-${pad2(m)}-${pad2(d)}`; notes.push("year_rolled_forward"); needs_confirmation = true; }
      }
      return { ok:true, date, needs_confirmation, notes };
    }
  }

  // Zahlwörter / Ordinalformen
  const dmw = parseDayMonthWords(s);
  if (dmw) {
    let y = baseDate.getFullYear();
    let date = `${y}-${pad2(dmw.m)}-${pad2(dmw.d)}`;
    if (date < ymd(baseDate)) { y += 1; if (isValidYmd(y,dmw.m,dmw.d)) { date = `${y}-${pad2(dmw.m)}-${pad2(dmw.d)}`; dmw.needsConfirm = true; } }
    if (isValidYmd(y,dmw.m,dmw.d)) return { ok:true, date, needs_confirmation:!!dmw.needsConfirm, notes: dmw.needsConfirm ? ["ordinal_or_word_format"] : [] };
  }

  // Fallback
  const tryDate = new Date(s);
  if (!isNaN(tryDate) && tryDate.getFullYear() > 1900) {
    return { ok:true, date: ymd(tryDate), needs_confirmation:true, notes:["fallback_Date_parse"] };
  }

  return { ok:false, reason:`${type} Format nicht erkannt: "${raw}". Bitte z.B. "22.10.2025" oder "morgen"`, needs_confirmation:false, notes };
}

function normalizeAndCheck(raw, type, baseDate = new Date()) {
  const p = parseDateSmart(raw, type, baseDate);
  if (!p.ok) return { valid:false, reason:p.reason, needs_confirmation:false, notes:p.notes||[] };
  return { valid:true, date:p.date, needs_confirmation:p.needs_confirmation, notes:p.notes||[] };
}

function calculateNights(a, b) {
  const A = new Date(a + "T00:00:00Z");
  const B = new Date(b + "T00:00:00Z");
  return Math.max(0, Math.round((B - A) / (1000*60*60*24)));
}

/* -------------------- Demo-Daten -------------------- */
const ROOMS_DEMO = Object.freeze([
  { code:"STD", name:"Standard Apartment", rate:80,  description:"Gemütliches Apartment mit Grundausstattung",  maxGuests:2 },
  { code:"DLX", name:"Deluxe Apartment",   rate:110, description:"Geräumiges Apartment mit gehobener Ausstattung", maxGuests:3 },
  { code:"STE", name:"Suite",              rate:150, description:"Luxuriöse Suite mit separatem Wohnbereich",      maxGuests:4 }
]);

/* -------------------- Geschäftslogik --------------- */
function computeListRooms() {
  const rooms = ROOMS_DEMO.map(r => ({ code:r.code, name:r.name, rate:r.rate, description:r.description, maxGuests:r.maxGuests }));
  return { result: { count: rooms.length, spoken: `Wir haben ${rooms.length} verschiedene Apartment-Typen verfügbar`, rooms } };
}

function computeCheckAvailability(payload) {
  const body = payload || {};
  const now = new Date();

  const adults = Number.parseInt(body.adults) || 1;
  const children = Number.parseInt(body.children) || 0;
  const totalGuests = adults + children;
  if (adults < 1) { const e = new Error("Mindestens 1 Erwachsener erforderlich"); e.status = 400; throw e; }
  if (totalGuests > 10) { const e = new Error("Maximal 10 Gäste pro Buchung möglich"); e.status = 400; throw e; }

  let checkin = body.from_date || null;
  let checkout = body.to_date || null;

  const meta = {
    parsed_from: null,
    parsed_to: null,
    needs_confirmation: false,
    notes: [],
    input_format: {
      checkin: checkin ? "iso" : "natural_language",
      checkout: checkout ? "iso" : "natural_language"
    }
  };

  if (!checkin && body.checkin_raw) {
    const p = normalizeAndCheck(body.checkin_raw, "Anreise", now);
    if (!p.valid) { const e = new Error(p.reason); e.status = 400; throw e; }
    checkin = p.date; meta.parsed_from = { input: body.checkin_raw, date: p.date, needs_confirmation: p.needs_confirmation, notes: p.notes };
    meta.needs_confirmation ||= p.needs_confirmation; meta.notes.push(...p.notes);
  }
  if (!checkout && body.checkout_raw) {
    const p = normalizeAndCheck(body.checkout_raw, "Abreise", now);
    if (!p.valid) { const e = new Error(p.reason); e.status = 400; throw e; }
    checkout = p.date; meta.parsed_to = { input: body.checkout_raw, date: p.date, needs_confirmation: p.needs_confirmation, notes: p.notes };
    meta.needs_confirmation ||= p.needs_confirmation; meta.notes.push(...p.notes);
  }

  if (!checkin || !checkout) { const e = new Error("Sowohl Anreise- als auch Abreisedatum sind erforderlich"); e.status = 400; throw e; }

  const nights = calculateNights(checkin, checkout);
  if (nights <= 0) { const e = new Error("Das Abreisedatum muss nach dem Anreisedatum liegen"); e.status = 400; throw e; }
  if (nights > 30) { const e = new Error("Maximal 30 Nächte pro Buchung möglich"); e.status = 400; throw e; }

  const today = ymd(now);
  if (checkin < today) { const e = new Error("Das Anreisedatum kann nicht in der Vergangenheit liegen"); e.status = 400; throw e; }

  const available = ROOMS_DEMO.filter(r => r.maxGuests >= totalGuests);
  if (!available.length) { const e = new Error(`Für ${totalGuests} Gäste sind leider keine Apartments verfügbar`); e.status = 400; throw e; }

  const roomsWithPrices = available.map(r => ({ ...r, pricePerNight: r.rate, totalPrice: r.rate * nights, currency: "EUR" }));

  const checkinLong = formatDateLong(new Date(checkin));
  const checkoutLong = formatDateLong(new Date(checkout));

  return {
    result: {
      checkin, checkout,
      checkin_formatted: checkinLong,
      checkout_formatted: checkoutLong,
      nights, adults, children, total_guests: totalGuests,
      available_rooms: roomsWithPrices,
      spoken: `Für ${nights} ${nights === 1 ? "Nacht" : "Nächte"} vom ${checkinLong} bis ${checkoutLong} haben wir ${roomsWithPrices.length} Apartments für ${totalGuests} ${totalGuests === 1 ? "Gast" : "Gäste"} verfügbar.`,
      booking_summary: {
        period: `${checkinLong} - ${checkoutLong}`,
        duration: `${nights} ${nights === 1 ? "Nacht" : "Nächte"}`,
        guests: `${adults} ${adults === 1 ? "Erwachsener" : "Erwachsene"}${children ? `, ${children} ${children === 1 ? "Kind" : "Kinder"}` : ""}`
      }
    },
    meta
  };
}

/* -------------------- Routes ------------------------ */
app.post("/retell/public/check_availability", (req, res, next) => {
  try { res.json(computeCheckAvailability(req.body)); }
  catch (err) { next(err); }
});
app.post("/retell/tool/list_rooms", (req, res, next) => {
  try { res.json(computeListRooms()); }
  catch (err) { next(err); }
});
app.post("/retell/tool/check_availability", (req, res, next) => {
  try { res.json(computeCheckAvailability(req.body)); }
  catch (err) { next(err); }
});

// (Optional) Wenn du später einen Dispatcher willst:
// app.post("/retell/tool", (req, res, next) => {
//   try {
//     const { name, arguments: args = {} } = req.body || {};
//     if (name === "list_rooms") return res.json(computeListRooms());
//     if (name === "check_availability") return res.json(computeCheckAvailability(args));
//     return res.status(400).json({ error: "unknown tool" });
//   } catch (err) { next(err); }
// });

/* -------------------- Catch-all 404 ----------------- */
app.use("*", (_req, res) => {
  res.status(404).json({
    error: "Route not found",
    available_endpoints: [
      "GET  /healthz",
      "POST /retell/public/check_availability",
      "POST /retell/tool/list_rooms",
      "POST /retell/tool/check_availability"
      // "POST /retell/tool" (wenn Dispatcher aktiv)
    ]
  });
});

/* -------------------- ERROR-HANDLER (am ENDE!) ----- */
app.use((err, req, res, _next) => {
  console.error(`❌ Error ${req.method} ${req.path}:`, err && (err.stack || err.message || err));
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body", details: "Bitte überprüfen Sie das JSON-Format" });
  }
  if (err.status && err.message) {
    return res.status(err.status).json({ error: err.message });
  }
  return res.status(500).json({ error: "Internal server error" });
});

/* -------------------- Start ------------------------- */
app.listen(PORT, () => {
  console.log(`🏨 Retell Hotel Agent Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/healthz`);
  console.log(`🔐 Tool secret configured: ${!!TOOL_SECRET}`);
  console.log(`🌍 Environment: ${process.env.RENDER ? "Render" : "Local"}`);
});
