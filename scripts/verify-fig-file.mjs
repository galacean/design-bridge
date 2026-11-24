import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const inputPath = process.argv.slice(2).find(argument => argument !== '--');

if (!inputPath) {
  console.error('Usage: make verify-fig FILE=/absolute/path/to/file.fig');
  process.exit(2);
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(repositoryRoot, 'packages/html2figma');
const server = await createServer({
  root: packageRoot,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});

try {
  const filePath = path.resolve(inputPath);
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const module = await server.ssrLoadModule('/src/core/figma-file-validation.ts');
  const report = await module.validateFigmaFile(bytes);

  console.info(JSON.stringify({ file: filePath, size: bytes.byteLength, ...report }, null, 2));
  if (!report.valid) {
    process.exitCode = 1;
  }
} finally {
  await server.close();
}
