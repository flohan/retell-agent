// server.js — Optimiert (Header: `tool-secret` einheitlich)
import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// -------- JSON parser + Fehler --------
app.use(express.json({ limit: "100kb", strict: true }));
app.use((err, _req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  return next(err);
});

// -------- Secret-Header (einheitlich `tool-secret`) --------
const TOOL_SECRET = (process.env.TOOL_SECRET || process.env.TOOLSECRET || "").trim();
function checkSecret(req, res, next) {
  if (req.path.startsWith("/retell/tool")) {
    const incoming = (req.headers["tool-secret"] || "").toString().trim();
    if (!TOOL_SECRET || incoming !== TOOL_SECRET) {
      return res.status(401).json({ error: "Unauthorized: Invalid tool-secret" });
    }
  }
  next();
}
app.use(checkSecret);

// -------- Health --------
app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: process.env.RENDER ? "render" : "local",
    ts: new Date().toISOString()
  });
});

// -------- Datumstools --------
const MONTHS_DE = {
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
};
const WEEKDAYS_DE = {
  sonntag: 0, so: 0, "so.": 0,
  montag: 1, mo: 1, "mo.": 1,
  dienstag: 2, di: 2, "di.": 2,
  mittwoch: 3, mi: 3, "mi.": 3,
  donnerstag: 4, do: 4, "do.": 4,
  freitag: 5, fr: 5, "fr.": 5,
  samstag: 6, sa: 6, "sa.": 6, sonnabend: 6
};
const pad2 = (n)=> String(n).padStart(2,"0");
function isValidYmd(y,m,d){
  const dt = new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y && (dt.getUTCMonth()+1)===m && dt.getUTCDate()===d;
}
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function nextWeekday(from, targetWd){
  const wd = from.getDay();
  let delta = (targetWd - wd + 7) % 7;
  if (delta===0) delta = 7;
  const r = new Date(from); r.setDate(r.getDate()+delta); return r;
}
function normalizeDate(input, baseDate=new Date()){
  if (!input || typeof input!=="string") return null;
  let s = input.trim().toLowerCase().replace(/\s+/g," ");

  if (/(^| )heute( |$)/.test(s)) return ymd(baseDate);
  if (/(^| )morgen( |$)/.test(s)) return ymd(addDays(baseDate,1));
  if (/(^| )(übermorgen|uebermorgen)( |$)/.test(s)) return ymd(addDays(baseDate,2));
  let rel = s.match(/in\s+(\d{1,2})\s*tag(?:e|en)?/);
  if (rel){ const n=+rel[1]; if (Number.isFinite(n)) return ymd(addDays(baseDate,n)); }

  let wdMatch = s.match(/(?:nächsten|kommenden|am)\s+([a-z.äöüß]+)/);
  if (wdMatch){
    const key = wdMatch[1].replace(/\.$/,"");
    const target = WEEKDAYS_DE[key];
    if (typeof target==="number"){
      const d = s.includes("nächsten")||s.includes("kommenden")
        ? nextWeekday(baseDate, target)
        : nextWeekday(baseDate, target); // „am Freitag“ -> nächster Freitag
      return ymd(d);
    }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)){
    const [y,m,d] = s.split("-").map(Number);
    return isValidYmd(y,m,d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }
  let m1 = s.match(/^(\d{1,2})\.\s*(\d{1,2})(?:\.\s*(\d{2,4}))?$/);
  if (m1){
    let d=+m1[1], m=+m1[2], y=m1[3]? +(m1[3].length===2? "20"+m1[3] : m1[3]) : baseDate.getFullYear();
    if (isValidYmd(y,m,d)) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  let m2 = s.match(/^(\d{1,2})\.?\s+([a-zäöüß.]+)(?:\s+(\d{4}))?$/i);
  if (m2){
    let d=+m2[1], monKey=m2[2].replace(/\.$/,"").normalize("NFD").replace(/[\u0300-\u036f]/g,"");
    let m = MONTHS_DE[monKey.slice(0,3)] || MONTHS_DE[monKey];
    let y = m2[3]? +m2[3] : baseDate.getFullYear();
    if (m && isValidYmd(y,m,d)) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const tryDate = new Date(s);
  if (!isNaN(tryDate)) return ymd(tryDate);
  return null;
}
function diffNights(a,b){
  const A=new Date(a+"T00:00:00Z"), B=new Date(b+"T00:00:00Z");
  return Math.max(0, Math.round((B-A)/(1000*60*60*24)));
}

// -------- Demo-Daten --------
const ROOMS_DEMO = [
  { code: "STD", name: "Standard Apartment", rate: 80 },
  { code: "DLX", name: "Deluxe Apartment", rate: 110 },
  { code: "STE", name: "Suite", rate: 150 }
];

// -------- Logik --------
function computeListRooms(){
  const names = ROOMS_DEMO.map(r=>r.name);
  return { result: { count: names.length, spoken: `${names.length} Apartments insgesamt`, rooms: names } };
}
function computeCheckAvailability(payload){
  const body = payload||{};
  const now = new Date();
  let from = body.from_date || (body.checkin_raw ? normalizeDate(body.checkin_raw, now) : null);
  let to   = body.to_date   || (body.checkout_raw? normalizeDate(body.checkout_raw, now): null);
  if (!from || !to){
    const e=new Error("Ungültiges oder fehlendes Datum. Bitte erneut angeben.");
    e.status=400; throw e;
  }
  const nights = diffNights(from, to);
  if (nights<=0){ const e=new Error("Das Abreisedatum muss nach dem Anreisedatum liegen."); e.status=400; throw e; }
  const adults = Number.isFinite(+body.adults)? +body.adults : 2;
  const children = Number.isFinite(+body.children)? +body.children : 0;
  const best = ROOMS_DEMO[0];
  const price = best.rate * nights;
  const spoken = `Ja, wir haben vom ${from} bis ${to} für ${adults} Erwachsene${children? " und "+children+" Kinder":""} frei. Ein ${best.name} kostet insgesamt ca. ${price} € für ${nights} Nacht${nights>1?"e":""}. Möchten Sie buchen?`;
  return { result: { available: true, nights, price, room: best.name, from_date: from, to_date: to, adults, children, spoken } };
}

// -------- Routen --------
app.post("/retell/tool/list_rooms", (_req, res)=> res.json(computeListRooms()));
app.post("/retell/tool/check_availability", (req, res)=>{
  try { res.json(computeCheckAvailability(req.body)); }
  catch(e){ res.status(e?.status||500).json({ error: e.message||"Server error" }); }
});
app.post("/retell/tool", (req,res)=>{
  const { name, arguments: args={} } = req.body||{};
  if (!name) return res.status(400).json({ error: "unknown tool" });
  try{
    if (name==="list_rooms") return res.json(computeListRooms());
    if (name==="check_availability") return res.json(computeCheckAvailability(args));
    return res.status(400).json({ error: "unknown tool" });
  }catch(e){ return res.status(e?.status||500).json({ error: e.message||"Server error" }); }
});

// -------- Start --------
const PORT = Number(process.env.PORT||10000);
app.listen(PORT, ()=>{
  const where = process.env.RENDER ? `:${PORT} (Render)` : `http://localhost:${PORT}`;
  console.log(`✅ Agent backend running on ${where}`);
});
