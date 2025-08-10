import { Worker } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { decrypt } from "./lib/crypto.js";
import { scrapeProviderX } from "./scrapers/providerX.js";
import { scrapeExperian } from "./scrapers/experian.js";
import { scrapeCreditKarma } from "./scrapers/creditkarma.js";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379");
const bridgeBase = process.env.BRIDGE_BASE_URL || "http://localhost:8080";

function emit(session_id, type, payload={}) {
  return axios.post(`${bridgeBase}/v1/sessions/${session_id}/events`, { type, data: payload }).catch(()=>{});
}

const w = new Worker("scrape", async job => {
  const { session_id, encCreds } = job.data;
  await emit(session_id, "started");
  const creds = decrypt(encCreds);
  if (creds.provider === "providerx") {
    const data = await scrapeProviderX({ username: creds.username, password: creds.password, otp: creds.otp });
    await emit(session_id, "final", data);
  } else if (creds.provider === "experian") {
    const data = await scrapeExperian({ username: creds.username, password: creds.password, otp: creds.otp });
    await emit(session_id, "final", data);
  } else if (creds.provider === "creditkarma") {
    const data = await scrapeCreditKarma({ username: creds.username, password: creds.password, otp: creds.otp });
    await emit(session_id, "final", data);
  } else {
    await emit(session_id, "error", { reason: "unknown_provider" });
  }
}, { connection });

w.on("completed", job => { /* no-op */ });
w.on("failed", (job, err) => {
  const { session_id } = job.data || {};
  if (session_id) emit(session_id, "error", { reason: "worker_failed", message: err?.message });
});
