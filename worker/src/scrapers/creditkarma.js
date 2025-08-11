import { chromium } from "playwright";
import { firstAvailable, typeIfExists, clickIfExists, navigateFirst, findScoreInDom } from "./utils.js";

/**
 * Credit Karma connector.
 * Capture GraphQL JSON when possible; fall back to DOM scraping for score.
 * Use only with explicit user consent and permission.
 */
export async function scrapeCreditKarma({ username, password, otp }) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const LOGIN_URLS = [
    "https://www.creditkarma.com/auth/logon",
    "https://www.creditkarma.com/auth/signon",
    "https://www.creditkarma.com/login",
  ];
  const SELECTORS = {
    username: ['input[name="username"]', 'input#username', 'input[type="email"]', 'input[name="email"]'],
    password: ['input[name="password"]', 'input#password', 'input[type="password"]'],
    submit: ['button[type="submit"]', 'button[data-testid="sign-in-button"]', 'button[name="signIn"]'],
    otp: ['input[name="otp"]', 'input[name="code"]', 'input#otp', 'input[name="oneTimeCode"]']
  };

  // Track GraphQL operation metadata for responses
  const requestMeta = new Map();
  page.on("request", (req) => {
    try {
      const url = req.url();
      if (url.includes("/graphql") && req.method() === "POST") {
        const postData = req.postData();
        if (!postData) return;
        let body = null;
        try { body = JSON.parse(postData); } catch {}
        if (Array.isArray(body)) {
          body.forEach((item, idx) => {
            requestMeta.set(`${req._guid || req.url()}#${idx}`, {
              operationName: item?.operationName,
              variables: item?.variables
            });
          });
        } else if (body && typeof body === "object") {
          requestMeta.set(req._guid || req.url(), {
            operationName: body?.operationName,
            variables: body?.variables
          });
        }
      }
    } catch {}
  });

  const results = { accounts: [], inquiries: [], public_records: [], identity: {} };

  function pushFromCreditReport(cr) {
    if (!cr || typeof cr !== "object") return;
    // Score & model
    const score = cr.score ?? cr.creditScore?.value ?? cr.currentScore ?? cr.scoreValue ?? null;
    const model = cr.scoreModel ?? cr.creditScore?.model ?? cr.scoreType ?? cr.model ?? null;
    if (typeof score === "number") results.score = results.score ?? score;
    if (model) results.score_model = results.score_model ?? model;

    // Inquiries
    let inquiries = [];
    if (Array.isArray(cr.inquiries)) inquiries = cr.inquiries;
    else if (Array.isArray(cr.inquiries?.items)) inquiries = cr.inquiries.items;
    if (!results.inquiries.length) {
      results.inquiries = inquiries.map((q) => ({
        date: q?.date || q?.dateInquired || null,
        subscriber: q?.institution?.name || q?.subscriber || null,
        bureau: (q?.creditBureauId === "EQUIFAX" ? "Equifax" : q?.creditBureauId === "TRANSUNION" ? "TransUnion" : q?.creditBureauId === "EXPERIAN" ? "Experian" : null)
      }));
    }

    // Public records (shape varies; keep raw list if present)
    const pr = cr.publicRecords || cr.publicRecordsV2 || {};
    const buckets = Array.isArray(pr) ? [pr] : Object.values(pr).filter(Array.isArray);
    const flat = [];
    for (const arr of buckets) for (const r of (Array.isArray(arr) ? arr : [])) flat.push(r);
    if (flat.length && !results.public_records.length) results.public_records = flat;

    // Identity
    if (cr.identity || cr.profile) results.identity = { ...results.identity, ...(cr.identity || {}), ...(cr.profile || {}) };

    // Tradelines
    const tl = cr.tradelines || cr.creditReportTradelines || {};
    for (const key of Object.keys(tl)) {
      const arr = Array.isArray(tl[key]) ? tl[key] : [];
      for (const t of arr) {
        const toNumber = (v) => v == null ? null : Number(String(v).replace(/[^0-9.\-]/g, ""));
        results.accounts.push({
          type: key,
          issuer: t?.issuer ?? t?.lender ?? t?.creditorName ?? t?.accountName ?? null,
          open_date: t?.openDate ?? t?.openedOn ?? t?.openDateStr ?? null,
          credit_limit: toNumber(t?.creditLimit ?? t?.highCredit ?? t?.originalLoanAmount),
          balance: toNumber(t?.balance ?? t?.currentBalance),
          utilization_pct: typeof t?.utilizationPct === "number" ? t.utilizationPct : (typeof t?.utilization === "number" ? Math.round(t.utilization * 100) : null),
          status: t?.status ?? t?.accountStatus ?? t?.openClosed ?? null,
          last_payment_date: t?.lastPaymentDate ?? t?.lastPaymentOn ?? null,
          delinquency: (function(){
            const c30 = t?.late30Count ?? t?.delinquent30DaysCount;
            const c60 = t?.late60Count ?? t?.delinquent60DaysCount;
            const c90 = t?.late90Count ?? t?.delinquent90DaysCount;
            return (c30||c60||c90) ? `30:${c30||0} 60:${c60||0} 90:${c90||0}` : null;
          })(),
        });
      }
    }
  }

  // Capture GraphQL responses and map
  page.on("response", async (resp) => {
    try {
      const url = resp.url();
      if (!url.includes("/graphql")) return;
      const request = resp.request();
      const meta = requestMeta.get(request._guid) || requestMeta.get(request.url()) || null;
      let body = await resp.json();
      const parts = Array.isArray(body) ? body : [body];
      for (const pl of parts) {
        const data = pl?.data || {};
        const cr = data?.getCreditReport || data?.creditReport || data?.creditReportsV2?.creditReport || null;
        if (cr) pushFromCreditReport(cr);
        const prof = data?.profileOverview?.getProfileOverview || data?.getProfileOverview || null;
        if (prof?.cards && Array.isArray(prof.cards)) {
          for (const card of prof.cards) {
            const maybe = card?.score ?? card?.vantageScore ?? card?.ficoScore ?? card?.value ?? null;
            if (!results.score && typeof maybe === "number" && maybe >= 300 && maybe <= 900) {
              results.score = maybe;
              results.score_model = results.score_model ?? (card?.scoreModel || card?.model || null);
            }
          }
        }
      }
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

    // OTP signaling
    if (!otp) {
      const maybeOtpSel = await firstAvailable(page, SELECTORS.otp, 15000);
      if (maybeOtpSel) {
        throw new Error("__OTP_REQUIRED__");
      }
    } else {
      const oSel = await firstAvailable(page, SELECTORS.otp, 20000);
      if (oSel) {
        await typeIfExists(page, oSel, otp);
        await clickIfExists(page, sSel);
      }
    }

    await page.waitForLoadState("networkidle");

    // Navigate to score/dashboard pages (optional)
    try { await page.goto("https://www.creditkarma.com/credit-score", { waitUntil: "networkidle" }); } catch {}
    try { await page.goto("https://www.creditkarma.com/dashboard", { waitUntil: "networkidle" }); } catch {}

    // DOM fallback for score
    if (typeof results.score !== "number") {
      const SCORE_SEL = "[data-testid='score-value'], .score-value, .vantage-score";
      try { await page.waitForSelector(SCORE_SEL, { timeout: 10000 }); } catch {}
      if (await page.$(SCORE_SEL)) {
        const t = await page.textContent(SCORE_SEL);
        if (t) {
          const v = parseInt(String(t).replace(/\D+/g, ""), 10);
          if (!Number.isNaN(v)) results.score = v;
        }
      }
    }

    const payload = {
      provider: "creditkarma",
      provider_user_id: results.provider_user_id || null,
      pulled_at: new Date().toISOString(),
      score: results.score ?? null,
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
