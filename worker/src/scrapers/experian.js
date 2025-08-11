import { chromium } from "playwright";
import { firstAvailable, typeIfExists, clickIfExists, navigateFirst, findScoreInDom } from "./utils.js";

/**
 * Experian Consumer Portal connector (template).
 * Prefer network capture over DOM when possible. Use only with user consent.
 */
export async function scrapeExperian({ username, password, otp }) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Validate and tune these as needed based on the portal you have permission to automate
  const LOGIN_URLS = [
    "https://www.experian.com/login/",
    "https://usa.experian.com/login/",
    "https://www.experian.com/consumer/login",
  ];
  const SELECTORS = {
    username: ['input[name="username"]', 'input#username', 'input[type="email"]', 'input[name="email"]'],
    password: ['input[name="password"]', 'input#password', 'input[type="password"]'],
    submit: ['button[type="submit"]', 'button#signIn', 'button[data-testid="sign-in-button"]'],
    otp: ['input[name="otp"]', 'input[name="code"]', 'input#otp', 'input[name="oneTimeCode"]']
  };

  // Collect JSON responses for mapping
  const networkPayloads = [];
  page.on("response", async (resp) => {
    const ct = resp.headers()["content-type"] || "";
    if (!/application\/json/i.test(ct)) return;
    try {
      const body = await resp.json();
      networkPayloads.push({ url: resp.url(), body });
    } catch {}
  });

  try {
    await navigateFirst(page, LOGIN_URLS, "domcontentloaded");

    const uSel = await firstAvailable(page, SELECTORS.username);
    const pSel = await firstAvailable(page, SELECTORS.password);
    const sSel = await firstAvailable(page, SELECTORS.submit);

    await typeIfExists(page, uSel, username);
    await typeIfExists(page, pSel, password);
    await clickIfExists(page, sSel);

    // If OTP is not provided but an OTP field appears, signal to caller
    if (!otp) {
      const maybeOtpSel = await firstAvailable(page, SELECTORS.otp, 12000);
      if (maybeOtpSel) {
        throw new Error("__OTP_REQUIRED__");
      }
    } else {
      const oSel = await firstAvailable(page, SELECTORS.otp, 15000);
      if (oSel) {
        await typeIfExists(page, oSel, otp);
        await clickIfExists(page, sSel);
      }
    }

    await page.waitForLoadState("networkidle");

    // Optional navigations post-login
    try { await page.goto("https://usa.experian.com/", { waitUntil: "networkidle" }); } catch {}
    try { await page.goto("https://usa.experian.com/member/credit-report", { waitUntil: "networkidle" }); } catch {}

    const results = { accounts: [], inquiries: [], public_records: [], identity: {} };

    const toNumber = (v) => {
      if (v == null) return null;
      const m = String(v).replace(/[^0-9.\-]/g, "");
      if (!m) return null;
      const num = Number(m);
      return Number.isNaN(num) ? null : num;
    };

    // Map specific JSON response shapes (e.g., forcereload)
    page.on("response", async (resp) => {
      try {
        const url = resp.url();
        const ct = (resp.headers()["content-type"] || "");
        if (!/application\/json/i.test(ct)) return;
        const body = await resp.json();
        if (!body || typeof body !== "object") return;

        if (url.includes("/api/report/forcereload") && body?.reportInfo?.creditFileInfo?.[0]) {
          const info = body.reportInfo.creditFileInfo[0];

          const scoreObj = info.score || (Array.isArray(info.scores) && info.scores[0]) || null;
          if (scoreObj) {
            const s = toNumber(scoreObj.score ?? scoreObj.score_txt);
            if (s != null) results.score = s;
          }
          const model = info.comparisonData?.currentReport?.scoreModel || scoreObj?.scoreType || null;
          if (model) results.score_model = model;

          const accs = Array.isArray(info.accounts) ? info.accounts : [];
          for (const a of accs) {
            results.accounts.push({
              type: a.category || a.type || null,
              issuer: a.accountName || null,
              open_date: a.dateOpened || null,
              credit_limit: toNumber(a.limit || a.highBalance),
              balance: toNumber(a.balance),
              utilization_pct: null,
              status: a.paymentStatus || a.openClosed || null,
              last_payment_date: a.statusDate || null,
              delinquency: (a.delinquent30DaysCount || a.delinquent60DaysCount || a.delinquent90DaysCount)
                ? `30:${a.delinquent30DaysCount||0} 60:${a.delinquent60DaysCount||0} 90:${a.delinquent90DaysCount||0}`
                : null,
            });
          }

          const inq = Array.isArray(info.inquiries) ? info.inquiries : [];
          if (inq.length) {
            results.inquiries = inq.map(q => ({
              date: q.date || q.inquiryDate || null,
              subscriber: q.institution || q.subscriberName || null,
              bureau: "Experian"
            }));
          }

          const pr = Array.isArray(info.publicRecords) ? info.publicRecords : [];
          if (pr.length) results.public_records = pr;

          const name = (Array.isArray(info.names) && info.names[0] && info.names[0].name) || null;
          const addr = (Array.isArray(info.addresses) && info.addresses[0] && info.addresses[0].streetAddress) || null;
          results.identity = { full_name: name || undefined, address: addr || undefined };
        }
      } catch {}
    });

    // DOM fallback for score
    if (typeof results.score !== "number") {
      const SCORE_SEL = "#score-value, .score-number";
      try { await page.waitForSelector(SCORE_SEL, { timeout: 10000 }); } catch {}
      if (await page.$(SCORE_SEL)) {
        const t = await page.textContent(SCORE_SEL);
        if (t) results.score = parseInt(String(t).replace(/\D+/g, ""), 10);
      }
    }

    const payload = {
      provider: "experian",
      provider_user_id: results.provider_user_id || null,
      pulled_at: new Date().toISOString(),
      score: typeof results.score === "number" ? results.score : await findScoreInDom(page),
      score_model: results.score_model || null,
      identity: results.identity || {},
      accounts: results.accounts || [],
      inquiries: results.inquiries || [],
      public_records: results.public_records || [],
      raw_snapshot: {}
    };
    return payload;
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}
