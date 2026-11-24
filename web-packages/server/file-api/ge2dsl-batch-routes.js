import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readRequestBody, sendJson } from './utils.js';
import { listInputFiles, readInputFile } from './input-sources.js';

function snapshot(job) {
  return {
    id: job.id,
    status: job.status,
    inputManifest: job.inputManifest,
    outputDirectory: job.outputDirectory,
    frameRate: job.frameRate,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    summary: { ...job.summary },
    files: [...job.files],
    error: job.error,
  };
}

function emptySummary(total) {
  return {
    total,
    processed: 0,
    passed: 0,
    failed: 0,
    conversionErrors: 0,
    errors: 0,
    warnings: 0,
    elapsedMs: 0,
  };
}

async function runBatch(job, inputFiles, convertGEToDSL, validateDSL) {
  const startedAt = performance.now();

  try {
    for (const inputFile of inputFiles) {
      const fileStartedAt = performance.now();
      const outputFile = `${createHash('sha256').update(inputFile).digest('hex').slice(0, 16)}.dsl.json`;
      const absoluteOutput = path.resolve(job.outputDirectory, outputFile);

      try {
        const rawScene = await readInputFile(inputFile);
        const scene = JSON.parse(rawScene);
        const { dsl } = convertGEToDSL(scene, { frameRate: job.frameRate, resourceBaseUrl: inputFile });
        const validationResult = validateDSL(dsl);

        await mkdir(path.dirname(absoluteOutput), { recursive: true });
        await writeFile(absoluteOutput, `${JSON.stringify(dsl, null, 2)}\n`, 'utf8');

        const passed = validationResult.result === 'pass';

        job.summary.passed += passed ? 1 : 0;
        job.summary.failed += passed ? 0 : 1;
        job.summary.errors += validationResult.errors.length;
        job.summary.warnings += validationResult.warnings.length;
        job.files.push({
          inputFile,
          outputFile,
          status: passed ? (validationResult.warnings.length > 0 ? 'warning' : 'pass') : 'fail',
          elapsedMs: Math.round((performance.now() - fileStartedAt) * 100) / 100,
          check: validationResult,
        });
      } catch (error) {
        job.summary.failed += 1;
        job.summary.conversionErrors += 1;
        job.files.push({
          inputFile,
          outputFile,
          status: 'error',
          elapsedMs: Math.round((performance.now() - fileStartedAt) * 100) / 100,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      job.summary.processed += 1;
      job.summary.elapsedMs = Math.round((performance.now() - startedAt) * 100) / 100;
    }

    job.status = 'completed';
    job.finishedAt = new Date().toISOString();
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    job.finishedAt = new Date().toISOString();
  }
}

export function registerGE2DSLBatchRoutes(server, rootDir) {
  const inputManifest = path.resolve(rootDir, 'tests/fixtures/ge/urls.txt');
  const outputDirectory = path.resolve(rootDir, 'tmp/dsl-input');
  const geDSLModule = fileURLToPath(new URL('../../src/features/dsl-conversion/ge-dsl-workflow.ts', import.meta.url));
  let latestJob = null;
  let starting = false;

  server.middlewares.use('/api/ge2dsl/batch-validate', async (req, res) => {
    if (req.method === 'GET') {
      if (latestJob == null) {
        sendJson(res, { status: 'idle' });
      } else {
        sendJson(res, snapshot(latestJob));
      }
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, { error: 'Method not allowed' }, 405);
      return;
    }

    if (starting || latestJob?.status === 'running') {
      sendJson(res, starting ? { error: 'A batch is starting' } : snapshot(latestJob), 409);
      return;
    }

    starting = true;
    try {
      const body = JSON.parse(await readRequestBody(req) || '{}');
      const frameRate = Number(body.frameRate);

      if (!Number.isFinite(frameRate) || frameRate <= 0) {
        sendJson(res, { error: 'frameRate must be a finite number greater than 0' }, 400);
        return;
      }

      const inputFiles = await listInputFiles(rootDir, 'ge');
      const [{ convertGEToDSL }, { validateDSL }] = await Promise.all([
        server.ssrLoadModule(`/@fs/${geDSLModule}`),
        server.ssrLoadModule('@galacean/dsl-ir'),
      ]);
      const job = {
        id: randomUUID(),
        status: 'running',
        inputManifest,
        outputDirectory,
        frameRate,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        summary: emptySummary(inputFiles.length),
        files: [],
        error: null,
      };

      latestJob = job;
      void runBatch(job, inputFiles, convertGEToDSL, validateDSL);
      sendJson(res, snapshot(job), 202);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    } finally {
      starting = false;
    }
  });
}
