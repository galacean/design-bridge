#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import pako from 'pako';
import { decodeBinarySchema } from 'kiwi-schema';

function resolveInputPath () {
  const cliInput = process.argv[2];

  if (cliInput) {
    return path.isAbsolute(cliInput) ? cliInput : path.resolve(process.cwd(), cliInput);
  }

  const dataDir = path.resolve(process.cwd(), 'server', 'data');

  if (!fs.existsSync(dataDir)) { return null; }

  const latestClipboard = fs
    .readdirSync(dataDir)
    .filter(name => /^clipboard-.*\.bin$/i.test(name))
    .sort()
    .at(-1);

  if (!latestClipboard) { return null; }

  return path.join(dataDir, latestClipboard);
}

function main () {
  const inputPath = resolveInputPath();

  if (!inputPath || !fs.existsSync(inputPath)) {
    console.error('❌ 未找到可用剪贴板输入文件。请传入路径：');
    console.error('   node packages/html2figma/scripts/dump-schema.js <clipboard-html-or-bin-path>');
    process.exit(1);
  }

  let html = fs.readFileSync(inputPath, 'utf-8');

  html = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  const figmaMatch = html.match(/<!--\(figma\)(.*?)\(\/figma\)-->/s);

  if (!figmaMatch) {
    console.error(`❌ 输入文件中未找到 figma payload: ${inputPath}`);
    process.exit(1);
  }

  const buf = Buffer.from(figmaMatch[1], 'base64');
  const arr = new Uint8Array(buf);

  let offset = 8;
  const view = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  const version = view.getUint32(offset, true);

  offset += 4;

  const files = [];

  while (offset + 4 <= arr.length) {
    const size = view.getUint32(offset, true);

    offset += 4;
    files.push(arr.slice(offset, offset + size));
    offset += size;
  }

  const schemaRaw = pako.inflateRaw(files[0]);
  const schema = decodeBinarySchema(schemaRaw);

  console.info('=== SCHEMA OVERVIEW ===');
  console.info('Input file:', inputPath);
  console.info('Archive version:', version);
  console.info('Total definitions:', schema.definitions.length);
  console.info('');

  for (const def of schema.definitions) {
    const kind = def.kind === 'ENUM' ? 'enum' : 'message';

    console.info(`${kind} ${def.name} {`);
    for (const field of def.fields) {
      const typeStr = field.isArray ? `${field.type}[]` : field.type;

      if (kind === 'enum') {
        console.info(`  ${field.name} = ${field.value};`);
      } else {
        console.info(`  ${typeStr} ${field.name} = ${field.value};`);
      }
    }
    console.info('}');
    console.info('');
  }
}

main();
