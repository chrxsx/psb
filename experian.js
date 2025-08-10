import { chromium } from "playwright";
import { firstAvailable, typeIfExists, clickIfExists, getText, navigateFirst, findScoreInDom } from "./utils.js";

/**
 * Experian Consumer Portal connector (template).
 * Only use with explicit user consent and partner permission.
 * This template prefers **network capture** to DOM scraping when possible.
 */
export async function scrapeExperian({ username, password, otp }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // TODO: Verify the correct login URL for the consumer portal you have permission to automate.
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

  // Capture potential XHR/Fetch calls that return JSON with score/report chunks.
  const networkPayloads = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    const ct = resp.headers()["content-type"] || "";
    if (ct.includes("application/json")) {
      try {
        const body = await resp.json();
        networkPayloads.push({ url, body });
      } catch {}
    }
  });

  try {
    await navigateFirst(page, LOGIN_URLS, "domcontentloaded");

    // Resolve selectors dynamically
    const uSel = await firstAvailable(page, SELECTORS.username);
    const pSel = await firstAvailable(page, SELECTORS.password);
    const sSel = await firstAvailable(page, SELECTORS.submit);

    await typeIfExists(page, uSel, username);
    await typeIfExists(page, pSel, password);
    await clickIfExists(page, sSel);

    // OTP step
    if (otp) {
      const oSel = await firstAvailable(page, SELECTORS.otp, 15000);
      if (oSel) {
        await typeIfExists(page, oSel, otp);
        await clickIfExists(page, sSel);
      }
    }

    await page.waitForLoadState("networkidle");

    // Optional: common dashboard routes (update as needed)
    try { await page.goto("https://usa.experian.com/", { waitUntil: "networkidle" }); } catch {}
    try { await page.goto("https://usa.experian.com/member/credit-report", { waitUntil: "networkidle" }); } catch {}

    const results = { accounts: [], inquiries: [], public_records: [], identity: {} };

    const n = (v) => {
      if (v == null) return null;
      const s = String(v);
      const m = s.replace(/[^0-9.\-]/g, "");
      if (!m) return null;
      const num = Number(m);
      return isNaN(num) ? null : num;
    };

    page.on("response", async (resp) => {
      const url = resp.url();
      const ct = (resp.headers()["content-type"] || "");
      if (!/application\/json/i.test(ct)) return;
      let body = null;
      try { body = await resp.json(); } catch { body = null; }
      if (!body || typeof body !== "object") return;

      // Primary: forcereload endpoint
      if (url.includes("/api/report/forcereload") && body?.reportInfo?.creditFileInfo?.[0]) {
        const info = body.reportInfo.creditFileInfo[0];

        // Score + model
        const scoreObj = info.score || (Array.isArray(info.scores) && info.scores[0]) || null;
        if (scoreObj) {
          const s = n(scoreObj.score ?? scoreObj.score_txt);
          if (s != null) results.score = s;
        }
        const model = info.comparisonData?.currentReport?.scoreModel || scoreObj?.scoreType || null;
        if (model) results.score_model = model;

        // Accounts
        const accs = Array.isArray(info.accounts) ? info.accounts : [];
        for (const a of accs) {
          results.accounts.push({
            type: a.category || a.type || null,
            issuer: a.accountName || null,
            open_date: a.dateOpened || null,
            credit_limit: n(a.limit || a.highBalance),
            balance: n(a.balance),
            utilization_pct: null, // Experian payload doesn't expose per-account util consistently
            status: a.paymentStatus || a.openClosed || null,
            last_payment_date: a.statusDate || null,
            delinquency: (a.delinquent30DaysCount || a.delinquent60DaysCount || a.delinquent90DaysCount)
              ? `30:${a.delinquent30DaysCount||0} 60:${a.delinquent60DaysCount||0} 90:${a.delinquent90DaysCount||0}`
              : null,
          });
        }

        // Inquiries (if present)
        const inq = Array.isArray(info.inquiries) ? info.inquiries : [];
        if (inq.length) {
          results.inquiries = inq.map(q => ({
            date: q.date || q.inquiryDate || null,
            subscriber: q.institution || q.subscriberName || null,
            bureau: "Experian"
          }));
        }

        // Public records
        const pr = Array.isArray(info.publicRecords) ? info.publicRecords : [];
        if (pr.length) results.public_records = pr;

        // Minimal identity from addresses/names if available
        const name = (Array.isArray(info.names) && info.names[0] && info.names[0].name) || null;
        const addr = (Array.isArray(info.addresses) && info.addresses[0] && info.addresses[0].streetAddress) || null;
        results.identity = { full_name: name || undefined, address: addr || undefined };
      }
    });


    // Extract via network first
    let score = null;
    let score_model = null;
    let accounts = [];
    let identity = {};
    let inquiries = [];
    let public_records = [];

    for (const p of networkPayloads) {
      // TODO: Identify which URLs return score/report data and map them.
      // Keep minimal raw fields only.
      if (/score/i.test(p.url) && typeof p.body === "object") {
        if (p.body.score) score = p.body.score;
        if (p.body.scoreModel) score_model = p.body.scoreModel;
      }
      if (/tradeline|account/i.test(p.url) && Array.isArray(p.body?.accounts)) {
        accounts = p.body.accounts;
      }
      if (/inquiry/i.test(p.url) && Array.isArray(p.body?.inquiries)) {
        inquiries = p.body.inquiries;
      }
      if (/identity|profile/i.test(p.url) && typeof p.body === "object") {
        identity = { ...identity, ...p.body };
      }
    }

    // DOM fallback (if network doesn’t expose data cleanly)
    if (score == null) {
      // TODO: Replace with actual selector on Experian dashboard.
      const SCORE_SEL = "#score-value, .score-number";
      try { await page.waitForSelector(SCORE_SEL, { timeout: 10000 }); } catch {}
      if (await page.$(SCORE_SEL)) {
        const t = await page.textContent(SCORE_SEL);
        if (t) score = parseInt(String(t).replace(/\D+/g, ""), 10);
      }
    }

    const payload = {
      provider: "experian",
      provider_user_id: results.provider_user_id || null,
      pulled_at: new Date().toISOString(),
      score: (typeof results.score === "number") ? results.score : await findScoreInDom(page),
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
