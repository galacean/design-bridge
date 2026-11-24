import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { HTML2FIGMA_UPLOAD_DIR } from './constants.js';
import { sendJson, readRequestBody, collectHtmlFilesRecursively, cleanupPath } from './utils.js';

const html2figmaUpload = multer({ dest: HTML2FIGMA_UPLOAD_DIR });

export function registerHtml2FigmaConvertRoutes(server) {
  server.middlewares.use('/api/html2figma/check-schema', async (req, res) => {
    if (req.method !== 'GET') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const { SCHEMA_PATH } = await server.ssrLoadModule('@galacean/html2figma');

      sendJson(res, { hasSchema: fs.existsSync(SCHEMA_PATH) });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/html2figma/generate-figma-clipboard', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const scenes = payload?.scenes;

      if (!Array.isArray(scenes)) {
        sendJson(res, { error: 'Missing scenes array in body' }, 400);
        return;
      }

      const { createCurrentFigmaClipboard } = await server.ssrLoadModule('@galacean/html2figma');
      const { html } = await createCurrentFigmaClipboard(scenes);

      sendJson(res, { success: true, html });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/html2figma/generate-figma-file', async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    try {
      const body = await readRequestBody(req);
      const payload = JSON.parse(body || '{}');
      const scenes = payload?.scenes;

      if (!Array.isArray(scenes)) {
        sendJson(res, { error: 'Missing scenes array in body' }, 400);
        return;
      }

      const { createFigmaFile } = await server.ssrLoadModule('@galacean/html2figma');
      const result = await createFigmaFile(scenes, {
        documentName: typeof payload.documentName === 'string' ? payload.documentName : undefined,
      });

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(result.bytes.byteLength));
      res.setHeader('X-Figma-Validation', result.validation.valid ? 'passed' : 'failed');
      res.setHeader('X-Figma-Node-Count', String(result.validation.nodeCount));
      res.end(Buffer.from(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength));
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });

  server.middlewares.use('/api/html2figma/convert', (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    html2figmaUpload.array('files')(req, res, async (uploadErr) => {
      if (uploadErr) {
        sendJson(res, { error: uploadErr.message || 'Upload failed' }, 400);
        return;
      }

      const files = req.files || [];
      if (files.length === 0) {
        sendJson(res, { error: 'No files uploaded' }, 400);
        return;
      }

      const isDesktop = req.body?.viewport === 'desktop';
      const rasterizeSyntheticText = req.body?.rasterizeSyntheticText === 'true';
      const viewport = isDesktop ? { width: 1280, height: 1024 } : { width: 390, height: 844 };
      const results = [];
      let diagnosticCount = 0;

      try {
        const { extractSceneDocument } = await server.ssrLoadModule('@galacean/html2figma');

        for (const file of files) {
          const originalName = file.originalname || file.filename;
          const ext = path.extname(originalName).toLowerCase();

          if (ext === '.html' || ext === '.htm') {
            const htmlPath = `${file.path}.html`;
            const name = path.basename(originalName).replace(/\.(html|htm)$/i, '');
            try {
              fs.renameSync(file.path, htmlPath);
              const document = await extractSceneDocument(htmlPath, false, { viewport, rasterizeSyntheticText });
              diagnosticCount += document.diagnostics.length;
              results.push({ name, sceneData: document.root });
            } catch (err) {
              results.push({ name, error: err.message });
            } finally {
              cleanupPath(htmlPath);
            }
            continue;
          }

          if (ext === '.zip') {
            const extractPath = path.join(HTML2FIGMA_UPLOAD_DIR, `extract_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
            try {
              const zip = new AdmZip(file.path);

              zip.extractAllTo(extractPath, true);

              const htmlFiles = collectHtmlFilesRecursively(extractPath);
              for (const htmlFilePath of htmlFiles) {
                const relativeName = path.relative(extractPath, htmlFilePath).replace(/\\/g, '/');
                const sceneName = relativeName.replace(/\.(html|htm)$/i, '');
                try {
                  const document = await extractSceneDocument(htmlFilePath, false, {
                    viewport, rasterizeSyntheticText,
                  });
                  diagnosticCount += document.diagnostics.length;
                  results.push({ name: sceneName, sceneData: document.root });
                } catch (err) {
                  results.push({ name: sceneName, error: err.message });
                }
              }
            } catch (err) {
              results.push({ name: path.basename(originalName, '.zip'), error: err.message || 'Failed to process zip file' });
            } finally {
              cleanupPath(extractPath);
              cleanupPath(file.path);
            }
            continue;
          }

          cleanupPath(file.path);
        }

        sendJson(res, { success: true, count: results.length, scenes: results, diagnosticCount });
      } catch (err) {
        sendJson(res, { error: err.message }, 500);
      }
    });
  });
}
