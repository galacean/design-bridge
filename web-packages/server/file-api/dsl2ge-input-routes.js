import { listInputFiles } from './input-sources.js';
import { sendJson } from './utils.js';

export function registerDSL2GEInputRoutes(server, rootDir) {
  server.middlewares.use('/api/dsl2ge/list-input', async (_req, res) => {
    try {
      sendJson(res, { files: await listInputFiles(rootDir, 'dsl') });
    } catch (err) {
      sendJson(res, { error: err.message }, 500);
    }
  });
}
