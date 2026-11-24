import fs from 'node:fs';
import path from 'node:path';
import { sendJson, assertInsideRoot } from './utils.js';
import { mapSvgImageUrls } from './svg-image-mapping.js';

const SVG_INPUT_DIR = 'tmp/svg_input';
const SVG_DYNAMIC_DIR = 'tmp/svg_dynamic_tests';
const TEST_IMAGES_DIR = 'public/test-images';

const POOL_SYN = 'syn';
const POOL_TI = 'ti';
const POOL_DSPEC = 'dspec';
const POOL_DREAL = 'dreal';
const POOL_DREAL_CSS = 'dreal-css';
const DYNAMIC_POOL_DIR = {
  [POOL_DSPEC]: 'spec',
  [POOL_DREAL]: 'real',
  [POOL_DREAL_CSS]: 'real_css',
};

function readType(req) {
  const t = new URL(req.url ?? '/', 'http://localhost').searchParams.get('type') ?? '';
  return t === 'dynamic' ? 'dynamic' : 'static';
}

function loadSynManifest(manifestPath) {
  try {
    if (!fs.existsSync(manifestPath)) { return {}; }
    const j = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    return j?.cases ?? {};
  } catch { return {}; }
}

function derivePool(name, synCases) {
  return synCases[name]?.pool ?? POOL_TI;
}

function readPool(req) {
  return new URL(req.url ?? '/', 'http://localhost').searchParams.get('pool') ?? '';
}

function rewriteRelativeFixtureHrefs(svgText, filePath, dynRoot) {
  const rasterImagePattern = /<(image|feImage)\b([^>]*)>/gi;
  const hrefPattern = /((?:xlink:)?href\s*=\s*)(["'])([^"']+)\2/i;

  return svgText.replace(rasterImagePattern, (tag, _name, attributes) => tag.replace(
    hrefPattern,
    (match, prefix, quote, value) => {
      if (/^(?:[a-z][\w+.-]*:|#|\/)/i.test(value)) { return match; }
      const absolute = path.resolve(path.dirname(filePath), value);

      if (!assertInsideRoot(absolute, dynRoot) || !fs.existsSync(absolute)) { return match; }
      const served = '/' + path.relative(path.resolve(dynRoot, '..', '..'), absolute).split(path.sep).join('/');

      return `${prefix}${quote}${served}${quote}`;
    },
  ));
}

export function registerSVG2GEInputRoutes(server, rootDir) {
  const inputRoot = path.resolve(rootDir, SVG_INPUT_DIR);
  const exampleRoot = path.resolve(rootDir, 'examples/svg');
  const testImagesDir = path.resolve(rootDir, TEST_IMAGES_DIR);
  const synManifestPath = path.resolve(rootDir, 'tmp/svg2ge-synthetic-manifest.json');

  server.middlewares.use('/api/svg2ge/list-input', (req, res) => {
    try {
      const type = readType(req);
      const pool = readPool(req);
      const query = new URL(req.url ?? '/', 'http://localhost');
      const missingLocal = type === 'static' ? !fs.existsSync(inputRoot)
        : !Object.values(DYNAMIC_POOL_DIR).some(sub => fs.existsSync(path.resolve(rootDir, SVG_DYNAMIC_DIR, sub)));

      if (query.searchParams.get('source') === 'examples' || missingLocal) {
        const meta = {};
        const files = fs.existsSync(exampleRoot) ? fs.readdirSync(exampleRoot)
          .filter(name => name.endsWith('.svg')).filter(name => {
            const animated = /<(animate|animateTransform|animateMotion|set)\b|@keyframes/i
              .test(fs.readFileSync(path.join(exampleRoot, name), 'utf8'));

            return type === 'dynamic' ? animated : !animated;
          }).map(name => {
            const key = `@examples/${name}`;

            meta[key] = { type, pool: 'examples' };
            return key;
          }) : [];

        sendJson(res, { files: pool === '' || pool === 'examples' ? files : [], meta });
        return;
      }
      if (type === 'dynamic') {
        const dynRoot = path.resolve(rootDir, SVG_DYNAMIC_DIR);
        const meta = {};
        let all = [];
        const subdirs = pool && DYNAMIC_POOL_DIR[pool] ? [DYNAMIC_POOL_DIR[pool]]
          : pool === '' ? Object.values(DYNAMIC_POOL_DIR) : [];
        for (const sub of subdirs) {
          const subDir = path.resolve(dynRoot, sub);
          if (!fs.existsSync(subDir)) { continue; }
          const poolKey = sub === 'spec'
            ? POOL_DSPEC
            : sub === 'real'
              ? POOL_DREAL
              : POOL_DREAL_CSS;
          for (const f of fs.readdirSync(subDir).filter(x => x.toLowerCase().endsWith('.svg')).sort()) {
            all.push(f);
            meta[f] = { pool: poolKey, type: 'dynamic', subdir: sub };
          }
        }
        sendJson(res, { files: all, meta });
        return;
      }
      if (!fs.existsSync(inputRoot)) {
        sendJson(res, { files: [], meta: {} });
        return;
      }
      const synCases = loadSynManifest(synManifestPath);
      const all = fs.readdirSync(inputRoot)
        .filter(f => f.toLowerCase().endsWith('.svg'))
        .sort((a, b) => a.localeCompare(b));
      const meta = {};
      for (const f of all) {
        const syn = synCases[f];
        meta[f] = syn ? { ...syn, type: 'static' } : { pool: POOL_TI, type: 'static' };
      }
      const files = pool === '' ? all : all.filter(f => meta[f].pool === pool);

      sendJson(res, { files, meta });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  const failListPath = path.resolve(rootDir, 'tmp/fail-list.txt');
  server.middlewares.use('/api/svg2ge/list-fail', (req, res) => {
    try {
      if (!fs.existsSync(failListPath)) {
        sendJson(res, { files: [], meta: {}, error: 'tmp/fail-list.txt 不存在(先跑全量生成)' });
        return;
      }
      const pool = readPool(req);
      const synCases = loadSynManifest(synManifestPath);
      const all = fs.readFileSync(failListPath, 'utf-8')
        .split('\n').map(s => s.trim()).filter(s => s.length > 0);
      const meta = {};
      for (const f of all) {
        const syn = synCases[f];
        meta[f] = syn ? { ...syn } : { pool: POOL_TI };
      }
      const files = pool === '' ? all : all.filter(f => meta[f].pool === pool);

      sendJson(res, { files, meta });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/svg2ge/read-input/', (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const fileName = decodeURIComponent(url.pathname.replace(/^\//, '') ?? '');
      const type = url.searchParams.get('type') === 'dynamic' ? 'dynamic' : 'static';
      if (fileName.startsWith('@examples/')) {
        const file = path.resolve(exampleRoot, fileName.slice('@examples/'.length));

        if (!assertInsideRoot(file, exampleRoot)) { sendJson(res, { error: 'Forbidden' }, 403); return; }
        if (!fs.existsSync(file)) { sendJson(res, { error: 'File not found' }, 404); return; }
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.end(fs.readFileSync(file, 'utf8'));
        return;
      }

      if (type === 'dynamic') {
        const dynRoot = path.resolve(rootDir, SVG_DYNAMIC_DIR);
        let filePath = null;
        for (const sub of Object.values(DYNAMIC_POOL_DIR)) {
          const p = path.resolve(dynRoot, sub, fileName);
          if (assertInsideRoot(p, dynRoot) && fs.existsSync(p)) { filePath = p; break; }
        }
        if (!filePath) { sendJson(res, { error: 'File not found' }, 404); return; }
        const raw = rewriteRelativeFixtureHrefs(fs.readFileSync(filePath, 'utf-8'), filePath, dynRoot);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.end(raw);
        return;
      }
      const filePath = path.resolve(inputRoot, fileName);

      if (!assertInsideRoot(filePath, inputRoot)) {
        sendJson(res, { error: 'Forbidden' }, 403);
        return;
      }
      if (!fs.existsSync(filePath)) {
        sendJson(res, { error: 'File not found' }, 404);
        return;
      }

      const raw = fs.readFileSync(filePath, 'utf-8');
      const mapped = mapSvgImageUrls(raw, testImagesDir);

      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.end(rewriteRelativeFixtureHrefs(mapped, filePath, inputRoot));
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
