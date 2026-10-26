// Offline OCR test: launches Edge with DNS blocked for every host except localhost, then runs
// OCR and asserts it worked with no external network. Playwright owns the browser lifecycle, so
// the instance cannot be reaped between steps.
import { chromium } from 'playwright-core';

const BOOK = process.argv[2];
const APP = 'http://127.0.0.1:3000/';
const out = { steps: [], external: [], pass: false };
const log = (k, v) => { out.steps.push({ [k]: v }); console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v)); };

const browser = await chromium.launch({
  channel: 'msedge',
  headless: false,
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
  ],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const note = (u, extra = '') => {
    if (!u.startsWith(APP) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) {
      out.external.push(u + (extra ? ' ' + extra : ''));
    }
  };
  page.on('crash', () => console.log('PAGE CRASHED'));
  page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 200)));
  page.on('request', (r) => note(r.url()));
  page.on('requestfailed', (r) => note(r.url(), 'FAILED ' + (r.failure()?.errorText || '')));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('Pulse Med'), null, { timeout: 60000 });
  log('title', await page.title());

  log('jsdelivr', await page.evaluate(async () => {
    try { const r = await fetch('https://cdn.jsdelivr.net/npm/tesseract.js/package.json', { cache: 'no-store' }); return 'REACHED ' + r.status; }
    catch (e) { return 'BLOCKED: ' + e.message; }
  }));
  log('unpkg', await page.evaluate(async () => {
    try { const r = await fetch('https://unpkg.com/tesseract.js/package.json', { cache: 'no-store' }); return 'REACHED ' + r.status; }
    catch (e) { return 'BLOCKED: ' + e.message; }
  }));
  log('local asset', await page.evaluate(async () => {
    try { const r = await fetch('/tesseract/worker.min.js', { cache: 'no-store' }); const t = await r.text(); return 'OK ' + r.status + ' ' + t.length + 'B'; }
    catch (e) { return 'FAILED: ' + e.message; }
  }));

  const jsClick = (re) => page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button, div.cursor-pointer')]
      .find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return 'not found';
    el.click();
    return 'clicked';
  }, re.source);

  log('nav', await jsClick(/^PDF Reader/));
  await page.waitForTimeout(1500);
  await page.locator('input[type=file]').first().setInputFiles(BOOK);
  await page.waitForTimeout(4000);
  log('open book', await jsClick(/Psychiatry/));
  await page.waitForTimeout(9000);
  log('canvas', await page.evaluate(() => {
    const c = document.querySelector('[data-page-number] canvas');
    return c ? c.width + 'x' + c.height : 'none';
  }));

  log('ocr menu', await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === 'OCR');
    if (!b) return 'not found'; b.click(); return 'clicked';
  }));
  await page.waitForTimeout(1200);
  log('ocr page', await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /OCR current page/i.test(x.innerText));
    if (!b) return 'not found'; b.click(); return 'clicked';
  }));

  let noteText = '';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    noteText = await page.evaluate(() => {
      const lines = document.body.innerText.split('\n').map((t) => t.trim());
      return lines.filter((t) => /OCR (finished|stopped|error)/i.test(t)).join(' | ');
    });
    if (noteText) break;
  }
  log('note', noteText || '(none after 120s)');
  log('spans', await page.evaluate(() => document.querySelectorAll('.ocrTextLayer span').length));
  log('stored', await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('PulseMedFilesDB'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('pages', 'readonly');
    const all = await new Promise((res, rej) => { const q = tx.objectStore('pages').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    db.close();
    const p1 = all.find((x) => x.pageNumber === 1);
    return { pages: all.length, p1Words: p1?.words?.length ?? 0, p1TextLen: (p1?.text || '').length };
  }));

  const stored = out.steps.find((s) => s.stored)?.stored;
  const spans = out.steps.find((s) => s.spans)?.spans;
  out.pass = /OCR finished: 1 page recognised/i.test(noteText) && stored?.p1Words > 0 && spans > 0 && out.external.length === 0;
  log('external requests', out.external.length ? out.external.slice(0, 10) : 'none');
  log('PASS', out.pass);
} finally {
  await browser.close();
}
