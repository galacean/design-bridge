import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './constants.js';
import { sendJson, assertInsideRoot } from './utils.js';

export function registerOutputRoutes(server, rootDir) {
  const outputRoot = path.resolve(rootDir, OUTPUT_DIR);

  server.middlewares.use('/api/lottie2ge/list-output', (_req, res) => {
    try {
      if (!fs.existsSync(outputRoot)) {
        sendJson(res, { files: [], dirs: [] });
        return;
      }
      const entries = fs.readdirSync(outputRoot, { withFileTypes: true });
      const files = entries
        .filter(e => !e.isDirectory() && e.name.endsWith('.json'))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b));
      const dirs = entries
        .filter(e => e.isDirectory() && fs.existsSync(path.join(outputRoot, e.name, 'result.json')))
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b));

      sendJson(res, { files, dirs });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/lottie2ge/read-output/', (req, res) => {
    try {
      const relPath = decodeURIComponent(req.url?.replace(/^\//, '') ?? '');
      const filePath = path.resolve(outputRoot, relPath);

      if (!assertInsideRoot(filePath, outputRoot)) {
        sendJson(res, { error: 'Forbidden' }, 403);
        return;
      }
      if (!fs.existsSync(filePath)) {
        sendJson(res, { error: 'File not found' }, 404);
        return;
      }

      sendJson(res, JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/lottie2ge/read-output-asset/', (req, res, next) => {
    try {
      const relPath = decodeURIComponent(req.url?.replace(/^\//, '') ?? '');
      const filePath = path.resolve(outputRoot, relPath);

      if (!assertInsideRoot(filePath, outputRoot)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath)) {
        next();
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.json': 'application/json',
      };

      res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
      res.end(fs.readFileSync(filePath));
    } catch (err) {
      res.statusCode = 500;
      res.end(err.message);
    }
  });
}
