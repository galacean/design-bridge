/**
 * Convert Lottie JSON URLs from tests/fixtures/lottie/urls.txt to local GE JSON.
 * Usage: node scripts/batch-convert.js [--limit 10] [--filter URL-substring]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { listInputFiles, readInputFile } from '../server/file-api/input-sources.js';
import { convertIRToGE } from '@galacean/ge-ir';
import { convertLottieToIR } from '@galacean/lottie2ir';

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_DIR = path.resolve(SCRIPT_DIR, '../tmp/output');

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = Infinity;
  let filter = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--filter' && args[i + 1]) {
      filter = args[i + 1];
      i++;
    } else {
      throw new Error(`Unsupported argument: ${args[i]}. Use --limit or --filter to select manifest URLs.`);
    }
  }

  return { limit, filter };
}

async function convertSingleJson(sourceUrl, outputPath) {
  const name = sourceUrl;
  const startTime = performance.now();

  try {
    const jsonContent = await readInputFile(sourceUrl);
    const irResult = await convertLottieToIR(jsonContent, { resourceBaseUrl: sourceUrl });
    const geResult = convertIRToGE(irResult.scene);
    const diagnostics = [...irResult.diagnostics, ...geResult.diagnostics];
    const timeMs = Math.round(performance.now() - startTime);

    // 保存 GE JSON
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(geResult.scene, null, 2), 'utf-8');

    return {
      name,
      success: true,
      timeMs,
      imageCount: geResult.scene.images.length,
      diagnostics,
    };
  } catch (err) {
    const timeMs = Math.round(performance.now() - startTime);

    return {
      name,
      success: false,
      timeMs,
      imageCount: 0,
      diagnostics: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log('🚀 lottie2ge 批量转换\n');

  const { limit, filter } = parseArgs();

  const urls = await listInputFiles(ROOT_DIR, 'lottie');
  const jsonFiles = urls.filter(url => !filter || url.includes(filter)).slice(0, limit);

  if (jsonFiles.length === 0) {
    console.log('⚠️  未找到匹配的 JSON 文件');
    process.exit(0);
  }

  const totalCount = urls.length;

  console.log(`输入清单: ${path.join(ROOT_DIR, 'tests/fixtures/lottie/urls.txt')}`);
  console.log(`输出目录: ${OUTPUT_DIR}`);
  console.log(`文件总数: ${totalCount}, 本次转换: ${jsonFiles.length}`);
  if (filter) {
    console.log(`过滤条件: "${filter}"`);
  }
  console.log('');

  const stats = [];
  const totalStart = performance.now();

  for (let i = 0; i < jsonFiles.length; i++) {
    const name = jsonFiles[i];
    const outputName = createHash('sha256').update(name).digest('hex').slice(0, 16);
    const outputPath = path.join(OUTPUT_DIR, `${outputName}.json`);

    process.stdout.write(`[${i + 1}/${jsonFiles.length}] ${name} ... `);

    const stat = await convertSingleJson(name, outputPath);

    stats.push(stat);

    if (stat.success) {
      const extra = stat.diagnostics.length > 0 ? ` ⚠️${stat.diagnostics.length}项诊断` : '';

      console.log(`✅ ${stat.timeMs}ms, ${stat.imageCount}张图片${extra}`);
    } else {
      console.log(`❌ ${stat.error}`);
    }
  }

  const totalMs = Math.round(performance.now() - totalStart);

  // 汇总
  const succeeded = stats.filter(s => s.success);
  const failed = stats.filter(s => !s.success);
  const withDiagnostics = stats.filter(s => s.diagnostics.length > 0);

  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 汇总\n');
  console.log(`  总计: ${stats.length} 个文件, 耗时 ${totalMs}ms`);
  console.log(`  ✅ 成功: ${succeeded.length}`);
  console.log(`  ❌ 失败: ${failed.length}`);
  console.log(`  ⚠️  含转换诊断: ${withDiagnostics.length}`);

  if (succeeded.length > 0) {
    const avgMs = Math.round(succeeded.reduce((s, v) => s + v.timeMs, 0) / succeeded.length);

    console.log(`  ⏱  平均耗时: ${avgMs}ms`);
  }

  // 失败详情
  if (failed.length > 0) {
    console.log('\n❌ 失败文件:\n');
    for (const stat of failed) {
      console.log(`  ${stat.name}`);
      console.log(`    ${stat.error}\n`);
    }
  }

  // 转换诊断统计
  if (withDiagnostics.length > 0) {
    const diagnosticCount = {};

    for (const stat of withDiagnostics) {
      for (const diagnostic of stat.diagnostics) {
        diagnosticCount[diagnostic.code] = (diagnosticCount[diagnostic.code] ?? 0) + 1;
      }
    }

    console.log('\n⚠️  转换诊断统计:\n');
    const sorted = Object.entries(diagnosticCount).sort((a, b) => b[1] - a[1]);

    for (const [feature, count] of sorted) {
      console.log(`  ${count}x  ${feature}`);
    }
  }

  console.log(`\n输出目录: ${OUTPUT_DIR}`);

  if (failed.length > 0) {
    process.exit(1);
  }

  console.log('\n🎉 全部完成！');
}

main().catch(err => {
  console.error('❌ 执行异常:', err);
  process.exit(1);
});
