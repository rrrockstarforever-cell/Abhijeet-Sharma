// Focused full-screen test: immersive applies, exit button is reachable, Esc and the button both exit.
import { chromium } from 'playwright-core';
const BOOK = process.argv[2];
const APP = 'http://127.0.0.1:3000/';
const log = (k, v) => console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v));

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
         '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
});
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

  await jsClick(/^PDF Reader/);
  await page.waitForTimeout(1200);
  await page.locator('input[type=file]').first().setInputFiles(BOOK);
  await page.waitForTimeout(4000);
  await jsClick(/Psychiatry/);
  await page.waitForTimeout(9000);

  const state = () => page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
    const exit = document.querySelector('button[title="Exit full screen"]');
    let exitOnTop = null;
    if (exit) {
      const r = exit.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      exitOnTop = !!(top && (top === exit || exit.contains(top)));
    }
    const c = document.querySelector('[data-page-number] canvas');
    let ink = null;
    if (c && c.width) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let k = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { if (d[i+3] < 10) continue; n++; if (d[i] < 200 || d[i+1] < 200 || d[i+2] < 200) k++; }
      ink = n ? +(k / n).toFixed(4) : null;
    }
    return {
      fixed: !!sc && getComputedStyle(sc).position === 'fixed',
      exitButton: !!exit,
      exitOnTop,
      ink,
    };
  });

  log('before', await state());
  log('click', await page.evaluate(() => { const b = document.querySelector('button[title="Full screen"]'); if (!b) return 'not found'; b.click(); return 'clicked'; }));
  await page.waitForTimeout(1500);
  log('immersive', await state());

  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  log('afterEsc', await state());

  // enter again and leave via the visible button
  await page.evaluate(() => { const b = document.querySelector('button[title="Full screen"]'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  log('reentered', await state());
  log('exitClick', await page.evaluate(() => { const b = document.querySelector('button[title="Exit full screen"]'); if (!b) return 'not found'; b.click(); return 'clicked'; }));
  await page.waitForTimeout(1200);
  log('afterExitButton', await state());
} finally {
  await browser.close();
}
