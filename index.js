import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const TOOL_SECRET = process.env.TOOL_SECRET || "MYSECRET123"; // bei Render als Env setzen

app.use(express.json());

// Healthcheck für Render
app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Beispiel-Tool-Endpunkt (wie in deinen cURL-Beispielen)
app.post("/retell/tool", (req, res) => {
  const secret = req.header("x-tool-secret");
  if (secret !== TOOL_SECRET) {
    return res.status(401).json({ error: "invalid secret" });
  }

  // Beispiel: einfache Echo-Logik
  const body = req.body || {};
  return res.json({
    status: "received",
    received: body
  });
});

app.listen(PORT, () => {
  console.log(`retell-agent listening on :${PORT}`);
});
