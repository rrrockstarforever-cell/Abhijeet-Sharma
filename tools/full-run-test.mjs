import { chromium } from 'playwright-core';
const BOOK = process.argv[2];
const APP = 'http://127.0.0.1:3000/';
const log = (k, v) => console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v));
const browser = await chromium.launch({ channel: 'chrome', headless: false,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--no-first-run', '--disable-background-networking'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const external = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(APP) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
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

  // open the OCR panel, tick Force, then OCR every page
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'OCR'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  log('panel', await page.evaluate(() => [...document.querySelectorAll('button, label')].map(e => (e.innerText || '').trim()).filter(t => /OCR|Force/i.test(t) && t.length < 60)));
  log('force', await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find(l => /Force OCR/i.test(l.innerText || ''));
    const box = label?.querySelector('input[type=checkbox]') || [...document.querySelectorAll('input[type=checkbox]')].find(c => /force/i.test(c.closest('label')?.innerText || ''));
    if (!box) return 'checkbox not found';
    if (!box.checked) box.click();
    return box.checked ? 'checked' : 'not checked';
  }));
  await page.waitForTimeout(600);
  log('start', await jsClick(/OCR pages without text/));
  const t0 = Date.now();
  let note = '';
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(3000);
    note = await page.evaluate(() => document.body.innerText.split('\n').map(t => t.trim()).filter(t => /OCR (finished|stopped|error)/i.test(t)).join(' | '));
    if (note) break;
    if (i % 10 === 0) {
      const p = await page.evaluate(() => document.body.innerText.split('\n').map(t => t.trim()).filter(t => /page \d+ (of|done)/i.test(t)).slice(0, 1).join(''));
      console.log('  progress', Math.round((Date.now() - t0) / 1000) + 's', p || '');
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  log('note', note || '(none)');
  log('elapsed_s', secs);
  log('stored', await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('PulseMedFilesDB'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('pages', 'readonly');
    const all = await new Promise((res, rej) => { const q = tx.objectStore('pages').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    db.close();
    const withWords = all.filter(x => x.words && x.words.length);
    return { pages: all.length, withWords: withWords.length, missing: 79 - withWords.length, totalWords: withWords.reduce((a, x) => a + x.words.length, 0) };
  }));
  log('external', external.filter(u => !/fonts\.googleapis/.test(u)).slice(0, 6));
} finally { await browser.close(); }
