import { chromium } from "playwright";

/**
 * Return the first selector from the list that appears on the page within the timeout.
 * If none appear within the timeout, returns null.
 */
export async function firstAvailable(page, selectors, timeoutMs = 8000) {
  if (!Array.isArray(selectors)) selectors = [selectors].filter(Boolean);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return sel;
      } catch {}
    }
    await page.waitForTimeout(200);
  }
  return null;
}

export async function typeIfExists(page, selector, value) {
  if (!selector || value == null) return false;
  try {
    const el = await page.$(selector);
    if (!el) return false;
    await page.fill(selector, String(value));
    return true;
  } catch {
    return false;
  }
}

export async function clickIfExists(page, selector) {
  if (!selector) return false;
  try {
    const el = await page.$(selector);
    if (!el) return false;
    await page.click(selector);
    return true;
  } catch {
    return false;
  }
}

/**
 * Navigate to the first URL that successfully loads.
 */
export async function navigateFirst(page, urls, waitUntil = "domcontentloaded") {
  if (!Array.isArray(urls)) urls = [urls].filter(Boolean);
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil });
      return true;
    } catch {
      // try next
    }
  }
  // As a last resort, try the first URL without throwing
  if (urls[0]) {
    try { await page.goto(urls[0]).catch(()=>{}); } catch {}
  }
  return false;
}

/**
 * Heuristic to find a credit score number on the current page.
 */
export async function findScoreInDom(page) {
  const candidateSelectors = [
    "#score-value",
    ".score-value",
    ".score-number",
    "[data-testid='score-value']",
    "text=/Score\\s*:?\\s*[0-9]{3}/i",
  ];
  for (const sel of candidateSelectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      const text = await page.textContent(sel);
      if (!text) continue;
      const m = String(text).match(/([3-8][0-9]{2})/);
      if (m) return parseInt(m[1], 10);
    } catch {}
  }
  return null;
}
