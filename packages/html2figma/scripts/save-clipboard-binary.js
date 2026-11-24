#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function formatTimestamp (date = new Date()) {
  const pad = n => String(n).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function resolveOutputPath (argOutputPath) {
  const root = process.cwd();
  const defaultName = `clipboard-${formatTimestamp()}.bin`;
  const output = argOutputPath || path.join('server', 'data', defaultName);

  return path.isAbsolute(output) ? output : path.join(root, output);
}

function parseAppleScriptData (raw, flavor) {
  const normalizedFlavor = flavor.replace(/\s/g, '\\s');
  const regex = new RegExp(`«data\\s+${normalizedFlavor}([\\s\\S]*?)»`);
  const match = raw.match(regex);

  if (!match || !match[1]) {
    return null;
  }

  const hex = match[1].replace(/[^0-9A-Fa-f]/g, '');

  if (!hex) {
    return null;
  }

  return Buffer.from(hex, 'hex');
}

function readClipboardFlavorBytes (flavor) {
  try {
    const result = execFileSync('osascript', ['-e', `the clipboard as «class ${flavor}»`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024,
    });

    return parseAppleScriptData(result, flavor);
  } catch {
    return null;
  }
}

function readClipboardBytes () {
  try {
    const textBytes = execFileSync('pbpaste');

    if (textBytes.length > 0) {
      return textBytes;
    }
  } catch (error) {
    const err = error;

    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      throw new Error('未找到 pbpaste，请确认当前系统是 macOS，或安装兼容命令。', { cause: error });
    }
  }

  const binaryFlavors = ['HTML', 'PNGf', 'TIFF', 'PDF '];

  for (const flavor of binaryFlavors) {
    const bytes = readClipboardFlavorBytes(flavor);

    if (bytes && bytes.length > 0) {
      return bytes;
    }
  }

  return Buffer.alloc(0);
}

function main () {
  const outputPath = resolveOutputPath(process.argv[2]);
  const outputDir = path.dirname(outputPath);

  const bytes = readClipboardBytes();

  if (bytes.length === 0) {
    throw new Error('剪贴板为空，未写入文件。');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, bytes);

  console.info(`✅ 已写入 ${bytes.length} bytes -> ${outputPath}`);
}

try {
  main();
} catch (error) {
  if (error instanceof Error) {
    console.error(`❌ ${error.message}`);
  } else {
    console.error('❌ 未知错误');
  }
  process.exit(1);
}
