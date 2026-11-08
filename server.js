require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEMO_MODE = String(process.env.DEMO_MODE || "false").toLowerCase() === "true";
const PANEL_URL = (process.env.PTERODACTYL_URL || "").replace(/\/+$/, "");
const API_KEY = process.env.PTERODACTYL_API_KEY || "";
const SERVER_ID = process.env.PTERODACTYL_SERVER_ID || "";

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

function configured() {
  return Boolean(PANEL_URL && API_KEY && SERVER_ID &&
    !API_KEY.includes("REPLACE") && !SERVER_ID.includes("REPLACE"));
}
function requireLive(req, res, next) {
  if (DEMO_MODE) return res.status(409).json({ error: "Demo mode is enabled. Set DEMO_MODE=false and configure the Pterodactyl connection in .env." });
  if (!configured()) return res.status(503).json({ error: "Pterodactyl is not configured. Copy .env.example to .env and add your panel URL, client API key, and server identifier." });
  next();
}
async function panelRequest(endpoint, options = {}) {
  const response = await fetch(`${PANEL_URL}/api/client${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "Application/vnd.pterodactyl.v1+json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw }; }
  if (!response.ok) {
    const message = data?.errors?.[0]?.detail || data?.message || `Pterodactyl returned HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}
function handleError(res, err) {
  const status = [400, 401, 403, 404, 409, 422, 429].includes(err.status) ? err.status : 502;
  res.status(status).json({ error: err.message || "Backend request failed" });
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mode: DEMO_MODE ? "demo" : (configured() ? "connected-configured" : "not-configured"),
    panelConfigured: configured(),
    serverConfigured: Boolean(SERVER_ID && !SERVER_ID.includes("REPLACE"))
  });
});

app.get("/api/servers", requireLive, async (req, res) => {
  try {
    const data = await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}`);
    res.json({ server: data.attributes });
  } catch (e) { handleError(res, e); }
});

app.get("/api/servers/:id/resources", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  try {
    const data = await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/resources`);
    res.json(data.attributes);
  } catch (e) { handleError(res, e); }
});

app.post("/api/servers/:id/power", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  const signal = String(req.body?.signal || "").toLowerCase();
  if (!["start", "stop", "restart", "kill"].includes(signal)) return res.status(400).json({ error: "Invalid power action." });
  try {
    await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/power`, {
      method: "POST", body: JSON.stringify({ signal })
    });
    res.json({ ok: true, message: `${signal} signal sent.` });
  } catch (e) { handleError(res, e); }
});

app.post("/api/servers/:id/command", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  const command = String(req.body?.command || "").trim();
  if (!command || command.length > 300) return res.status(400).json({ error: "Enter a command up to 300 characters." });
  try {
    await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/command`, {
      method: "POST", body: JSON.stringify({ command })
    });
    res.json({ ok: true, message: "Command sent." });
  } catch (e) { handleError(res, e); }
});

app.get("/api/servers/:id/websocket", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  try {
    const data = await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/websocket`);
    res.json(data.data);
  } catch (e) { handleError(res, e); }
});

app.get("/api/servers/:id/files", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  const directory = String(req.query.directory || "/");
  if (!directory.startsWith("/") || directory.includes("\0")) return res.status(400).json({ error: "Invalid directory." });
  try {
    const data = await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/files/list?directory=${encodeURIComponent(directory)}`);
    res.json(data);
  } catch (e) { handleError(res, e); }
});

app.get("/api/servers/:id/backups", requireLive, async (req, res) => {
  if (req.params.id !== SERVER_ID) return res.status(403).json({ error: "This server is not allowed." });
  try {
    const data = await panelRequest(`/servers/${encodeURIComponent(SERVER_ID)}/backups`);
    res.json(data);
  } catch (e) { handleError(res, e); }
});

app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Hexacraft panel running on http://localhost:${PORT}`);
  console.log(`Mode: ${DEMO_MODE ? "DEMO (read-only preview)" : (configured() ? "Pterodactyl configured" : "NOT CONFIGURED")}`);
});
