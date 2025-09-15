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
    version: "2.1.0",
    node: process.version,
    env: "render",
    timestamp: new Date().toISOString(),
    config: { maxGuests: 10, maxNights: 30, hasToolSecret: !!TOOL_SECRET }
  });
});

/* ---------- Tool: list_rooms (optional) ---------- */
app.post("/retell/tool/list_rooms", requireToolSecret, (req, res) => {
  const rooms = [
    { code: "STD", name: "Standard Apartment", maxGuests: 2, rate: 80 },
    { code: "DLX", name: "Deluxe Apartment", maxGuests: 3, rate: 110 },
    { code: "STE", name: "Suite", maxGuests: 4, rate: 150 }
  ];
  res.json({ ok: true, rooms });
});

/* ---------- Tool: availability (voll) ---------- */
app.post("/retell/tool/check_availability", requireToolSecret, (req, res) => {
  try {
    const { from_date, to_date, adults = 2, children = 0 } = req.body || {};
    if (!from_date || !to_date) {
      return res.status(400).json({ ok: false, error: "missing dates" });
    }
    const nights = nightsBetween(from_date, to_date);
    const totalGuests = Number(adults) + Number(children);
    const available = nights > 0 && totalGuests <= 4;

    const fmt = (d) =>
      new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

    const result = {
      checkin: from_date,
      checkout: to_date,
      checkin_formatted: fmt(from_date),
      checkout_formatted: fmt(to_date),
      nights,
      adults: Number(adults),
      children: Number(children),
      total_guests: totalGuests,
      available_rooms: available
        ? [
            { code: "STD", name: "Standard Apartment", rate: 80, maxGuests: 2, pricePerNight: 80, totalPrice: 80 * nights, currency: "EUR" },
            { code: "DLX", name: "Deluxe Apartment", rate: 110, maxGuests: 3, pricePerNight: 110, totalPrice: 110 * nights, currency: "EUR" },
            { code: "STE", name: "Suite", rate: 150, maxGuests: 4, pricePerNight: 150, totalPrice: 150 * nights, currency: "EUR" }
          ]
        : []
    };

    const spoken = available
      ? `Für ${nights} Nacht${nights > 1 ? "e" : ""} vom ${result.checkin_formatted} bis ${result.checkout_formatted} haben wir ${result.available_rooms.length} Apartments für ${totalGuests} Gäste verfügbar.`
      : "Für die gewählten Daten ist derzeit nichts frei.";

    return res.json({
      ok: true,
      result,
      meta: {
        needs_confirmation: false,
        input_format: { checkin: "iso", checkout: "iso" }
      },
      spoken
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ---------- Tool: availability (SLIM für Retell) ---------- */
app.post("/retell/tool/check_availability_slim", requireToolSecret, (req, res) => {
  try {
    const { from_date, to_date, adults = 2, children = 0 } = req.body || {};
    if (!from_date || !to_date) {
      return res.status(400).json({ ok: false, error: "missing dates" });
    }
    const nights = nightsBetween(from_date, to_date);
    const totalGuests = Number(adults) + Number(children);
    const available = nights > 0 && totalGuests <= 4;
    const fmt = (d) =>
      new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });

    const spoken = available
      ? `Für ${nights} Nacht${nights > 1 ? "e" : ""} vom ${fmt(from_date)} bis ${fmt(to_date)} haben wir passende Zimmer verfügbar.`
      : "Für die gewählten Daten ist derzeit nichts frei.";

    res.json({ ok: true, availability_ok: available, nights, spoken });
  } catch {
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ---------- Public: quote (voll) ---------- */
app.post("/retell/public/quote", (req, res) => {
  try {
    const {
      check_in, check_out,
      adults = 2, children = 0,
      board = "frühstück", club_care = false, currency = "EUR"
    } = req.body || {};

    const nights = nightsBetween(check_in, check_out);
    if (!check_in || !check_out || nights <= 0) {
      return res.status(400).json({ ok: false, error: "invalid dates" });
    }

    // Simple Preislogik
    const basePerNight = 90;
    const boardAddMap = { "ohne verpflegung": 0, "frühstück": 8, "halbpension": 18, "vollpension": 28 };
    const boardAdd = boardAddMap[String(board).toLowerCase()] ?? 8;
    const clubCareAdd = club_care ? 220 : 0;

    const total_eur = euro(nights * (basePerNight + boardAdd) + clubCareAdd);
    const fx = 48.0;
    const total_try = Math.round(total_eur * fx);

    res.json({
      ok: true,
      data: {
        total_eur,
        total_try,
        fx,
        currency_in: "EUR",
        currency_out: "TRY",
        nights,
        breakdown: { basePerNight, boardAdd, clubCareAdd, board, adults: Number(adults), children: Number(children) }
      }
    });
  } catch {
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ---------- Tool: commit booking ---------- */
app.post("/retell/tool/commit_booking", requireToolSecret, (req, res) => {
  const { email, check_in, check_out, adults, children, board, club_care } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });

  // Hier würdest du DB & E-Mail machen; jetzt nur Dummy-Erfolg:
  return res.json({
    ok: true,
    data: {
      booking_id: "bk_" + Date.now(),
      email, check_in, check_out, adults, children, board, club_care: !!club_care
    }
  });
});

/* ---------- Tool: send offer ---------- */
app.post("/retell/tool/send_offer", requireToolSecret, (req, res) => {
  const { email, quote_eur, quote_try, fx, details } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, error: "missing email" });

  return res.json({
    ok: true,
    data: {
      sent: true,
      to: email,
      subject: "Ihr Angebot – Erendiz Hotel",
      preview: `Gesamt: €${quote_eur} (~₺${quote_try} @ ${fx})`,
      details
    }
  });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[retell-agent] listening on :${PORT}`);
});
