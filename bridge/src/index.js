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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:8082";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));
app.use("/public", express.static(path.join(__dirname, "..", "public")));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "frame-ancestors": ["'self'", ALLOWED_ORIGIN],
      "connect-src": ["'self'"],
      "img-src": ["'self'"],
      "frame-src": ["'self'"]
    }
  }
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));

const limiter = rateLimit({ windowMs: 60_000, max: 120 });
app.use(limiter);

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/v1", sessionsRouter);
app.use("/", widgetRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => console.log(`Bridge listening on :${PORT}`));
