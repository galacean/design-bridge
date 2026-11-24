#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileSchema, decodeBinarySchema } from 'kiwi-schema';
import pako from 'pako';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', 'tests', 'fixtures');

function resolveOutputPath (cliPath) {
  const defaultName = `decoded.json`;
  const output = path.join(cliPath || '', defaultName);

  return path.isAbsolute(output) ? output : path.join(repoRoot, output);
}

function decodeHtmlEntities (value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAppleScriptData (raw, flavor) {
  const normalizedFlavor = flavor.replace(/\s/g, '\\s');
  const regex = new RegExp(`«data\\s+${normalizedFlavor}([\\s\\S]*?)»`);
  const match = raw.match(regex);

  if (!match || !match[1]) { return null; }

  const hex = match[1].replace(/[^0-9A-Fa-f]/g, '');

  if (!hex) { return null; }

  return Buffer.from(hex, 'hex');
}

function readClipboardHtml () {
  try {
    const raw = execFileSync('osascript', ['-e', 'the clipboard as «class HTML»'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 20 * 1024 * 1024,
    });
    const bytes = parseAppleScriptData(raw, 'HTML');

    if (!bytes || bytes.length === 0) {
      throw new Error('剪贴板中未找到 HTML 数据。');
    }

    return bytes.toString('utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';

    throw new Error(`读取系统剪贴板 HTML 失败: ${message}`, { cause: error });
  }
}

function extractMarkers (htmlInput) {
  const html = decodeHtmlEntities(htmlInput);
  const metaMatch = html.match(/<!--\(figmeta\)([\s\S]*?)\(\/figmeta\)-->/);
  const figmaMatch = html.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/);

  if (!metaMatch || !figmaMatch) {
    throw new Error('剪贴板 HTML 中未找到 figmeta/figma payload。请先在 Figma 中复制节点。');
  }

  return { figmeta: metaMatch[1], figma: figmaMatch[1] };
}

function parseArchive (buffer) {
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  const prelude = String.fromCharCode(...buffer.slice(0, 8));

  if (prelude !== 'fig-kiwi') { throw new Error(`Invalid fig-kiwi prelude: ${prelude}`); }
  offset = 8;

  const version = data.getUint32(offset, true);

  offset += 4;

  const files = [];

  while (offset + 4 <= buffer.length) {
    const size = data.getUint32(offset, true);

    offset += 4;
    files.push(buffer.slice(offset, offset + size));
    offset += size;
  }

  return { version, files };
}

function decodeClipboardToJson (html) {
  const { figmeta, figma } = extractMarkers(html);
  const meta = JSON.parse(Buffer.from(figmeta, 'base64').toString('utf8'));
  const figmaRaw = Buffer.from(figma, 'base64');

  const { version, files } = parseArchive(new Uint8Array(figmaRaw));

  if (files.length < 2) { throw new Error('Invalid fig-kiwi archive: missing schema/data files'); }

  const schemaRaw = pako.inflateRaw(files[0]);
  const schema = decodeBinarySchema(schemaRaw);
  const compiled = compileSchema(schema);
  const message = compiled.decodeMessage(pako.inflateRaw(files[1]));

  return {
    archive: {
      prelude: 'fig-kiwi',
      version,
      fileCount: files.length,
    },
    meta,
    message,
  };
}

function main () {
  const outputPath = resolveOutputPath(process.argv[2]);
  const outputDir = path.dirname(outputPath);

  const html = readClipboardHtml();
  const decoded = decodeClipboardToJson(html);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(decoded, null, 2), 'utf8');

  const nodeCount = Array.isArray(decoded?.message?.nodeChanges)
    ? decoded.message.nodeChanges.length
    : 0;

  console.info(`✅ 已解码剪贴板并写入: ${outputPath}`);
  console.info(`📊 nodeChanges: ${nodeCount}`);
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
