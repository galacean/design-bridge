import fs from 'node:fs';
import path from 'node:path';
import { TMP_DIR } from './constants.js';
import { sendJson, readRequestBody, assertInsideRoot, ensureDir } from './utils.js';

export function registerStorageRoutes(server, rootDir) {
  const tmpRoot = path.resolve(rootDir, TMP_DIR);

  server.middlewares.use('/api/lottie2ge/download-image', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const { url, filePath } = JSON.parse(body);
      const absolutePath = path.resolve(rootDir, filePath);

      if (!assertInsideRoot(absolutePath, tmpRoot)) {
        sendJson(res, { error: 'Forbidden: can only write to tmp/' }, 403);
        return;
      }

      ensureDir(absolutePath);
      const response = await fetch(url);

      if (!response.ok) {
        sendJson(res, { error: `Failed to download: ${response.status}` }, 502);
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      fs.writeFileSync(absolutePath, buffer);
      sendJson(res, { success: true });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/lottie2ge/save-binary', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const { filePath, base64 } = JSON.parse(body);
      const absolutePath = path.resolve(rootDir, filePath);

      if (!assertInsideRoot(absolutePath, tmpRoot)) {
        sendJson(res, { error: 'Forbidden: can only write to tmp/' }, 403);
        return;
      }

      ensureDir(absolutePath);
      fs.writeFileSync(absolutePath, Buffer.from(base64, 'base64'));
      sendJson(res, { success: true });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/lottie2ge/save', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const { filePath, content } = JSON.parse(body);
      const absolutePath = path.resolve(rootDir, filePath);

      if (!assertInsideRoot(absolutePath, tmpRoot)) {
        sendJson(res, { error: 'Forbidden: can only write to tmp/' }, 403);
        return;
      }

      ensureDir(absolutePath);
      fs.writeFileSync(absolutePath, content, 'utf-8');
      sendJson(res, { success: true });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
