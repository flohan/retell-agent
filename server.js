import 'dotenv/config';
import express from 'express';

const app = express();
const port = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

// --- Env / Config -----------------------------------------------------------
const HR_TOKEN = process.env.HR_TOKEN;
const HR_ID = process.env.HR_ID;
const X_TOOL_SECRET = process.env.X_TOOL_SECRET; // <- NEU: verpflichtendes Secret

// --- Middleware: Secret prüfen ----------------------------------------------
app.use('/retell/tool', (req, res, next) => {
  // Wenn ein Secret konfiguriert ist, MUSS der Header passen
  if (!X_TOOL_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: X_TOOL_SECRET not set' });
  }
  const provided = req.get('x-tool-secret');
  if (provided !== X_TOOL_SECRET) {
    return res.status(403).json({ error: 'Forbidden: invalid x-tool-secret' });
  }
  next();
});

// --- Helper: HotelRunner Fetch mit Timeout & JSON-Garantie ------------------
async function hrFetch(endpointWithQuery) {
  if (!HR_TOKEN || !HR_ID) {
    throw new Error('HR_TOKEN/HR_ID fehlen (Environment Variables nicht gesetzt).');
  }

  // endpointWithQuery z.B. "rooms?" oder "reservations?"
  const url = `https://app.hotelrunner.com/api/v2/apps/${endpointWithQuery}` +
              `token=${HR_TOKEN}&hr_id=${HR_ID}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) throw new Error(`HotelRunner HTTP ${resp.status}: ${text.slice(0, 200)}`);

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('HotelRunner lieferte kein valides JSON.');
    }
  } catch (err) {
    throw new Error('HotelRunner Fetch Error: ' + err.message);
  } finally {
    clearTimeout(timeout);
  }
}

// --- Health -----------------------------------------------------------------
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, node: process.version, env: 'render' });
});

// --- Tool-Endpoint -----------------------------------------------------------
app.post('/retell/tool', async (req, res) => {
  try {
    const { name, arguments: args } = req.body || {};
    if (!name) return res.json({ error: 'missing tool name' });

    switch (name) {
      case 'list_rooms': {
        // Holt Zimmer, filtert "No Room"/"Default" heraus, gibt NUR Anzahl + Spoken
        const data = await hrFetch('rooms?');
        const roomsArr = Array.isArray(data?.rooms) ? data.rooms : [];
        const clean = roomsArr
          .map(r => r?.name || r?.code || '')
          .filter(s => s && !/no\s*room|default/i.test(s));
        return res.json({ result: { count: clean.length, spoken: `${clean.length} Apartments insgesamt` } });
      }

      case 'check_availability': {
        // Demo/Dummy – echten Availability-Endpoint später anbinden
        const { from_date, to_date, adults, children } = args || {};
        const availableCount = Math.floor(Math.random() * 10) + 1;
        return res.json({
          result: {
            from_date, to_date, adults: adults ?? null, children: children ?? null,
            availableCount,
            spoken: `${availableCount} Apartments frei`
          }
        });
      }

      case 'get_reservations': {
        const data = await hrFetch('reservations?');
        return res.json({ result: data });
      }

      case 'confirm_delivery': {
        const { message_uid, pms_number } = args || {};
        if (!message_uid) return res.json({ error: 'message_uid required' });
        const ep = `reservations/confirm-delivery?message_uid=${encodeURIComponent(message_uid)}`
          + (pms_number ? `&pms_number=${encodeURIComponent(pms_number)}&` : '&');
        const data = await hrFetch(ep);
        return res.json({ result: data });
      }

      default:
        return res.json({ error: 'unknown tool' });
    }
  } catch (err) {
    console.error('❌ Tool Fehler:', err);
    return res.json({ error: String(err) });
  }
});

// --- (Optional) Mini-Dashboard ----------------------------------------------
app.get('/status', (_req, res) => {
  res.send(`
    <!doctype html><meta charset="utf-8">
    <title>Retell Agent Status</title>
    <pre>OK - Node ${process.version} - Render</pre>
  `);
});

// --- Start ------------------------------------------------------------------
process.on('SIGTERM', () => process.exit(0));
app.listen(port, () => console.log(`✅ Agent backend running on :${port} (Render)`));
