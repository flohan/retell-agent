// server.js — Retell tool backend (unified 'tool-secret', robust date parsing)
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(express.json({ limit: "100kb", strict: true }));
app.use((err, _req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  next();
});

// Secret header check (single name: 'tool-secret')
const TOOL_SECRET = (process.env.TOOL_SECRET || "").trim();
app.use((req, res, next) => {
  if (req.path.startsWith("/retell/tool")) {
    const incoming = (req.headers["tool-secret"] || "").toString().trim();
    if (!TOOL_SECRET || incoming !== TOOL_SECRET) {
      return res.status(401).json({ error: "Unauthorized: Invalid tool-secret" });
    }
  }
  next();
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    node: process.version,
    env: process.env.RENDER ? "render" : "local",
    ts: new Date().toISOString()
  });
});

// ---------- Date helpers ----------
const MONTHS_DE = { jan:1, jän:1, januar:1, feb:2, februar:2, mar:3, mär:3, mrz:3, märz:3, apr:4, april:4, mai:5, jun:6, juni:6, jul:7, juli:7, aug:8, august:8, sep:9, sept:9, september:9, okt:10, oktober:10, nov:11, november:11, dez:12, dezember:12 };
const WEEKDAYS_DE = { sonntag:0, montag:1, dienstag:2, mittwoch:3, donnerstag:4, freitag:5, samstag:6 };
const pad2 = (n) => String(n).padStart(2,"0");
const addDays = (d,n)=>{const r=new Date(d); r.setDate(r.getDate()+n); return r;};
const ymd = (d)=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const diffNights = (a,b)=>{const A=new Date(a+"T00:00:00Z"),B=new Date(b+"T00:00:00Z");return Math.max(0, Math.round((B-A)/(1000*60*60*24)));};

function normalizeDate(input, baseDate = new Date()) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (s.includes("heute")) return ymd(baseDate);
  if (s.includes("morgen")) return ymd(addDays(baseDate,1));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// Demo inventory / pricing
const ROOMS = [
  { code:"STD", name:"Standard Apartment", rate:80 },
  { code:"DLX", name:"Deluxe Apartment", rate:110 },
  { code:"STE", name:"Suite", rate:150 }
];

const computeListRooms = ()=> {
  const names = ROOMS.map(r=>r.name);
  return { result: { count:names.length, spoken:`${names.length} Apartments insgesamt`, rooms:names } };
};

const computeCheckAvailability = (body) => {
  const now = new Date();
  const from = body.from_date || (body.checkin_raw ? normalizeDate(body.checkin_raw, now) : null);
  const to   = body.to_date   || (body.checkout_raw ? normalizeDate(body.checkout_raw, now) : null);

  if (!from || !to) throw new Error("Ungültiges oder fehlendes Datum. Bitte erneut angeben.");
  const nights = diffNights(from,to);
  if (nights <= 0) throw new Error("Das Abreisedatum muss nach dem Anreisedatum liegen.");

  const adults = Number.isFinite(+body.adults) ? +body.adults : 2;
  const children = Number.isFinite(+body.children) ? +body.children : 0;
  const best = ROOMS[0];
  const price = best.rate * nights;

  const spoken = `Ja, wir haben vom ${from} bis ${to} für ${adults} Erwachsene frei. Ein ${best.name} kostet insgesamt ca. ${price} € für ${nights} Nächte. Möchten Sie buchen?`;

  return { result: { available:true, nights, price, room:best.name, from_date:from, to_date:to, adults, children, spoken } };
};

// Routes
app.post("/retell/tool/list_rooms", (_req,res)=>res.json(computeListRooms()));
app.post("/retell/tool/check_availability",(req,res)=>{
  try { res.json(computeCheckAvailability(req.body||{})); }
  catch(e){ res.status(400).json({error:e.message}); }
});
app.post("/retell/tool",(req,res)=>{
  const {name, arguments:args={}} = req.body||{};
  if(name==="list_rooms") return res.json(computeListRooms());
  if(name==="check_availability") {
    try { return res.json(computeCheckAvailability(args)); }
    catch(e){ return res.status(400).json({error:e.message}); }
  }
  return res.status(400).json([{error:"1"},"unknown tool"]);
});

const PORT = Number(process.env.PORT||10000);
app.listen(PORT,()=>console.log(`✅ Agent backend running on http://localhost:${PORT}`));
