import { chromium } from 'playwright-core';
const BOOK = process.argv[2];
const APP = 'http://127.0.0.1:3000/';
const log = (k, v) => console.log(k + ':', typeof v === 'string' ? v : JSON.stringify(v));
const browser = await chromium.launch({ channel: 'chrome', headless: false,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--no-first-run'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
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

  const dump = () => page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 500 && d.querySelector('[data-page-number]'));
    const canvases = [...document.querySelectorAll('[data-page-number] canvas')];
    const slots = [...document.querySelectorAll('[data-canvas-slot]')];
    return {
      scClass: sc ? sc.className.slice(0, 120) : null,
      scPosition: sc ? getComputedStyle(sc).position : null,
      scHasFixedClass: sc ? sc.classList.contains('fixed') : null,
      fixedRuleExists: [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.selectorText === '.fixed'); } catch { return false; } }),
      canvases: canvases.length,
      canvasSizes: canvases.slice(0, 3).map(c => c.width + 'x' + c.height),
      slotChildren: slots.slice(0, 3).map(s => s.children.length),
      wrappers: document.querySelectorAll('[data-page-number]').length,
    };
  });

  log('before', await dump());
  await page.evaluate(() => { const b = document.querySelector('button[title="Full screen"]'); if (b) b.click(); });
  await page.waitForTimeout(2000);
  log('immersive', await dump());
} finally { await browser.close(); }
