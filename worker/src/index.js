import { Worker } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { decrypt } from "./lib/crypto.js";
import { scrapeProviderX } from "./scrapers/providerX.js";
import { scrapeExperian } from "./scrapers/experian.js";
import { scrapeCreditKarma } from "./scrapers/creditkarma.js";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
const bridgeBase = process.env.BRIDGE_BASE_URL || "http://localhost:8080";

function emit(session_id, type, payload={}) {
  return axios.post(`${bridgeBase}/v1/sessions/${session_id}/events`, { type, data: payload }).catch(()=>{});
}

const w = new Worker("scrape", async job => {
  const { session_id, encCreds } = job.data;
  await emit(session_id, "started");
  let creds;
  try {
    creds = decrypt(encCreds);
  } catch (e) {
    await emit(session_id, "error", { reason: "decrypt_failed" });
    return;
  }
  try {
    let data = null;
    if (creds.provider === "providerx") {
      data = await scrapeProviderX({ username: creds.username, password: creds.password, otp: creds.otp });
    } else if (creds.provider === "experian") {
      data = await scrapeExperian({ username: creds.username, password: creds.password, otp: creds.otp });
    } else if (creds.provider === "creditkarma") {
      data = await scrapeCreditKarma({ username: creds.username, password: creds.password, otp: creds.otp });
    } else {
      await emit(session_id, "error", { reason: "unknown_provider" });
      return;
    }
    await emit(session_id, "final", data);
  } finally {
    // Clear sensitive material
    creds = undefined;
  }
}, { connection });

w.on("completed", job => { /* no-op */ });
w.on("failed", (job, err) => {
  const { session_id } = job.data || {};
  if (session_id) emit(session_id, "error", { reason: "worker_failed", message: err?.message });
});
