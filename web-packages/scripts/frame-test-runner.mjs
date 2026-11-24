#!/usr/bin/env node
/**
 * Headless frame-test driver (zero-dep): drives the in-browser Mocha page
 * `http://localhost:8080/auto-frame-test` via system Chrome CDP, waits for the
 * run to finish, and prints per-fixture pass/fail (+ failed-metric message).
 *
 * Replaces the lost scripts/frame-test-runner.mjs for the lottie2ge loop.
 *
 * Usage:
 *   node scripts/frame-test-runner.mjs                          # all fixtures
 *   node scripts/frame-test-runner.mjs --fixture="Live chatbot" # substring filter
 *   node scripts/frame-test-runner.mjs --max=20                 # first 20
 *   node scripts/frame-test-runner.mjs --url=http://localhost:8081/ge-auto-frame-test --only=260306_
 *   node scripts/frame-test-runner.mjs --url=http://localhost:8081/ge-auto-frame-test --exact=6.json
 *   node scripts/frame-test-runner.mjs --url=http://localhost:8080/auto-frame-test --fixture=...
 *   node scripts/frame-test-runner.mjs --fixture=... --output=tmp/frame-comparison/example
 *
 * Output: JSON on stdout. With --output, also saves the report, full-page comparison, and source frames.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFrameTestReport } from './frame-test-report.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)=(.*)$/) ?? a.match(/^--(.+)$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);

const BASE = (args.url || 'http://localhost:8080/auto-frame-test').replace(/\/$/, '');
const SVG_BATCH_URL = /\/svg-auto-frame-test(?:\.html)?(?:[/?#]|$)/.test(BASE);
const CHROME_CANDIDATES = [
  ...(SVG_BATCH_URL ? [process.env.CHROME_EXECUTABLE] : []),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.CHROME_EXECUTABLE,
];
const CHROME = CHROME_CANDIDATES.find(p => p != null && fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Chromium/Edge found.'); process.exit(2); }

const PORT = 9456 + Math.floor((process.pid % 1000)); // avoid clashes
const PROFILE_DIR = path.join(os.tmpdir(), `ge-frame-test-${process.pid}`);

const targetUrl = new URL(BASE);

if (args.max) targetUrl.searchParams.set('max', String(args.max));
if (args.fixture) targetUrl.searchParams.set('fixture', args.fixture);
if (args.only) targetUrl.searchParams.set('only', args.only);
if (args.exact) targetUrl.searchParams.set('exact', args.exact);
if (args.output) targetUrl.searchParams.set('gallery', 'all');

const targetHref = targetUrl.toString();

function sleep (ms) { return new Promise(r => setTimeout(r, ms)); }

async function cdpSend (ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9) + 1;
    const onMsg = (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (msg.id === id) {
        ws.removeEventListener('message', onMsg);
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { ws.removeEventListener('message', onMsg); reject(new Error(`${method} timeout`)); }, 30000);
  });
}

const POLL_EXPR = `(() => {
  const stats = document.querySelector('#mocha-stats');
  const isSvg = window.__svgRegressionSnapshot != null;
  const batch = isSvg ? window.__batchReport : undefined;
  if (batch?.status === 'completed' && batch.plannedTotal === 0) {
    return JSON.stringify({ ready: true, done: true, isSvg, empty: true, stats: stats?.textContent || '', tests: [] });
  }
  if (!stats) return JSON.stringify({ ready: false });
  const duration = stats.querySelector('.duration');
  const tests = [...document.querySelectorAll('#mocha .suite > .test, #mocha > .test, #mocha .test')].map(t => {
    const title = t.querySelector('h2, h1');
    const heading = isSvg ? title?.cloneNode(true) : title;
    if (isSvg) heading?.querySelectorAll('.duration, .replay').forEach(node => node.remove());
    const name = heading?.textContent?.trim() || t.textContent?.trim()?.split('\\n')[0] || '';
    const skipped = isSvg && /\\bpending\\b/.test(t.className);
    const passed = !skipped && /\\bpass\\b/.test(t.className);
    const err = t.querySelector('.error')?.textContent?.trim() || '';
    return { name: name.slice(0, 200), passed, ...(isSvg ? { skipped } : {}),
      detail: passed || skipped ? '' : err.slice(0, 600).replace(/\\s+/g, ' ') };
  });
  const suiteTitle = document.querySelector('#mocha .suite > h1')?.textContent || '';
  const expected = Number(/\\((\\d+) files\\)/.exec(suiteTitle)?.[1] ||
    (isSvg ? /(\\d+) 个案例/.exec(suiteTitle)?.[1] : '') || 0);
  return JSON.stringify({ ready: true, done: !!duration && expected > 0 && tests.length >= expected,
    isSvg, stats: stats.textContent.replace(/\\s+/g, ' ').trim(), tests });
})()`;

async function run () {
  // health check dev server
  try {
    const r = await fetch(BASE);
    if (!r.ok) throw new Error(`status ${r.status}`);
  } catch (e) {
    console.error(`Dev server not reachable at ${BASE}: ${e.message}`);
    process.exit(3);
  }

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--window-size=1280,1600',
    'about:blank',
  ], { stdio: 'ignore' });
  chrome.unref();

  try {
    // wait for CDP endpoint
    let version = null;
    for (let i = 0; i < 60; i++) {
      try { version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json()); break; } catch { await sleep(250); }
    }
    if (!version) throw new Error('Chrome CDP did not come up');

    // find or create a page target
    let targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
    let page = targets.find(t => t.type === 'page');
    if (!page) {
      // create one
      await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`).then(r => r.json());
      targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then(r => r.json());
      page = targets.find(t => t.type === 'page');
    }
    const wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('no page webSocketDebuggerUrl');

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
      setTimeout(() => rej(new Error('ws open timeout')), 10000);
    });

    await cdpSend(ws, 'Page.enable');
    await cdpSend(ws, 'Runtime.enable');
    await cdpSend(ws, 'Page.navigate', { url: targetHref });

    const deadline = Date.now() + (Number(args.timeout) || 240000);
    let last = null;
    while (Date.now() < deadline) {
      await sleep(2000);
      try {
        const { result } = await cdpSend(ws, 'Runtime.evaluate', { expression: POLL_EXPR, returnByValue: true });
        last = JSON.parse(result.value);
        if (last?.done) break;
        if (last?.ready === false && Date.now() > deadline - 200000) {
          // page loaded but mocha not started — maybe error; capture console
        }
      } catch (e) {
        // transient; keep polling
      }
    }

    // also grab console errors + page status text
    let consoleErrors = [];
    try {
      const { result } = await cdpSend(ws, 'Runtime.evaluate', {
        expression: 'JSON.stringify((window.__lastErr||"") + (document.querySelector("#mocha p, #root p")?.textContent||""))',
        returnByValue: true,
      });
      // eslint-disable-next-line no-unused-expressions
      result.value && consoleErrors.push(result.value);
    } catch {}

    if (!last) { console.error('No result from page.'); process.exit(4); }
    const out = buildFrameTestReport(last, targetHref, consoleErrors);

    if (args.output) {
      await cdpSend(ws, 'Runtime.evaluate', {
        expression: `document.querySelectorAll('#frame-galleries .ui-gallery-scroll').forEach(element => {
          if (element instanceof HTMLElement) {
            element.style.flexWrap = 'wrap';
            element.style.overflowX = 'visible';
          }
        })`,
      });
      const { contentSize } = await cdpSend(ws, 'Page.getLayoutMetrics');
      const screenshot = await cdpSend(ws, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.max(1280, Math.ceil(contentSize.width)),
          height: Math.ceil(contentSize.height),
          scale: 1,
        },
      });
      const outputDir = path.resolve(process.cwd(), args.output);

      fs.mkdirSync(outputDir, { recursive: true });
      out.artifactDirectory = outputDir;
      const frameDir = path.join(outputDir, 'frames');
      const { result: countResult } = await cdpSend(ws, 'Runtime.evaluate', {
        expression: `document.querySelectorAll('#frame-galleries img').length`,
        returnByValue: true,
      });
      const galleryImages = [];

      for (let index = 0; index < Number(countResult.value); index++) {
        const { result: imageResult } = await cdpSend(ws, 'Runtime.evaluate', {
          expression: `(() => {
            const image = document.querySelectorAll('#frame-galleries img')[${index}];
            return JSON.stringify({
              index: ${index},
              title: image.title,
              src: image.src,
              width: image.naturalWidth,
              height: image.naturalHeight,
            });
          })()`,
          returnByValue: true,
        });

        galleryImages.push(JSON.parse(imageResult.value));
      }

      fs.mkdirSync(frameDir, { recursive: true });
      out.frameArtifacts = galleryImages.flatMap(image => {
        const encoded = image.src.match(/^data:image\/png;base64,(.+)$/)?.[1];

        if (!encoded) return [];
        const filename = `${String(image.index).padStart(3, '0')}-${image.title
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '-')
          .replace(/^-|-$/g, '')}.png`;

        fs.writeFileSync(path.join(frameDir, filename), Buffer.from(encoded, 'base64'));
        return [{ filename: `frames/${filename}`, title: image.title, width: image.width, height: image.height }];
      });
      fs.writeFileSync(path.join(outputDir, 'frame-comparison.png'), Buffer.from(screenshot.data, 'base64'));
      fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8');
    }

    ws.close();
    chrome.kill('SIGTERM');

    console.log(JSON.stringify(out, null, 2));
    process.exit(out.fail === 0 && out.done && !out.empty ? 0 : 1);
  } finally {
    try { chrome.kill('SIGKILL'); } catch {}
    try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
  }
}

run().catch(e => { console.error('driver error:', e.message); process.exit(5); });
