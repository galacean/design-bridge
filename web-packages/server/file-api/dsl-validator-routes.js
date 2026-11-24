import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { sendJson } from './utils.js';
import { listInputFiles, readInputFile } from './input-sources.js';

const maxInputBytes = 10 * 1024 * 1024;

async function readRawBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    size += buffer.length;
    if (size > maxInputBytes) {
      throw new Error(`Request body exceeds ${maxInputBytes} bytes`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function detectorMetadata(validatorFiles) {
  const contents = await Promise.all(validatorFiles.map(file => readFile(file)));
  const digest = createHash('sha256');

  for (const content of contents) {
    digest.update(content);
  }

  return {
    detector: '@galacean/dsl-ir/validateDSL',
    detectorRevision: 'TypeScript DSL validator',
    detectorSha256: digest.digest('hex'),
    runtimeVersion: `Node.js ${process.version}`,
  };
}

async function validateInputs(rootDir, manifest, validateDSL, metadata) {
  const startedAt = performance.now();
  const jsonFiles = await listInputFiles(rootDir, 'dsl');
  const files = [];

  for (const inputFile of jsonFiles) {
    const fileStartedAt = performance.now();
    const rawDSL = await readInputFile(inputFile);

    files.push({
      file: inputFile,
      size: Buffer.byteLength(rawDSL),
      modifiedAt: null,
      elapsedMs: Math.round((performance.now() - fileStartedAt) * 100) / 100,
      check: validateDSL(rawDSL),
    });
  }

  const passed = files.filter(file => file.check.result === 'pass').length;
  const errors = files.reduce((count, file) => count + file.check.errors.length, 0);
  const warnings = files.reduce((count, file) => count + file.check.warnings.length, 0);

  return {
    ...metadata,
    manifest,
    summary: {
      total: files.length,
      passed,
      failed: files.length - passed,
      errors,
      warnings,
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
    },
    files,
  };
}

export function registerDSLValidatorRoutes(server, rootDir) {
  const validatorDirectory = path.resolve(rootDir, '../packages/dsl-ir/src/dsl/validator');
  const validatorFiles = [
    path.join(validatorDirectory, 'validation.ts'),
    path.join(validatorDirectory, 'labels.ts'),
    path.join(validatorDirectory, 'types.ts'),
  ];

  server.middlewares.use('/api/dsl-validator/check', async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    const dslManifest = path.resolve(rootDir, 'tests/fixtures/dsl/urls.txt');

    try {
      res.setHeader('Cache-Control', 'no-store');
      const [{ validateDSL }, metadata] = await Promise.all([
        server.ssrLoadModule('@galacean/dsl-ir'),
        detectorMetadata(validatorFiles),
      ]);
      const payload = req.method === 'POST'
        ? { ...metadata, check: validateDSL(await readRawBody(req)) }
        : await validateInputs(rootDir, dslManifest, validateDSL, metadata);

      sendJson(res, payload);
    } catch (error) {
      sendJson(res, {
        error: error instanceof Error ? error.message : String(error),
        manifest: dslManifest,
        detector: '@galacean/dsl-ir/validateDSL',
      }, 500);
    }
  });
}
