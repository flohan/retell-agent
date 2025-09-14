import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// ---- Robust Secret-Check ----
const TOOL_SECRET = (process.env.TOOL_SECRET || process.env.X_TOOL_SECRET || "").trim();

function checkSecret(req, res, next) {
  const incoming = (req.headers["x-tool-secret"] || "").toString().trim();
  if (!TOOL_SECRET || incoming !== TOOL_SECRET) {
    console.error("[AUTH FAIL] expected:", TOOL_SECRET, "got:", incoming);
    return res.status(401).json({ error: "Unauthorized: Invalid x-tool-secret" });
  }
  next();
}

// ---- Health Endpoint ----
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: process.env.RENDER ? "render" : "local",
  });
});

// ---- Retell Tool Handler ----
app.post("/retell/tool/:tool", checkSecret, async (req, res) => {
  const { tool } = req.params;
  const args = req.body || {};

  try {
    switch (tool) {
      case "list_rooms": {
        // Beispiel-Rückgabe
        const rooms = [
          "01 Apartment Phaselis",
          "02 Apartment Armut",
          "03 Apartment Olympos",
          "04 Apartment Cirali",
          "05 Apartment Adrasan",
        ];
        return res.json({
          result: {
            count: rooms.length,
            spoken: `${rooms.length} Apartments insgesamt`,
            rooms,
          },
        });
      }

      case "check_availability": {
        const { from_date, to_date, adults, children } = args;
        // Dummy-Check: Immer verfügbar
        return res.json({
          result: {
            available: true,
            spoken: `Ja, wir haben vom ${from_date} bis ${to_date} für ${adults} Erwachsene${children ? " und " + children + " Kinder" : ""} Apartments frei.`,
          },
        });
      }

      default:
        return res.status(400).json({ error: "Unknown tool" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Agent backend running on http://localhost:${PORT}`);
});
