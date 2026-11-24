import { listInputFiles } from './input-sources.js';
import { sendJson } from './utils.js';

export function registerInputRoutes(server, rootDir) {
  server.middlewares.use('/api/lottie2ge/list-input', async (_req, res) => {
    try {
      sendJson(res, { files: await listInputFiles(rootDir, 'lottie') });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
