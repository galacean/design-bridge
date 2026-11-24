import { listInputFiles, readInputText } from '../../features/local-inputs/input-api';
import { renderFrameGallery } from '../../features/frame-comparison/regression/render-frame-gallery';
/**
 * Lottie→GE 帧回归自动化测试 — Mocha spec。
 *
 * 在浏览器中直接运行（Vite dev server + Mocha）。
 * 从 fixtures URL 列表加载 Lottie JSON → convertLottie → 双侧渲染 → 帧对比 → 断言。
 * 每帧的 Lottie 截图、GE 截图、差异热力图会插入到 Mocha 测试结果中。
 */
import type { LottieJSON } from '@galacean/lottie2ir';
import {
  FRAME_SAMPLE_COUNT,
  isFramePass,
  getFailedMetrics,
} from '../../features/frame-comparison/core/frame-comparison-config';
import { runFrameComparison } from '../../features/frame-comparison/core/run-frame-comparison';

const { expect } = chai;

function isAborted(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

/** 每个动画的采样帧数（与页面侧共享） */
const SAMPLE_COUNT = FRAME_SAMPLE_COUNT;

/** 从 URL 参数 ?max=N 读取最大测试数量，默认不限制 */
function getMaxFixtures(): number {
  const params = new URLSearchParams(window.location.search);
  const maxParam = params.get('max');

  return maxParam ? Math.max(1, parseInt(maxParam, 10) || Infinity) : Infinity;
}

/**
 * 从 URL 参数 ?fixture=a,b,c 读取子串过滤清单（逗号分隔）。
 * 命中任一子串的 fixture 才会入选；为空时不过滤。
 * 用于定向复现/验证单个 fixture，避免每次跑全量。
 */
function getFixtureFilter(): string[] | null {
  const raw = new URLSearchParams(window.location.search).get('fixture');

  if (!raw) {
    return null;
  }

  return raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// Load regression inputs from tests/fixtures/lottie/urls.txt.

async function loadLocalFixtures(): Promise<string[]> {
  const files = await listInputFiles('lottie');
  const filter = getFixtureFilter();
  const filtered = filter ? files.filter(name => filter.some(sub => name.toLowerCase().includes(sub))) : files;
  const maxCount = getMaxFixtures();
  const selected = filtered.slice(0, maxCount);

  console.info(
    `[Test] Found ${files.length} files, testing ${selected.length} (max=${maxCount}${filter ? `, filter=${filter.join('|')}` : ''})`,
  );

  return selected;
}

async function loadLocalLottieJSON(fileName: string): Promise<LottieJSON> {
  return JSON.parse(await readInputText('lottie', fileName)) as LottieJSON;
}

// ─── 启动测试 ───
// Mocha 不支持 before() 里动态创建 it()，所以先同步 fetch 列表，
// 再调用 mocha.run() 前动态注册所有 it()。

export async function registerFrameRegressionSuite(
  galleryRoot: HTMLElement,
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const { signal } = options;

  if (isAborted(signal)) {
    return 0;
  }

  const fixtures = await loadLocalFixtures();

  if (fixtures.length === 0) {
    console.warn('[Test] tests/fixtures/lottie/urls.txt 中没有输入 URL');

    return 0;
  }

  describe(`Lottie→GE 帧回归测试 (${fixtures.length} files)`, function () {
    for (const fileName of fixtures) {
      it(fileName, async function () {
        if (isAborted(signal)) {
          return;
        }

        const lottieJSON = await loadLocalLottieJSON(fileName);

        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(lottieJSON.w, 'lottieJSON.w should exist').to.exist;
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(lottieJSON.h, 'lottieJSON.h should exist').to.exist;

        console.info(`[Test] ${fileName} (${lottieJSON.w}×${lottieJSON.h})`);
        const frames = await runFrameComparison(lottieJSON, {
          sampleCount: SAMPLE_COUNT,
          signal,
        });

        expect(frames).to.have.length(SAMPLE_COUNT);

        // 渲染帧图片到页面
        renderFrameGallery(fileName, frames, galleryRoot, ['Lottie', 'GE']);

        // 检查失败帧
        const failedFrames = frames.filter(f => !isFramePass(f));

        if (failedFrames.length > 0) {
          const details = failedFrames
            .map(f => `t=${f.time.toFixed(2)}s: ${getFailedMetrics(f).join(', ')}`)
            .join('\n  ');

          expect.fail(`${failedFrames.length}/${SAMPLE_COUNT} 帧未通过:\n  ${details}`);
        }
      });
    }
  });

  return fixtures.length;
}
