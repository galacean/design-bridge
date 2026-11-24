import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function listInputFiles(rootDir, format) {
  const manifest = path.resolve(rootDir, 'tests/fixtures', format, 'urls.txt');
  const urls = (await readFile(manifest, 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  for (const url of urls) {
    if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) {
      throw new Error(`Invalid HTTP(S) URL in ${manifest}: ${url}`);
    }
  }

  return [...new Set(urls)];
}

export async function readInputFile(source) {
  if (!/^https?:\/\//i.test(source) || !URL.canParse(source)) {
    throw new Error(`Input must be an HTTP(S) URL: ${source}`);
  }
  const response = await fetch(source, { signal: AbortSignal.timeout(60000) });

  if (!response.ok) {
    throw new Error(`Input download failed: HTTP ${response.status} (${source})`);
  }

  return response.text();
}
