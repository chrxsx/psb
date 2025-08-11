import express from "express";
import { encrypt } from "../lib/crypto.js";
import { scrapeQueue } from "../lib/queue.js";
import { addEvent } from "../lib/store.js";

const router = express.Router();

router.get("/widget/:id", (req, res) => {
  const { id } = req.params;
  const providers = [
    { id: "experian", name: "Experian" },
    { id: "creditkarma", name: "Credit Karma" }
  ];
  const pre = (req.query.provider || "").toLowerCase();
  const selected = providers.some(p=>p.id===pre) ? pre : providers[0].id;
  const allowedEnv = (process.env.FRONTEND_BASE_URL || process.env.ALLOWED_ORIGIN || "http://localhost:8082");
  // Choose the first origin if comma-separated list was provided
  const allowedOrigin = allowedEnv.split(",").map(s=>s.trim()).filter(Boolean)[0] || "http://localhost:8082";
  res.render("widget", { sessionId: id, providers, selected, allowedOrigin });
});

router.post("/widget/:id/start", async (req, res) => {
  const { id } = req.params;
  const { provider, username, password, otp } = req.body;
  // Audit log without sensitive fields
  try {
    console.log(JSON.stringify({
      type: "audit_widget_submit",
      session_id: id,
      provider,
      ip: req.ip,
      ts: new Date().toISOString()
    }));
  } catch {}
  const encCreds = encrypt({ provider, username, password, otp });
  await scrapeQueue.add("scrape", { session_id: id, encCreds });
  try { addEvent(id, { type: "queued", data: { provider } }); } catch {}
  res.json({ ok: true });
});

export default router;
