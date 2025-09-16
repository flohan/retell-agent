// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const TOOL_SECRET = process.env.TOOL_SECRET || "";

app.use(cors({ origin: "*", methods: ["GET","POST","OPTIONS"] }));
app.use(express.json({ limit: "200kb" }));

/* ---------- Utils ---------- */
const toDate = (s) => new Date(s);
const nightsBetween = (a, b) => {
  const ms = toDate(b) - toDate(a);
  return Math.max(0, Math.ceil(ms / 86400000));
};
const euro = (n) => Math.round(n * 100) / 100;

/* ---------- Auth for /retell/tool/* ---------- */
const requireToolSecret = (req, res, next) => {
  const got = req.header("tool-secret");
  if (!TOOL_SECRET || got !== TOOL_SECRET) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
};

/* ---------- Health ---------- */
app.get("/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "Retell Hotel Agent Backend",
    version: "2.3.0",
    node: process.version,
    env: "render",
    timestamp: new Date().toISOString(),
    config: { maxGuests: 10, maxNights: 30, hasToolSecret: !!TOOL_SECRET }
  });
});

/* ---------- Public: extract_core (robust: akzeptiert mehrere Feldnamen) ---------- */
app.post("/retell/public/extract_core", (req, res) => {
  try {
    const b = req.body || {};
    const utterance =
      b.utterance || b.text || b.message || b.query || b.user_text || b.userMessage || "";

    const text = String(utterance || "").toLowerCase();

    // Datumsparser: dd.mm. oder dd.mm.yyyy
    const dateRe = /(\b\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/g;
    const found = [...text.matchAll(dateRe)].map(m => {
      const d = parseInt(m[1],10), mo = parseInt(m[2],10), y = m[3] ? parseInt(m[3],10) : (new Date()).getFullYear();
      const year = y < 100 ? 2000 + y : y;
      return new Date(year, mo - 1, d).toISOString().slice(0,10);
    });
    const check_in  = found[0] || null;
    const check_out = found[1] || null;

    // Erwachsene / Kinder
    const oneAdultRe = /(1\s*(erwachsene|erwachsener|person))/;
    const adultsRe   = /(\d+)\s*(erwachsene|erwachsener|personen)/;
    const kidsRe     = /(\d+)\s*(kind|kinder)/;

    let adults = 1;
    if (adultsRe.test(text))   adults = parseInt(text.match(adultsRe)[1],10);
    else if (oneAdultRe.test(text)) adults = 1;

    let children = 0;
    if (kidsRe.test(text)) children = parseInt(text.match(kidsRe)[1],10);
    if (/keine kinder|ohne kinder|keine\s*kinder/.test(text)) children = 0;

    return res.json({ ok: true, check_in, check_out, adults, children, raw: utterance || null });
  } catch {
    return res.status(200).json({ ok: false });
  }
});

/* ---------- Tool: availability (SLIM, robust) ---------- */
app.post("/retell/tool/check_availability_slim", requireToolSecret, (req, res) => {
  try {
    const b = req.body || {};
    const toISO = (dmy) => {
      if (!dmy) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dmy)) return dmy;
      const m = String(dmy).match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
      if (m) {
        const d = parseInt(m[1],10), mo = parseInt(m[2],10);
        const y = m[3] ? parseInt(m[3],10) : (new Date()).getFullYear();
        const year = y < 100 ? 2000 + y : y;
        const dt = new Date(year, mo - 1, d);
        return dt.toISOString().slice(0,10);
      }
      const dt = new Date(dmy);
      return isNaN(dt) ? null : dt.toISOString().slice(0,10);
    };

    const from_date = toISO(b.from_date || b.check_in);
    const to_date   = toISO(b.to_date   || b.check_out);
    const adults    = b.adults ?? 2;
    const children  = b.children ?? 0;

    if (!from_date || !to_date) {
      return res.status(200).json({
        ok: false, code: "MISSING_DATES",
        availability_ok: false, nights: 0,
        spoken: "Damit ich prüfen kann, brauche ich An- und Abreisedatum."
      });
    }

    const nights = Math.max(0, Math.ceil((new Date(to_date) - new Date(from_date)) / 86400000));
    const totalGuests = Number(adults) + Number(children);
    const available = nights > 0 && totalGuests <= 4;

    const fmt = (d) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
    const spoken = available
      ? `Für ${nights} Nacht${nights > 1 ? "e" : ""} vom ${fmt(from_date)} bis ${fmt(to_date)} haben wir passende Zimmer verfügbar.`
      : "Für die gewählten Daten ist derzeit nichts frei.";

    res.json({ ok: true, availability_ok: available, nights, spoken });
  } catch {
    res.status(200).json({
      ok: false, code: "INTERNAL_ERROR",
      availability_ok: false, nights: 0,
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

    res.json({ ok: true, data: { total_eur, total_try, fx, nights,
      breakdown: { basePerNight, boardAdd, clubCareAdd, board, adults, children } } });
  } catch {
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ---------- Tool: commit booking ---------- */
app.post("/retell/tool/commit_booking", requireToolSecret, (req, res) => {
  const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });
  res.json({ ok: true, data: { booking_id: "bk_" + Date.now(), email, check_in, check_out, adults, children, board, club_care: !!club_care } });
});

/* ---------- Tool: send offer ---------- */
app.post("/retell/tool/send_offer", requireToolSecret, (req, res) => {
  const { email, quote_eur, quote_try, fx, details } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });
  res.json({ ok: true, data: { sent: true, to: email, subject: "Ihr Angebot – Erendiz Hotel", preview: `Gesamt: €${quote_eur} (~₺${quote_try} @ ${fx})`, details } });
});

/* ---------- Start ---------- */
app.listen(PORT, () => { console.log(`[retell-agent] listening on :${PORT}`); });
