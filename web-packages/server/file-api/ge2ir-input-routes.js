import { listInputFiles } from './input-sources.js';
import { sendJson } from './utils.js';

export function registerGE2IRInputRoutes(server, rootDir) {
  server.middlewares.use('/api/ge2ir/list-input', async (_req, res) => {
    try {
      sendJson(res, { files: await listInputFiles(rootDir, 'ge') });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
