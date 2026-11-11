// Matrix v2: corrected ink metric (alpha-aware), correct fullscreen button, robust OCR menu.
import { chromium } from 'playwright-core';

const BOOK1 = process.argv[2];
const BOOK2 = process.argv[3];
const APP = 'http://127.0.0.1:3000/';
const log = (k, v) => console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  ],
});

// alpha-aware: a transparent canvas is NOT ink, it is "not painted yet"
const INK = `(() => {
  const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
  if (!sc) return null;
  const sr = sc.getBoundingClientRect();
  const vis = [...sc.querySelectorAll('[data-page-number]')].filter(w => { const r = w.getBoundingClientRect(); return r.bottom > sr.top + 20 && r.top < sr.bottom - 20; });
  const inkOf = (c) => {
    if (!c || !c.width) return null;
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let ink = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 16) { if (d[i+3] < 10) continue; opaque++; if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) ink++; }
    if (!opaque) return null;
    return +(ink / opaque).toFixed(4);
  };
  return { pages: vis.map(w=>w.getAttribute('data-page-number')), ink: vis.map(w=>inkOf(w.querySelector('canvas'))) };
})()`;

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('Pulse Med'), null, { timeout: 60000 });

  const jsClick = (src) => page.evaluate((s) => {
    const rx = new RegExp(s, 'i');
    const el = [...document.querySelectorAll('button, div.cursor-pointer')].find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return 'not found'; el.click(); return 'clicked';
  }, src.source);

  const openOcrMenu = async () => {
    await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'OCR'); if (b) b.click(); });
    await page.waitForTimeout(1500);
    return page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /OCR/i.test(t) && t.length < 40));
  };
  const clickOcrCurrent = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /OCR current page/i.test(x.innerText));
    if (!b) return 'not found'; b.click(); return 'clicked';
  });
  const waitNote = async (limit = 25) => {
    let n = '';
    for (let i = 0; i < limit; i++) {
      await page.waitForTimeout(3000);
      n = await page.evaluate(() => document.body.innerText.split('\n').map(t => t.trim()).filter(t => /OCR (finished|stopped|error)/i.test(t)).join(' | '));
      if (n) break;
    }
    return n || '(none)';
  };

  await jsClick(/^PDF Reader/);
  await page.waitForTimeout(1200);
  await page.locator('input[type=file]').first().setInputFiles([BOOK1, BOOK2]);
  await page.waitForTimeout(5000);

  // ---------- TEST 3: scroll latency with the corrected metric ----------
  await jsClick(/Psychiatry/);
  await page.waitForTimeout(9000);
  log('t3_initial', await page.evaluate(INK));
  for (const frac of [0.3, 0.6, 0.9]) {
    const t0 = Date.now();
    await page.evaluate((f) => { const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]')); if (sc) sc.scrollTop = sc.scrollHeight * f; }, frac);
    let hit = null;
    for (let i = 0; i < 32; i++) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(INK);
      if (s && s.ink.some(v => v !== null && v > 0.01)) { hit = { ms: Date.now() - t0, state: s }; break; }
    }
    log('t3_' + Math.round(frac * 100), hit || { ms: null, state: await page.evaluate(INK) });
  }

  // ---------- TEST 4: full screen via the correct button ----------
  await page.evaluate(() => { const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]')); if (sc) sc.scrollTop = 0; });
  await page.waitForTimeout(3500);
  log('t4_buttons', await page.evaluate(() => [...document.querySelectorAll('button[title]')].map(b => b.title).filter(t => /full|fit|zoom/i.test(t))));
  log('t4_click', await page.evaluate(() => { const b = document.querySelector('button[title="Full screen"]'); if (!b) return 'not found'; b.click(); return 'clicked'; }));
  await page.waitForTimeout(1500);
  log('t4_state', await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
    const btn = document.querySelector('button[title="Full screen"]');
    const r = btn?.getBoundingClientRect();
    const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      fixed: !!sc && getComputedStyle(sc).position === 'fixed',
      buttonCovered: !!(btn && top && !btn.contains(top) && top !== btn),
      topEl: top ? top.tagName : null,
    };
  }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  log('t4_afterEsc', await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
    return { fixed: !!sc && getComputedStyle(sc).position === 'fixed' };
  }));
  log('t4_ink', await page.evaluate(INK));

  // ---------- TEST 1: text PDF must not get an OCR overlay ----------
  await jsClick(/^PDF Reader/);
  await page.waitForTimeout(1500);
  log('t1_open', await jsClick(/Antimicrobials/));
  await page.waitForTimeout(9000);
  log('t1_menu', await openOcrMenu());
  log('t1_click', await clickOcrCurrent());
  log('t1_note', await waitNote(20));
  log('t1_counts', await page.evaluate(() => ({
    nativeSpans: document.querySelectorAll('[data-page-number="1"] .textLayer span').length,
    ocrLayers: document.querySelectorAll('[data-page-number="1"] .ocrTextLayer').length,
    ocrSpans: document.querySelectorAll('[data-page-number="1"] .ocrTextLayer span').length,
  })));
} finally {
  await browser.close();
}
