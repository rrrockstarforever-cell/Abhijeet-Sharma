// Offline test matrix: Chrome with DNS blocked for everything except localhost.
import { chromium } from 'playwright-core';

const BOOK1 = process.argv[2];   // Psychiatry (scanned)
const BOOK2 = process.argv[3];   // Antimicrobials (text PDF)
const APP = 'http://127.0.0.1:3000/';
const R = {};
const log = (k, v) => { R[k] = v; console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v)); };

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: [
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  ],
});

const INK = `(() => {
  const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
  if (!sc) return null;
  const sr = sc.getBoundingClientRect();
  const vis = [...sc.querySelectorAll('[data-page-number]')].filter(w => { const r = w.getBoundingClientRect(); return r.bottom > sr.top + 20 && r.top < sr.bottom - 20; });
  const inkOf = (c) => { if (!c || !c.width) return null; const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data; let k=0,n=0; for(let i=0;i<d.length;i+=16){n++;if(d[i]<200||d[i+1]<200||d[i+2]<200)k++;} return +(k/n).toFixed(4); };
  return { pages: vis.map(w=>w.getAttribute('data-page-number')), ink: vis.map(w=>inkOf(w.querySelector('canvas'))) };
})()`;

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const external = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(APP) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  page.on('crash', () => console.log('PAGE CRASHED'));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('Pulse Med'), null, { timeout: 60000 });

  const jsClick = (src) => page.evaluate((s) => {
    const rx = new RegExp(s, 'i');
    const el = [...document.querySelectorAll('button, div.cursor-pointer')].find((e) => rx.test((e.innerText || '').trim()));
    if (!el) return 'not found'; el.click(); return 'clicked';
  }, src.source);

  // import both books
  await jsClick(/^PDF Reader/);
  await page.waitForTimeout(1200);
  await page.locator('input[type=file]').first().setInputFiles([BOOK1, BOOK2]);
  await page.waitForTimeout(5000);

  // ---------- TEST 6: offline OCR, current page ----------
  await jsClick(/Psychiatry/);
  await page.waitForTimeout(9000);
  log('t6_canvas', await page.evaluate(() => { const c = document.querySelector('[data-page-number] canvas'); return c ? c.width + 'x' + c.height : 'none'; }));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'OCR'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  log('t6_menu', await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(t => /OCR/i.test(t) && t.length < 40)));
  log('t6_click', await jsClick(/OCR current page/));
  let note = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(3000);
    note = await page.evaluate(() => document.body.innerText.split('\n').map(t => t.trim()).filter(t => /OCR (finished|stopped|error)/i.test(t)).join(' | '));
    if (note) break;
  }
  log('t6_note', note || '(none)');
  log('t6_spans', await page.evaluate(() => document.querySelectorAll('.ocrTextLayer span').length));
  log('t6_words', await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const q = indexedDB.open('PulseMedFilesDB'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('pages', 'readonly');
    const all = await new Promise((res, rej) => { const q = tx.objectStore('pages').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    db.close();
    const p1 = all.find(x => x.pageNumber === 1);
    return { pages: all.length, p1Words: p1?.words?.length ?? 0 };
  }));

  // ---------- TEST 2: savePageText must keep words ----------
  log('t2', await page.evaluate(async () => {
    const m = await import('/src/utils/pdfLibraryDB.ts');
    const db = await new Promise((res, rej) => { const q = indexedDB.open('PulseMedFilesDB'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const tx = db.transaction('files', 'readonly');
    const files = await new Promise((res, rej) => { const q = tx.objectStore('files').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
    db.close();
    const doc = files.find(f => /Psychiatry/i.test(f.title));
    const before = await m.getPageText(doc.id, 1);
    const n0 = before?.words?.length ?? 0;
    const text0 = before?.text ?? '';
    await m.savePageText(doc.id, 1, 'x');
    const mid = await m.getPageText(doc.id, 1);
    await m.savePageText(doc.id, 1, text0);
    const after = await m.getPageText(doc.id, 1);
    return { before: n0, afterTextOnly: mid?.words?.length ?? 0, afterRestore: after?.words?.length ?? 0, pass: n0 > 0 && (mid?.words?.length ?? 0) === n0 && (after?.words?.length ?? 0) === n0 };
  }));

  // ---------- TEST 3: scroll latency ----------
  const scrollTest = async (frac) => {
    const t0 = Date.now();
    await page.evaluate((f) => { const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]')); if (sc) sc.scrollTop = sc.scrollHeight * f; }, frac);
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(INK);
      if (s && s.ink.some(v => (v ?? 0) > 0.01)) return { frac, ms: Date.now() - t0, state: s };
    }
    return { frac, ms: null, state: await page.evaluate(INK) };
  };
  log('t3_30', await scrollTest(0.3));
  log('t3_60', await scrollTest(0.6));
  log('t3_90', await scrollTest(0.9));

  // ---------- TEST 4: full screen ----------
  await page.evaluate(() => { const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]')); if (sc) sc.scrollTop = 0; });
  await page.waitForTimeout(3000);
  log('t4_click', await page.evaluate(() => { const b = document.querySelector('.lucide-maximize')?.closest('button'); if (!b) return 'not found'; b.click(); return 'clicked'; }));
  await page.waitForTimeout(1500);
  log('t4_state', await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
    const btn = document.querySelector('.lucide-maximize')?.closest('button');
    const r = btn?.getBoundingClientRect();
    const top = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
    return {
      fixed: !!sc && getComputedStyle(sc).position === 'fixed',
      coversToolbar: !!(btn && top && !btn.contains(top) && top !== btn),
      topEl: top ? (top.tagName + '.' + (top.className || '').toString().slice(0, 30)) : null,
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
  await page.waitForTimeout(1200);
  await jsClick(/Antimicrobials/);
  await page.waitForTimeout(9000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'OCR'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  log('t1_click', await jsClick(/OCR current page/));
  let note1 = '';
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    note1 = await page.evaluate(() => document.body.innerText.split('\n').map(t => t.trim()).filter(t => /OCR (finished|stopped|error)/i.test(t)).join(' | '));
    if (note1) break;
  }
  log('t1_note', note1 || '(none)');
  log('t1_counts', await page.evaluate(() => ({
    nativeSpans: document.querySelectorAll('[data-page-number="1"] .textLayer span').length,
    ocrLayers: document.querySelectorAll('[data-page-number="1"] .ocrTextLayer').length,
  })));

  log('external', external.filter(u => !/fonts\.googleapis/.test(u)).slice(0, 8));
} finally {
  await browser.close();
}
