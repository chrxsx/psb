import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import sessionsRouter from "./routes/sessions.js";
import widgetRouter from "./routes/widget.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;
// Support both single and comma-separated values for origins
const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || "").trim();
const allowedOriginEnv = (process.env.ALLOWED_ORIGIN || "http://localhost:8082").trim();
const allowedOrigins = Array.from(new Set([
  ...allowedOriginEnv.split(",").map(s=>s.trim()).filter(Boolean),
  ...frontendBaseUrl.split(",").map(s=>s.trim()).filter(Boolean)
])).filter(Boolean);

// Validate critical env
if (!process.env.ENCRYPTION_KEY) {
  console.warn("[WARN] ENCRYPTION_KEY is not set. Encryption will fail. Set a 64-hex-char key.");
}
if (!process.env.BRIDGE_BASE_URL) {
  console.warn("[WARN] BRIDGE_BASE_URL not set. Using http://localhost:8080. Set this in Railway.");
}
if (allowedOrigins.length === 0) {
  console.warn("[WARN] No ALLOWED_ORIGIN/FRONTEND_BASE_URL configured. Defaulting to http://localhost:8082");
  allowedOrigins.push("http://localhost:8082");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use("/public", express.static(path.join(__dirname, "..", "public")));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      // Allow inline scripts for the simple widget boot script
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      // Allow embedding only by our frontends
      "frame-ancestors": ["'self'", ...allowedOrigins],
      // Allow XHR/fetch and EventSource back to this app
      "connect-src": ["'self'"],
      "img-src": ["'self'"],
      "frame-src": ["'self'"]
    }
  },
  // Required for iframe embedding in some browsers/CDNs
  crossOriginEmbedderPolicy: false,
  // Use CSP frame-ancestors instead of X-Frame-Options
  frameguard: false
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const corsOptions = { origin: allowedOrigins, credentials: true };
app.use(cors(corsOptions));
// Explicitly handle preflight for any route
app.options("*", cors(corsOptions));

const limiter = rateLimit({ windowMs: 60_000, max: 120 });
app.use(limiter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/v1", sessionsRouter);
app.use("/", widgetRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`Bridge listening on :${PORT}`);
  console.log(`[Bridge] Allowed origins for embedding: ${allowedOrigins.join(", ")}`);
});
