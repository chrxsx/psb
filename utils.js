export async function firstAvailable(page, selectors, timeout=8000) {
  for (const sel of selectors) {
    try {
      const el = await page.waitForSelector(sel, { timeout });
      if (el) return sel;
    } catch {}
  }
  return null;
}

export async function typeIfExists(page, selector, value) {
  if (!selector || !value) return false;
  try { await page.fill(selector, value); return true; } catch { return false; }
}

export async function clickIfExists(page, selector) {
  if (!selector) return false;
  try { await page.click(selector); return true; } catch { return false; }
}

export async function getText(page, selector) {
  try {
    const el = await page.$(selector);
    if (!el) return null;
    const t = (await el.textContent()) || "";
    return t.trim();
  } catch { return null; }
}

export async function navigateFirst(page, urls, wait="networkidle") {
  for (const u of urls) {
    try { await page.goto(u, { waitUntil: "domcontentloaded" }); break; } catch {}
  }
  await page.waitForLoadState(wait).catch(()=>{});
}

export async function findScoreInDom(page) {
  // Look for nodes whose text contains "score" and a 3-digit number between 300 and 900.
  const candidates = await page.$$(":not(script):not(style)");
  for (const el of candidates) {
    try {
      const t = ((await el.textContent()) || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      if (/score/i.test(t)) {
        const m = t.match(/\b([3-8]\d\d)\b/);
        if (m) return parseInt(m[1], 10);
      }
    } catch {}
  }
  return null;
}
