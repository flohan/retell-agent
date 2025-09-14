import 'dotenv/config';
import express from "express";

const app = express();
const port = process.env.PORT || 3000;

// Sicherheits-Defaults
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

// HotelRunner Config
const HR_TOKEN = process.env.HR_TOKEN;
const HR_ID = process.env.HR_ID;

// Robuste Fetch-Hilfsfunktion mit Timeout und hartem JSON-Check
async function hrFetch(endpoint) {
  if (!HR_TOKEN || !HR_ID) {
    throw new Error("HR_TOKEN/HR_ID fehlen (Environment Variables nicht gesetzt).");
  }
  const url = `https://app.hotelrunner.com/api/v2/apps/${endpoint}&token=${HR_TOKEN}&hr_id=${HR_ID}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HotelRunner HTTP ${resp.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("HotelRunner lieferte kein valides JSON.");
    }
  } catch (err) {
    throw new Error("HotelRunner Fetch Error: " + err.message);
  } finally {
    clearTimeout(timeout);
  }
}

// Healthcheck (für Render „Health Check“ und Monitoring)
app.get("/healthz", (_req, res) => {
  res.json({ ok: true, node: process.version, env: "render" });
});

// Tool-Endpoint für deinen Retell-Call-Agent
app.post("/retell/tool", async (req, res) => {
  try {
    const { name, arguments: args } = req.body || {};

    switch (name) {
      // Nur Anzahl nennen (für Sprachantwort ausreichend)
      case "list_rooms": {
        const data = await hrFetch("rooms?");
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
        const clean = rooms
          .map(r => r?.name || r?.code || "")
          .filter(r => r && !r.toLowerCase().includes("no room") && !r.toLowerCase().includes("default"));
        return res.json({ result: { count: clean.length, spoken: `${clean.length} Apartments insgesamt` } });
      }

      // Verfügbarkeit (Dummy-Simulation; echten Endpoint später anbinden)
      case "check_availability": {
        const { from_date, to_date, adults, children } = args || {};
        const availableCount = Math.floor(Math.random() * 10) + 1;
        return res.json({
          result: {
            from_date, to_date, adults, children,
            availableCount,
            spoken: `${availableCount} Apartments frei`
          }
        });
      }

      // Rohdaten für spätere KPI-Berechnungen
      case "get_reservations": {
        const data = await hrFetch("reservations?");
        return res.json({ result: data });
      }

      // Beispiel: Bestätigung einer Zustellung in HR
      case "confirm_delivery": {
        const { message_uid, pms_number } = args || {};
        if (!message_uid) return res.json({ error: "message_uid required" });
        const ep = `reservations/confirm-delivery?message_uid=${encodeURIComponent(message_uid)}${pms_number ? `&pms_number=${encodeURIComponent(pms_number)}` : ""}`;
        const data = await hrFetch(ep);
        return res.json({ result: data });
      }

      default:
        return res.json({ error: "unknown tool" });
    }
  } catch (err) {
    console.error("❌ Tool Fehler:", err);
    res.json({ error: String(err) });
  }
});

// Minimal-Dashboard als Demo (1 Monat zurück, 3 Monate vor)
app.get("/status", async (_req, res) => {
  try {
    const kpis = { adr: 85, cancellation: 12, openBookings: 34 }; // Platzhalter

    const today = new Date();
    const labels = [], values = [];
    for (let i = -30; i <= 90; i += 7) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      labels.push(d.toISOString().slice(0, 10));
      values.push(Math.floor(Math.random() * 100));
    }

    const roomTypes = ["Standard", "Deluxe", "Suite"];
    const roomValues = [12, 7, 4];

    res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Retell Agent Dashboard</title>
          <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          <style>
            body { font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto; margin: 2rem; background:#f8f9fb; color:#2c3e50; }
            .card { background:#fff; border-radius:16px; padding:1rem; margin-bottom:1rem; box-shadow:0 6px 18px rgba(0,0,0,.06); }
            .kpis { display:flex; gap:1rem; flex-wrap:wrap; }
            .kpi { flex:1; min-width:180px; text-align:center; }
            .kpi h3 { margin:.2rem 0; font-weight:600; color:#6b7280; }
            .val { font-size:1.6rem; font-weight:800; }
            canvas { max-width:100%; }
          </style>
        </head>
        <body>
          <h1>📊 Retell Agent Dashboard</h1>

          <div class="card kpis">
            <div class="kpi"><h3>ADR</h3><div class="val">€ ${kpis.adr}</div></div>
            <div class="kpi"><h3>Storno-Rate</h3><div class="val">${kpis.cancellation}%</div></div>
            <div class="kpi"><h3>Offene Buchungen</h3><div class="val">${kpis.openBookings}</div></div>
          </div>

          <div class="card">
            <h2>Auslastung (Trend)</h2>
            <canvas id="tr"></canvas>
          </div>

          <div class="card">
            <h2>Belegung pro Zimmertyp</h2>
            <canvas id="rt"></canvas>
          </div>

          <script>
            new Chart(document.getElementById('tr').getContext('2d'), {
              type: 'line',
              data: { labels: ${JSON.stringify(labels)}, datasets: [{ label: 'Auslastung %', data: ${JSON.stringify(values)}, fill: true, borderColor: '#2563eb', backgroundColor:'rgba(37,99,235,.15)', tension:.3 }]},
              options: { scales: { y: { beginAtZero:true, max:100 } } }
            });
            new Chart(document.getElementById('rt').getContext('2d'), {
              type: 'bar',
              data: { labels: ${JSON.stringify(roomTypes)}, datasets: [{ data: ${JSON.stringify(roomValues)}, backgroundColor:['rgba(99,102,241,.8)','rgba(16,185,129,.8)','rgba(239,68,68,.8)'], borderRadius:10 }]},
              options: { plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
            });
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Status Fehler:", err);
    res.status(500).send("Fehler beim Laden der Status-Seite");
  }
});

process.on("SIGTERM", () => process.exit(0));
app.listen(port, () => console.log(`✅ Agent backend running on :${port} (Render)`));
