import { chromium } from "playwright";
import { firstAvailable, typeIfExists, clickIfExists, getText, navigateFirst, findScoreInDom } from "./utils.js";

/**
 * Credit Karma connector (template).
 * Use only with explicit user consent and permission; CK frequently uses 2FA and bot controls.
 * This template captures network JSON when possible and falls back to DOM.
 */
export async function scrapeCreditKarma({ username, password, otp }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // TODO: Validate the actual consumer login URL for CK in your scenario.
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

  
  // Attach request map to capture GraphQL operationName
  const reqMap = new Map();
  page.on("request", (req) => {
    try {
      const url = req.url();
      if (url.includes("/graphql") && (req.method() === "POST")) {
        const pd = req.postData();
        if (!pd) return;
        let body = null;
        try { body = JSON.parse(pd); } catch {}
        if (Array.isArray(body)) {
          body.forEach((item, idx) => {
            reqMap.set(`${req._guid || req.url()}#${idx}`, {
              operationName: item?.operationName,
              variables: item?.variables
            });
          });
        } else if (body && typeof body === "object") {
          reqMap.set(req._guid || req.url(), {
            operationName: body?.operationName,
            variables: body?.variables
          });
        }
      }
    } catch {}
  });

  const results = { accounts: [], inquiries: [], public_records: [], identity: {} };

  // Finalize from CreditReportsV2 if present
  function mapFromCrV2(cr) {
    if (!cr) return;
    // Score & model
    if (typeof cr.score === "number") results.score = results.score ?? cr.score;
    // CK typically shows VantageScore but model label isn't always provided; leave null if unknown
    // Tradelines
    const tl = cr.tradelines || {};
    const buckets = ["creditCards","autoLoans","realEstateLoans","studentLoans","otherLoans","boostedAccounts","otherAccounts"];
    for (const b of buckets) {
      const arr = Array.isArray(tl[b]) ? tl[b] : [];
      for (const t of arr) {
        const amt = (node) => {
          if (!node || typeof node !== "object") return null;
          const a = node.amount ?? node.value ?? null;
          return a != null ? Number(String(a).replace(/[^0-9.\-]/g, "")) : null;
        };
        const get = (x, k) => (x && x[k] !== undefined ? x[k] : null);
        results.accounts.push({
          type: b,
          issuer: get(t, "accountName") || get(t, "portfolioType") || null,
          open_date: get(t, "dateOpened") || null,
          credit_limit: amt(t.limit),
          balance: amt(t.currentBalance) ?? (function() {
            // Try text fallback like "$35"
            try {
              const s = (((t.balanceTextSplit||{}).additionalDetailsFields||[])[0]||{}).fieldValueText?.spans?.[0]?.text;
              return s ? Number(s.replace(/[^0-9.\-]/g, "")) : null;
            } catch(_) { return null; }
          })(),
          utilization_pct: (typeof t.utilizationPercentage === "number" ? t.utilizationPercentage : (typeof t.utilization === "number" ? Math.round(t.utilization*100) : null)),
          status: get(t, "openClosed") || get(t, "accountStanding") || null,
          last_payment_date: get(t, "dateLastPayment") || null,
          delinquency: (function(){
            const c30 = get(t,"late30Count"); const c60 = get(t,"late60Count"); const c90 = get(t,"late90Count");
            return (c30||c60||c90) ? `30:${c30||0} 60:${c60||0} 90:${c90||0}` : null;
          })(),
        });
      }
    }
    // Inquiries
    if (Array.isArray(cr.inquiries)) {
      results.inquiries = results.inquiries.length ? results.inquiries : cr.inquiries.map(q => ({
        date: q.dateInquired || null,
        subscriber: (q.institution && (q.institution.name || q.institution.addressText?.spans?.[0]?.text?.split('\\n')[0])) || null,
        bureau: "Equifax" if cr.creditBureauId == "EQUIFAX" else null
      }));
    }
    // Public records
    const pr = cr.publicRecords || {};
    const prBuckets = ["bankruptcies","legalItems","taxLiens","miscPublicRecords"];
    const allPR = [];
    for (const b of prBuckets) {
      const arr = Array.isArray(pr[b]) ? pr[b] : [];
      for (const r of arr) allPR.append(r);
    }
    if (allPR.length && (!results.public_records || !results.public_records.length)) results.public_records = allPR;
    // Provider user id if present
    results.provider_user_id = results.provider_user_id || cr.reportId || null;
  }


  page.on("response", async (resp) => {
    const url = resp.url();
    if (!url.includes("/graphql")) return;
    let body = null;
    try {
      body = await resp.json();
    } catch {
      return;
    }

    const request = resp.request();
    let meta = reqMap.get(request._guid) || reqMap.get(request.url()) || null;

    const payloads = Array.isArray(body) ? body : [body];
    for (let i = 0; i < payloads.length; i++) {
      const pl = payloads[i];
      const data = pl?.data;
      const op = meta?.operationName || pl?.operationName || null;

      const cr = data?.getCreditReport || data?.creditReport || data?.creditReportsV2?.creditReport || null;
      if (cr) {
      if (data?.creditReportsV2?.creditReport) { mapFromCrV2(data.creditReportsV2.creditReport); }

        // score + model
        const sc =
          cr.score ??
          cr.creditScore?.value ??
          cr.currentScore ??
          cr.scoreValue ??
          null;

        const sm =
          cr.scoreModel ??
          cr.creditScore?.model ??
          cr.scoreType ??
          cr.model ??
          null;

        if (typeof sc === "number") results.score = results.score ?? sc;
        if (sm) results.score_model = results.score_model ?? sm;

        // inquiries
        let inq = [];
        if (Array.isArray(cr.inquiries)) inq = cr.inquiries;
        else if (Array.isArray(cr.inquiries?.items)) inq = cr.inquiries.items;
        results.inquiries = results.inquiries.length ? results.inquiries : inq;

        // public records
        let pr = [];
        if (Array.isArray(cr.publicRecords)) pr = cr.publicRecords;
        else if (Array.isArray(cr.publicRecords?.items)) pr = cr.publicRecords.items;
        results.public_records = results.public_records.length ? results.public_records : pr;

        // identity/user id if available
        results.provider_user_id = results.provider_user_id ?? (cr.userId || cr.memberId || null);
        if (cr.identity || cr.profile) {
          results.identity = { ...results.identity, ...(cr.identity || {}), ...(cr.profile || {}) };
        }

        // tradelines flatten
        const tl = cr.tradelines || cr.creditReportTradelines || {};
        const buckets = Object.keys(tl);
        for (const b of buckets) {
          const arr = Array.isArray(tl[b]) ? tl[b] : [];
          for (const t of arr) {
            results.accounts.push({
              type: b,
              issuer: t?.issuer ?? t?.lender ?? t?.creditorName ?? null,
              open_date: t?.openDate ?? t?.openedOn ?? t?.openDateStr ?? null,
              credit_limit: t?.creditLimit ?? t?.highCredit ?? t?.originalLoanAmount ?? null,
              balance: t?.balance ?? t?.currentBalance ?? null,
              utilization_pct: t?.utilizationPct ?? t?.utilization ?? null,
              status: t?.status ?? t?.accountStatus ?? null,
              last_payment_date: t?.lastPaymentDate ?? t?.lastPaymentOn ?? null,
              delinquency: t?.delinquencyStatus ?? t?.pastDueStatus ?? null,
            });
          }
        }
        continue;
      }

      // Profile/dashboard fallback containers
      const prof = data?.profileOverview?.getProfileOverview || data?.getProfileOverview || null;
      if (prof?.cards && Array.isArray(prof.cards)) {
        for (const card of prof.cards) {
          const maybe =
            card?.score ?? card?.vantageScore ?? card?.ficoScore ?? card?.value ?? null;
          if (!results.score && typeof maybe === "number" && maybe >= 300 && maybe <= 900) {
            results.score = maybe;
            results.score_model = results.score_model ?? (card?.scoreModel || card?.model || null);
          }
        }
      }
    }
  });
      } catch {}
    }
  });

  try {
    await navigateFirst(page, LOGIN_URLS, "domcontentloaded");

    const uSel = await firstAvailable(page, SELECTORS.username);
    const pSel = await firstAvailable(page, SELECTORS.password);
    const sSel = await firstAvailable(page, SELECTORS.submit);

    await typeIfExists(page, uSel, username);
    await typeIfExists(page, pSel, password);
    await clickIfExists(page, sSel);

    if (otp) {
      const oSel = await firstAvailable(page, SELECTORS.otp, 20000);
      if (oSel) {
        await typeIfExists(page, oSel, otp);
        await clickIfExists(page, sSel);
      }
    }

    await page.waitForLoadState("networkidle");

    // Optional: hop to score/dashboard pages (if needed)
    try { await page.goto("https://www.creditkarma.com/credit-score", { waitUntil: "networkidle" }); } catch {}
    try { await page.goto("https://www.creditkarma.com/dashboard", { waitUntil: "networkidle" }); } catch {}

    // Parse network responses
    let score = null;
    let score_model = null;
    let accounts = [];
    let identity = {};
    let inquiries = [];

    for (const p of networkPayloads) {
      // Look for API responses that include score and tradelines.
      if (/score|vantage/i.test(p.url) && typeof p.body === "object") {
        if (p.body.score) score = p.body.score;
        if (p.body.model) score_model = p.body.model;
      }
      if (/tradeline|accounts/i.test(p.url) && Array.isArray(p.body?.accounts)) {
        accounts = p.body.accounts;
      }
      if (/identity|profile/i.test(p.url) && typeof p.body === "object") {
        identity = { ...identity, ...p.body };
      }
      if (/inquiries/i.test(p.url) && Array.isArray(p.body?.inquiries)) {
        inquiries = p.body.inquiries;
      }
    }

    // DOM fallback
    if (score == null) {
      const SCORE_SEL = "[data-testid='score-value'], .score-value, .vantage-score";
      try { await page.waitForSelector(SCORE_SEL, { timeout: 10000 }); } catch {}
      if (await page.$(SCORE_SEL)) {
        const t = await page.textContent(SCORE_SEL);
        if (t) score = parseInt(String(t).replace(/\D+/g, ""), 10);
      }
    }

    const payload = {
      provider: "creditkarma",
      provider_user_id: null,
      pulled_at: new Date().toISOString(),
      score,
      score_model,
      identity,
      accounts,
      inquiries,
      public_records: [],
      raw_snapshot: {}
    };

    return payload;
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}
