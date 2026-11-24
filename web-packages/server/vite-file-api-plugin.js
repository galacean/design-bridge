import { registerInputRoutes } from './file-api/lottie2ge-input-routes.js';
import { registerOutputRoutes } from './file-api/lottie2ge-output-routes.js';
import { registerStorageRoutes } from './file-api/lottie2ge-storage-routes.js';
import { registerHtml2FigmaConvertRoutes } from './file-api/html2figma-routes.js';
import { registerDSL2GEInputRoutes } from './file-api/dsl2ge-input-routes.js';
import { registerGE2IRInputRoutes } from './file-api/ge2ir-input-routes.js';
import { registerDSLValidatorRoutes } from './file-api/dsl-validator-routes.js';
import { registerGE2DSLBatchRoutes } from './file-api/ge2dsl-batch-routes.js';

import { registerSVG2GEInputRoutes } from './file-api/svg2ge-input-routes.js';
import { registerSVG2GETagsRoutes } from './file-api/svg2ge-tags-routes.js';
import { registerSVG2GEStorageRoutes } from './file-api/svg2ge-storage-routes.js';

export function createFileApiPlugin(options = {}) {
  const { rootDir } = options;

  if (!rootDir) {
    throw new Error('createFileApiPlugin requires rootDir');
  }

  return {
    name: 'file-api',
    configureServer(server) {
      registerInputRoutes(server, rootDir);
      registerSVG2GEInputRoutes(server, rootDir);
      registerSVG2GETagsRoutes(server, rootDir);
      registerSVG2GEStorageRoutes(server, rootDir);
      registerOutputRoutes(server, rootDir);
      registerStorageRoutes(server, rootDir);
      registerHtml2FigmaConvertRoutes(server);
      registerDSL2GEInputRoutes(server, rootDir);
      registerGE2IRInputRoutes(server, rootDir);
      registerDSLValidatorRoutes(server, rootDir);
      registerGE2DSLBatchRoutes(server, rootDir);
    },
  };
}
