// server.js
import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// 🔒 Sicherheits-Secret prüfen
const TOOL_SECRET = process.env.TOOL_SECRET;
app.use((req, res, next) => {
  const sec = req.get("x-tool-secret");
  if (!sec || sec !== TOOL_SECRET) {
    return res.status(401).json({ error: "Unauthorized: bad or missing x-tool-secret" });
  }
  next();
});

// ✅ Healthcheck
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: process.env.RENDER ? "render" : "local",
  });
});

// --- Tool Implementierungen ---

function listRooms() {
  const rooms = [
    "01 Apartment Phaselis",
    "03 Apartment Armut",
    "04 Apartment Olympos",
    "05 Apartment Cirali",
    "07 Apartment Adrasan",
    "11 Apartment Tahtali",
    "12 Apartment Göynük",
    "13 Apartment Chimera",
    "14 Apartment Sedir",
    "15 Apartment Perge",
    "16 Apartment Moonlight",
    "17 Apartment Ulupinar",
    "18 Apartment Gelidonya",
    "20 Apartment Tekirova",
    "24 Apartment Beldibi",
    "26 Apartment Boncuk",
  ];
  return {
    count: rooms.length,
    spoken: `${rooms.length} Apartments insgesamt`,
    rooms,
  };
}

function checkAvailability({ from_date, to_date, adults, children }) {
  // Dummy-Logik → hier später Hotelrunner API o.ä. einbauen
  return {
    available: true,
    spoken: `Ja, wir haben vom ${from_date} bis ${to_date} Platz für ${adults} Erwachsene${children ? ` und ${children} Kinder` : ""}.`,
  };
}

// --- Haupt-Endpoint ---
app.post("/retell/tool", (req, res) => {
  let { name, arguments: args } = req.body || {};

  // Falls Retell nichts schickt → Header als Fallback
  if (!name) {
    name = req.get("x-tool-name");
  }

  if (!name) {
    return res.status(400).json({ error: "missing tool name" });
  }

  try {
    switch (name) {
      case "list_rooms":
        return res.json({ result: listRooms() });
      case "check_availability":
        return res.json({ result: checkAvailability(args || {}) });
      default:
        return res.status(400).json({ error: "unknown tool" });
    }
  } catch (err) {
    console.error("Tool error:", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

// --- Kurz-Endpunkte für einfache Integration ---
app.post("/retell/tool/list_rooms", (req, res) => {
  res.json({ result: listRooms() });
});

app.post("/retell/tool/check_availability", (req, res) => {
  const { from_date, to_date, adults, children } = req.body || {};
  res.json({
    result: checkAvailability({
      from_date: from_date || "2025-10-20",
      to_date: to_date || "2025-10-22",
      adults: adults || 2,
      children: children || 0,
    }),
  });
});

// --- Start ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Agent backend running on http://localhost:${PORT}`);
});
