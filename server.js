// server.js
// Retell Agent Backend – Express + HotelRunner-Helper
// Läuft lokal und auf Render (PORT wird automatisch genutzt)

import 'dotenv/config';
import express from 'express';

// Node ≥18 hat global fetch/AbortController
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

/* -------------------- Konfiguration / ENV -------------------- */
const HR_TOKEN = process.env.HR_TOKEN;
const HR_ID = process.env.HR_ID;
const X_TOOL_SECRET = process.env.X_TOOL_SECRET;
const DEBUG = (process.env.DEBUG || '').toLowerCase() === 'true';

/* -------------------- Utils & HotelRunner-Client -------------------- */

/**
 * Hilfsfunktion: baut eine volle URL zu HotelRunner v2 Apps API.
 * @param {string} path - z.B. "rooms" oder "reservations/confirm-delivery"
 * @param {Record<string,string|number|undefined>} [params] - Zusatz-Query
 * @returns {string} Vollständige URL
 */
function hrUrl(path, params = {}) {
  if (!HR_TOKEN || !HR_ID) {
    throw new Error('HR_TOKEN/HR_ID fehlen (Environment Variables nicht gesetzt).');
  }
  const base = `https://app.hotelrunner.com/api/v2/apps/${path}`;
  const usp = new URLSearchParams();
  // Pflichtparameter
  usp.set('token', HR_TOKEN);
  usp.set('hr_id', String(HR_ID));
  // optionale Parameter
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  return `${base}?${usp.toString()}`;
}

/**
 * Führt GET gegen HotelRunner aus, mit Timeout & valider JSON-Antwort.
 * @param {string} path
 * @param {Record<string,string|number|undefined>} [params]
 */
async function hrGet(path, params) {
  const url = hrUrl(path, params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`HotelRunner HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }

    // HR liefert bei manchen Endpoints HTML, daher JSON-Parsing absichern
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

/* -------------------- Health & Status -------------------- */

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: process.env.RENDER ? 'render' : 'local',
  });
});

app.get('/status', (_req, res) => {
  res
    .status(200)
    .send(
      `<!doctype html><meta charset="utf-8"><title>Retell Agent Status</title>
       <pre>OK - Node ${process.version} - ${process.env.RENDER ? 'Render' : 'Local'}</pre>`
    );
});

/* -------------------- Secret-Check Middleware -------------------- */

app.use('/retell/tool', (req, res, next) => {
  if (!X_TOOL_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: X_TOOL_SECRET not set' });
  }
  const provided = req.get('x-tool-secret');
  if (provided !== X_TOOL_SECRET) {
    return res.status(403).json({ error: 'Forbidden: invalid x-tool-secret' });
  }
  if (DEBUG) {
    console.log('[DEBUG] headers:', {
      'content-type': req.get('content-type'),
      'x-tool-secret': provided ? '(present)' : '(missing)',
    });
    console.log('[DEBUG] body:', req.body);
  }
  next();
});

/* -------------------- Tool-Handler -------------------- */

app.post('/retell/tool', async (req, res) => {
  try {
    const { name, arguments: args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'missing tool name' });

    switch (name) {
      /* -------- list_rooms: nur Anzahl + kurze Sprachantwort -------- */
      case 'list_rooms': {
        const data = await hrGet('rooms');
        const rooms = Array.isArray(data?.rooms) ? data.rooms : [];

        // Namen/Code herausziehen und „No Room/Default“ filtern
        const clean = rooms
          .map(r => r?.name || r?.code || '')
          .filter(s => s && !/no\s*room|default/i.test(s));

        return res.json({
          result: {
            count: clean.length,
            rooms: clean, // falls du später anzeigen willst
            spoken: `${clean.length} Apartments insgesamt`,
          },
        });
      }

      /* -------- check_availability: Demo (Zufallswert) --------
         TODO: echten HR-Availability-Endpoint anbinden, wenn verfügbar.
      */
      case 'check_availability': {
        const { from_date, to_date, adults, children } = args || {};
        if (!from_date || !to_date || !adults) {
          return res.status(400).json({
            error: 'from_date, to_date, adults sind Pflicht',
          });
        }
        const availableCount = Math.floor(Math.random() * 10) + 1;
        return res.json({
          result: {
            from_date,
            to_date,
            adults,
            children: children ?? 0,
            availableCount,
            spoken: `${availableCount} Apartments frei`,
          },
        });
      }

      /* -------- get_reservations: Rohdaten aus HR -------- */
      case 'get_reservations': {
        const data = await hrGet('reservations');
        return res.json({ result: data });
      }

      /* -------- confirm_delivery: HR-Bestätigung -------- */
      case 'confirm_delivery': {
        const { message_uid, pms_number } = args || {};
        if (!message_uid) return res.status(400).json({ error: 'message_uid required' });

        const data = await hrGet('reservations/confirm-delivery', {
          message_uid,
          ...(pms_number ? { pms_number } : {}),
        });
        return res.json({ result: data });
      }

      default:
        return res.status(400).json({ error: 'unknown tool' });
    }
  } catch (err) {
    console.error('❌ Tool Fehler:', err);
    return res.status(500).json({ error: String(err) });
  }
});

/* -------------------- Start Server -------------------- */

process.on('SIGTERM', () => process.exit(0));
app.listen(PORT, () => {
  console.log(`✅ Agent backend running on :${PORT} ${process.env.RENDER ? '(Render)' : '(Local)'}`);
});
