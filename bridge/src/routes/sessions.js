import express from "express";
import { nanoid } from "nanoid";
import { sessions, results, addEvent, addSseClient, removeSseClient } from "../lib/store.js";

const router = express.Router();

function requireBridgeKeyIfConfigured(req, res) {
  const configured = (process.env.BRIDGE_BASE_ENCRYPTION_KEY || "").trim();
  if (!configured) return true;
  const provided = (req.get("X-Bridge-Key") || "").trim();
  if (provided && provided === configured) return true;
  res.status(401).json({ error: "unauthorized" });
  return false;
}

// Create a new session (called by your backend)
router.post("/sessions", (req, res) => {
  if (!requireBridgeKeyIfConfigured(req, res)) return;
  const { user_id, provider_hint } = req.body || {};
  const id = nanoid();
  const created_at = new Date().toISOString();
  sessions.set(id, { id, user_id, provider_hint, status: "created", created_at });
  try { addEvent(id, { type: "created", data: { user_id, provider_hint } }); } catch {}
  const base = process.env.BRIDGE_BASE_URL || "http://localhost:8080";
  const iframe_url = `${base}/widget/${id}`;
  res.json({ session_id: id, iframe_url });
});

// Receive progress/events from worker
router.post("/sessions/:id/events", (req, res) => {
  if (!requireBridgeKeyIfConfigured(req, res)) return;
  const { id } = req.params;
  const sess = sessions.get(id);
  if (!sess) return res.status(404).json({ error: "not_found" });
  const event = req.body;

  // Update status and capture result if final
  if (event.type === "final") {
    results.set(id, event.data);
    sessions.set(id, { ...sess, status: "completed", completed_at: new Date().toISOString() });
  } else {
    sessions.set(id, { ...sess, status: event.type });
  }

  // Record and broadcast
  try { addEvent(id, { type: event.type, data: event.data }); } catch {}

  res.json({ ok: true });
});

// Get final result (polled by your backend)
router.get("/sessions/:id/result", (req, res) => {
  if (!requireBridgeKeyIfConfigured(req, res)) return;
  const { id } = req.params;
  const data = results.get(id);
  if (!data) return res.status(404).json({ error: "not_ready" });
  res.json(data);
});

// Pretty markdown summary
router.get("/sessions/:id/pretty", (req, res) => {
  const { id } = req.params;
  const data = results.get(id);
  if (!data) return res.status(404).send("# Not ready\nResult not available yet.");
  const {
    provider, pulled_at, score, score_model, identity = {}, accounts = [], inquiries = [], public_records = []
  } = data;

  const openAccounts = accounts.filter(a => (a.status || "").toLowerCase() === "open").length || accounts.length;
  const totalLimits = accounts.reduce((s, a) => s + (Number(a.credit_limit) || 0), 0);
  const totalBalances = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const utilPct = totalLimits > 0 ? ((totalBalances / totalLimits) * 100).toFixed(1) : "n/a";

  const lines = [];
  lines.push(`# Credit Snapshot (${provider})`);
  lines.push("");
  lines.push(`**Pulled:** ${pulled_at || ""}`);
  lines.push(`**Score:** ${score ?? "n/a"}` + (score_model ? " (" + score_model + ")" : ""));
  lines.push("");
  lines.push(`**Accounts:** ${accounts.length} total • Open ~ ${openAccounts}`);
  lines.push(`**Total Limits:** $${Math.round(totalLimits).toLocaleString()} • **Total Balances:** $${Math.round(totalBalances).toLocaleString()} • **Utilization:** ${utilPct}%`);
  lines.push("");

  const top5 = accounts
    .slice()
    .sort((a, b) => (Number(b.balance)||0) - (Number(a.balance)||0))
    .slice(0, 5);

  lines.push("### Top 5 accounts by balance");
  for (const a of top5) {
    lines.push(`- ${a.type || "account"} • ${a.issuer || "issuer"} • bal $${Number(a.balance||0).toLocaleString()} • limit $${Number(a.credit_limit||0).toLocaleString()} • status ${a.status || "n/a"}`);
  }
  lines.push("");

  const last5Inq = inquiries.slice(-5);
  lines.push("### Recent inquiries");
  if (!last5Inq.length) lines.push("- None");
  for (const i of last5Inq) {
    lines.push(`- ${i.date || "date"} • ${i.subscriber || i.bureau || "subscriber"}`);
  }

  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.send(lines.join("\n"));
});

// Simple HTML rendering of the markdown (no external libs)
router.get("/sessions/:id/pretty.html", (req, res) => {
  const { id } = req.params;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Credit Snapshot</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;max-width:800px}pre{white-space:pre-wrap}</style>
  </head><body>
  <h1>Credit Snapshot</h1>
  <pre id="md"></pre>
  <script>
    fetch(${JSON.stringify("/v1/sessions/")}+${JSON.stringify(id)}+${JSON.stringify("/pretty")}).then(r=>r.text()).then(t=>{document.getElementById('md').textContent=t});
  </script>
  </body></html>`);
});

// Server-Sent Events stream for live status updates (unauthenticated, tied to random session id)
router.get("/sessions/:id/stream", (req, res) => {
  const { id } = req.params;
  if (!sessions.has(id)) {
    // allow widget to connect even if backend created session is not yet observed; don't error loudly
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  addSseClient(id, res);
  req.on("close", () => removeSseClient(id, res));
});

export default router;
