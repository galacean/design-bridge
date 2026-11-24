import fs from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

export function sendJson(res, payload, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function readRequestBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;

    req.on('data', chunk => {
      if (exceeded) {
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      size += buffer.length;
      if (size > maxBytes) {
        exceeded = true;
        chunks.length = 0;
        reject(new RangeError('Request body exceeds the configured limit.'));
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request body was aborted.')));
  });
}

export async function collectJsonFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectJsonFiles(absolutePath));
    } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
      files.push(absolutePath);
    }
  }

  return files;
}

export function assertInsideRoot(targetPath, rootPath) {
  const relativePath = path.relative(rootPath, targetPath);

  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function ensureDir(filePath) {
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function collectHtmlFilesRecursively(rootDir) {
  const htmlFiles = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__MACOSX') {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.html' || ext === '.htm') {
        htmlFiles.push(fullPath);
      }
    }
  }

  return htmlFiles;
}

export function cleanupPath(targetPath) {
  if (!targetPath) {
    return;
  }

  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures to avoid masking conversion errors.
  }
}
