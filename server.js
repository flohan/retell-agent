import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Secret aus Environment
const TOOL_SECRET = process.env.TOOL_SECRET;
const HR_TOKEN = process.env.HR_TOKEN;
const HR_ID = process.env.HR_ID;

// Healthcheck
app.get("/healthz", (req, res) => {
  res.json({ ok: true, node: process.version, env: process.env.RENDER ? "render" : "local" });
});

// Middleware Secret-Check
function checkSecret(req, res, next) {
  const incoming = req.headers["x-tool-secret"];
  if (!TOOL_SECRET || incoming !== TOOL_SECRET) {
    return res.status(401).json({ error: "Unauthorized: Invalid x-tool-secret" });
  }
  next();
}

// Kurz-Endpunkte

// Zimmerliste
app.post("/retell/tool/list_rooms", checkSecret, async (req, res) => {
  try {
    if (!HR_TOKEN || !HR_ID) {
      return res.status(500).json({ error: "HR_TOKEN/HR_ID fehlen (Env Variablen)" });
    }

    const url = `https://app.hotelrunner.com/api/v2/apps/rooms?token=${HR_TOKEN}&hr_id=${HR_ID}`;
    const hrRes = await fetch(url);
    const data = await hrRes.json();

    const rooms = (data.rooms || []).map(r => r.code || r.id);
    res.json({
      result: {
        count: rooms.length,
        spoken: `${rooms.length} Apartments insgesamt`,
        rooms
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Verfügbarkeit
app.post("/retell/tool/check_availability", checkSecret, async (req, res) => {
  try {
    const { from_date, to_date, adults = 2, children = 0 } = req.body;

    if (!from_date || !to_date) {
      return res.status(400).json({ error: "from_date und to_date erforderlich" });
    }

    // Beispiel-Response (hier könntest du später HotelRunner-API anbinden)
    res.json({
      result: {
        available: true,
        spoken: `Ja, wir haben vom ${from_date} bis ${to_date} Platz für ${adults} Erwachsene.`,
        params: { from_date, to_date, adults, children }
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.toString() });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Agent backend running on http://localhost:${PORT}`);
});
