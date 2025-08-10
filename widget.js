import express from "express";
import { encrypt } from "../lib/crypto.js";
import { scrapeQueue } from "../lib/queue.js";

const router = express.Router();
const sessions = new Map(); // demo only

router.get("/widget/:id", (req, res) => {
  const { id } = req.params;
  const providers = [
    { id: "experian", name: "Experian" },
    { id: "creditkarma", name: "Credit Karma" }
  ];
  const pre = (req.query.provider || "").toLowerCase();
  const selected = providers.some(p=>p.id===pre) ? pre : providers[0].id;
  res.render("widget", { sessionId: id, providers, selected, allowedOrigin: process.env.ALLOWED_ORIGIN });
});

router.post("/widget/:id/start", async (req, res) => {
  const { id } = req.params;
  const { provider, username, password, otp } = req.body;
  const encCreds = encrypt({ provider, username, password, otp });
  await scrapeQueue.add("scrape", { session_id: id, encCreds });
  res.json({ ok: true });
});

export default router;
