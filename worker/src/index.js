import { Worker } from "bullmq";
import IORedis from "ioredis";
import axios from "axios";
import { decrypt } from "./lib/crypto.js";
import { scrapeProviderX } from "./scrapers/providerX.js";
import { scrapeExperian } from "./scrapers/experian.js";
import { scrapeCreditKarma } from "./scrapers/creditkarma.js";

if (!process.env.ENCRYPTION_KEY) {
  console.warn("[WARN] ENCRYPTION_KEY is not set. Worker cannot decrypt credentials.");
}

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const isTls = /^rediss:\/\//i.test(redisUrl);
const rejectUnauthorized = (process.env.REDIS_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...(isTls ? { tls: { rejectUnauthorized } } : {}),
});
connection.on("error", (e) => console.error("[Redis] error", e?.message || e));

const bridgeBase = process.env.BRIDGE_BASE_URL || "http://localhost:8080";
const bridgeKey = (process.env.BRIDGE_BASE_ENCRYPTION_KEY || "").trim();

console.log(`[Worker] Using bridge: ${bridgeBase}`);
console.log(`[Worker] Redis URL: ${redisUrl} (TLS: ${isTls}, rejectUnauthorized: ${rejectUnauthorized})`);

function emit(session_id, type, payload={}) {
  const headers = {};
  if (bridgeKey) headers["X-Bridge-Key"] = bridgeKey;
  return axios.post(`${bridgeBase}/v1/sessions/${session_id}/events`, { type, data: payload }, { headers }).catch(()=>{});
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
  } catch (e) {
    if (e && typeof e.message === "string" && e.message.includes("__OTP_REQUIRED__")) {
      await emit(session_id, "otp_required");
      return; // avoid failing the job so user can resubmit with OTP
    }
    throw e;
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
