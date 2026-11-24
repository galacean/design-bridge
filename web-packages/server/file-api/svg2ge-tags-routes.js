import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from './constants.js';
import { sendJson, readRequestBody, assertInsideRoot, ensureDir } from './utils.js';

const TAGS_FILE = path.join(TMP_DIR, 'svg2ge-case-tags.json');
const TAGS_VERSION = 1;
const VALID_TAGS = new Set(['svg2ge', 'ge-capability', 'impl-diff', 'harness', 'case-issue', 'pass']);
const MAX_NAME = 256;
const MAX_NOTE = 500;

let writeChain = Promise.resolve();

function withLock(fn) {
  const run = writeChain.then(fn, fn); // fn 自己抛错也释放链下一个
  writeChain = run.then(() => {}, () => {});
  return run;
}

function resolveTagsPath(rootDir) {
  const abs = path.resolve(rootDir, TAGS_FILE);
  const tmpRoot = path.resolve(rootDir, TMP_DIR);

  if (!assertInsideRoot(abs, tmpRoot)) {
    throw new Error('Forbidden: tags file must stay under tmp/');
  }
  return abs;
}

function readTagsSync(abs) {
  if (!fs.existsSync(abs)) {
    return { version: TAGS_VERSION, tags: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));

    if (parsed == null || typeof parsed !== 'object' || parsed.version !== TAGS_VERSION) {
      console.warn('[svg2ge-tags] 版本不符或格式异常，返回空 tags 并保留原文件:', abs);
      return { version: TAGS_VERSION, tags: {} };
    }
    const tags = parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {};

    return { version: TAGS_VERSION, tags };
  } catch (err) {
    console.warn('[svg2ge-tags] JSON 解析失败,降级为空 tags:', abs, err.message);
    return { version: TAGS_VERSION, tags: {} };
  }
}

function writeTagsSync(abs, data) {
  ensureDir(abs);
  const tmp = `${abs}.tmp`;

  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, abs); // 同目录原子替换
}

function validateName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME;
}

function normalizeNote(note) {
  if (note == null) { return ''; }
  const s = String(note);

  return s.length > MAX_NOTE ? s.slice(0, MAX_NOTE) : s;
}

function bulkUpsertLocked(abs, names, tag) {
  const data = readTagsSync(abs);
  const updatedAt = new Date().toISOString();

  for (const nm of names) {
    if (!validateName(nm)) { continue; }
    const prev = data.tags[nm] && typeof data.tags[nm] === 'object' ? data.tags[nm] : {};

    data.tags[nm] = { tag, note: prev.note ?? '', updatedAt };
  }
  writeTagsSync(abs, data);

  return data;
}

export function registerSVG2GETagsRoutes(server, rootDir) {
  const absPath = resolveTagsPath(rootDir);

  server.middlewares.use('/api/svg2ge/tags', async (req, res) => {
    const rest = (req.url ?? '').replace(/^\//, '');

    try {
      if (req.method === 'GET') {
        const data = readTagsSync(absPath);

        sendJson(res, data);
        return;
      }

      if (req.method !== 'POST') {
        sendJson(res, { error: 'Method not allowed' }, 405);
        return;
      }

      const body = await readRequestBody(req);
      let payload;

      try {
        payload = JSON.parse(body);
      } catch {
        sendJson(res, { error: '无效 JSON body' }, 400);
        return;
      }

      if (rest === 'bulk') {
        const { names, tag } = payload ?? {};

        if (!Array.isArray(names) || names.length === 0) {
          sendJson(res, { error: 'names 需非空数组' }, 400);
          return;
        }
        if (!VALID_TAGS.has(tag)) {
          sendJson(res, { error: `tag 非法:${tag}` }, 400);
          return;
        }
        const filtered = names.filter(validateName);

        if (filtered.length === 0) {
          sendJson(res, { error: '无合法 name' }, 400);
          return;
        }
        const data = await withLock(() => bulkUpsertLocked(absPath, filtered, tag));

        sendJson(res, { success: true, tags: data.tags });
        return;
      }

      if (rest === 'delete') {
        const { name } = payload ?? {};

        if (!validateName(name)) {
          sendJson(res, { error: 'name 非法' }, 400);
          return;
        }
        const data = await withLock(() => {
          const d = readTagsSync(absPath);

          if (d.tags[name] != null) {
            delete d.tags[name];
            writeTagsSync(absPath, d);
          }
          return d;
        });

        sendJson(res, { success: true, tags: data.tags });
        return;
      }

      if (rest === '' || rest === '/') {
        const { name, tag, note } = payload ?? {};

        if (!validateName(name)) {
          sendJson(res, { error: 'name 非法' }, 400);
          return;
        }
        if (!VALID_TAGS.has(tag)) {
          sendJson(res, { error: `tag 非法:${tag}` }, 400);
          return;
        }
        const data = await withLock(() => {
          const d = readTagsSync(absPath);
          const prev = d.tags[name] && typeof d.tags[name] === 'object' ? d.tags[name] : {};

          d.tags[name] = {
            tag,
            note: normalizeNote(note != null ? note : prev.note ?? ''),
            updatedAt: new Date().toISOString(),
          };
          writeTagsSync(absPath, d);
          return d;
        });

        sendJson(res, { success: true, tags: data.tags });
        return;
      }

      sendJson(res, { error: `未知子路径:${rest}` }, 404);
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
