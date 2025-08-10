import express from "express";
import { nanoid } from "nanoid";
import { encrypt } from "../lib/crypto.js";
import { scrapeQueue } from "../lib/queue.js";

const router = express.Router();

// In-memory stores for demo (swap with DB in production)
const sessions = new Map();
const results = new Map();

// Create a new session (called by your backend)
router.post("/sessions", (req, res) => {
  const { user_id, provider_hint } = req.body || {};
  const id = nanoid();
  const created_at = new Date().toISOString();
  sessions.set(id, { id, user_id, provider_hint, status: "created", created_at });
  const base = process.env.BRIDGE_BASE_URL || "http://localhost:8080";
  const iframe_url = `${base}/widget/${id}`;
  res.json({ session_id: id, iframe_url });
});

// Receive progress/events from worker
router.post("/sessions/:id/events", (req, res) => {
  const { id } = req.params;
  const sess = sessions.get(id);
  if (!sess) return res.status(404).json({ error: "not_found" });
  const event = req.body;
  // Store final result if present
  if (event.type === "final") {
    results.set(id, event.data);
    sessions.set(id, { ...sess, status: "completed", completed_at: new Date().toISOString() });
  } else {
    sessions.set(id, { ...sess, status: event.type });
  }
  res.json({ ok: true });
});

// Get final result (polled by your backend)
router.get("/sessions/:id/result", (req, res) => {
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
  lines.push(`**Score:** ${score ?? "n/a"}${score_model ? " (" + score_model + ")" : ""}`);
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
  const mdUrl = `${req.protocol}://${req.get('host')}/v1/sessions/${id}/pretty`;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Credit Snapshot</title>
  <style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:24px;max-width:800px}pre{white-space:pre-wrap}</style>
  </head><body>
  <h1>Credit Snapshot</h1>
  <pre id="md"></pre>
  <script>
    fetch(${JSON.stringify("/v1/sessions/" )}+${JSON.stringify(id)}+${JSON.stringify("/pretty")}).then(r=>r.text()).then(t=>{document.getElementById('md').textContent=t});
  </script>
  </body></html>`);
});

export default router;
