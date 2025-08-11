import { Queue } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const isTls = /^rediss:\/\//i.test(redisUrl);
const rejectUnauthorized = (process.env.REDIS_TLS_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false";

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...(isTls ? { tls: { rejectUnauthorized } } : {}),
});
export const scrapeQueue = new Queue("scrape", { connection });
