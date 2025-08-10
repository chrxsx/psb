import { chromium } from "playwright";

/**
 * Minimal, provider-agnostic example.
 * Replace LOGIN_URL and SELECTORS with the real portal you have permission to access.
 * This starter does NOT include any anti-detection tactics.
 */
export async function scrapeProviderX({ username, password, otp }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const LOGIN_URL = "https://example.com/login"; // TODO: set real login URL
  const SELECTORS = {
    username: 'input[name="username"]',
    password: 'input[name="password"]',
    submit: 'button[type="submit"]',
    otp: 'input[name="otp"]', // optional
    score: '#score-value',    // example location for score
    model: '#score-model',
    // Provide links or nav steps to tradeline page if necessary
  };

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.fill(SELECTORS.username, username);
    await page.fill(SELECTORS.password, password);
    await page.click(SELECTORS.submit);

    // If the portal always prompts for OTP, handle it here
    if (otp) {
      await page.waitForSelector(SELECTORS.otp, { timeout: 10000 }).catch(()=>{});
      if (await page.$(SELECTORS.otp)) {
        await page.fill(SELECTORS.otp, otp);
        await page.click(SELECTORS.submit);
      }
    }

    // Wait for post-login content
    await page.waitForLoadState("networkidle");

    // Example: extract score + model
    let scoreText = null;
    let modelText = null;
    try {
      await page.waitForSelector(SELECTORS.score, { timeout: 10000 });
      scoreText = await page.textContent(SELECTORS.score);
    } catch {}
    try {
      modelText = await page.textContent(SELECTORS.model);
    } catch {}

    const score = scoreText ? parseInt(String(scoreText).replace(/\D+/g, ""), 10) : null;
    const score_model = modelText ? String(modelText).trim() : null;

    // Example placeholder for tradelines; customize as needed
    const accounts = [];

    const payload = {
      provider: "providerx",
      provider_user_id: null,
      pulled_at: new Date().toISOString(),
      score,
      score_model,
      identity: {},
      accounts,
      inquiries: [],
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
