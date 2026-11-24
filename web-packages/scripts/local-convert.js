/**
 * Convert tests/fixtures/lottie/urls.txt into GE scenes with local image copies.
 * Usage: node scripts/local-convert.js
 * Output: tmp/output/<URL hash>/result.json and images/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { listInputFiles, readInputFile } from '../server/file-api/input-sources.js';
import { convertIRToGE } from '@galacean/ge-ir';
import { convertLottieToIR } from '@galacean/lottie2ir';
import { saveGEArtifacts } from './save-ge-artifacts.js';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../tmp/output');

async function convertUrl(sourceUrl, outputDir) {
  const name = sourceUrl;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📦 ${name}`);
  console.log(`${'─'.repeat(50)}`);

  console.log('\n🔄 下载 JSON 并转换...');
  const startTime = performance.now();
  const json = await readInputFile(sourceUrl);
  const irResult = await convertLottieToIR(json, { resourceBaseUrl: sourceUrl });
  const geResult = convertIRToGE(irResult.scene);
  const diagnostics = [...irResult.diagnostics, ...geResult.diagnostics];
  const convertMs = Math.round(performance.now() - startTime);

  console.log(`✅ 转换完成 (${convertMs}ms)`);
  console.log(`   图片: ${geResult.scene.images.length} 张`);
  if (diagnostics.length > 0) {
    console.log(`   ⚠️  转换诊断: ${diagnostics.map(diagnostic => diagnostic.code).join(', ')}`);
  }

  console.log('\n💾 保存到本地...');
  const imageBuffers = {};

  for (const image of geResult.scene.images) {
    const url = new URL(image.url, sourceUrl);

    if (!['http:', 'https:', 'data:'].includes(url.protocol)) {
      throw new Error(`Unsupported image URL: ${image.url}`);
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });

    if (!response.ok) {
      throw new Error(`Image download failed: HTTP ${response.status} (${url})`);
    }
    const contentType = response.headers.get('content-type')?.split(';')[0];
    const extension = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
      'image/svg+xml': '.svg', 'image/avif': '.avif',
    }[contentType];

    if (extension == null) {
      throw new Error(`Unsupported image content type: ${contentType}`);
    }
    const imagePath = `image-${Object.keys(imageBuffers).length}${extension}`;

    imageBuffers[imagePath] = new Uint8Array(await response.arrayBuffer());
    image.url = imagePath;
  }
  const artifacts = await saveGEArtifacts(geResult.scene, imageBuffers, '', 'result.json');

  fs.mkdirSync(outputDir, { recursive: true });
  const imagesDir = path.join(outputDir, 'images');

  fs.mkdirSync(imagesDir, { recursive: true });

  const jsonPath = path.join(outputDir, artifacts.jsonFileName);

  fs.writeFileSync(jsonPath, artifacts.jsonText, 'utf-8');

  for (const imageFile of artifacts.imageFiles) {
    const imagePath = path.join(outputDir, imageFile.relativePath);

    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from(imageFile.bytes));
  }

  console.log(`✅ 保存完成`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   图片: ${artifacts.imageFiles.length} 个文件`);

  // 3. 验证输出
  console.log('\n🔍 验证输出...');
  const savedJSON = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  let allValid = true;

  for (const image of savedJSON.images) {
    const fullPath = path.join(outputDir, image.url);
    const exists = fs.existsSync(fullPath);
    const isRelative = image.url.startsWith('images/') && !image.url.startsWith('data:');

    if (!exists || !isRelative) {
      console.error(`   ❌ ${image.url} — ${!exists ? '文件不存在' : '非相对路径'}`);
      allValid = false;
    }
  }

  if (allValid) {
    console.log(`   ✅ 全部 ${savedJSON.images.length} 张图片验证通过`);
  }

  return { jsonPath, imageCount: artifacts.imageFiles.length, convertMs };
}

async function main() {
  console.log('🚀 lottie2ge 本地转换\n');

  if (process.argv.length > 2) {
    throw new Error('Inputs are configured in tests/fixtures/lottie/urls.txt; command-line paths are not supported.');
  }
  const urls = await listInputFiles(ROOT_DIR, 'lottie');

  console.log(`找到 ${urls.length} 个输入 URL`);
  console.log(`输出目录: ${OUTPUT_DIR}\n`);

  const results = [];

  for (const name of urls) {
    const outputDir = path.join(OUTPUT_DIR, createHash('sha256').update(name).digest('hex').slice(0, 16));
    const result = await convertUrl(name, outputDir);

    results.push({ name, ...result });
  }

  // 汇总
  console.log(`\n${'═'.repeat(50)}`);
  console.log('📊 汇总\n');
  for (const { name, jsonPath, imageCount, convertMs } of results) {
    console.log(`  ${name}`);
    console.log(`    → ${jsonPath}`);
    console.log(`    → ${imageCount} 张图片, ${convertMs}ms\n`);
  }
  console.log('🎉 全部完成！');
}

main().catch(err => {
  console.error('❌ 执行异常:', err);
  process.exit(1);
});
