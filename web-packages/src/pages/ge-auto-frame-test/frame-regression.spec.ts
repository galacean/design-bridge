import { listInputFiles, readInputText } from '../../features/local-inputs/input-api';
import { renderFrameGallery } from '../../features/frame-comparison/regression/render-frame-gallery';
/**
 * GE ↔ IR 帧回归自动化测试 — Mocha spec。
 *
 * 在浏览器中直接运行（Vite dev server + Mocha）。
 * 从 /api/ge2ir 加载原始 GE JSONScene → convertGEToIR → convertIRToGE
 * → 双侧 GE 渲染 → 逐帧对比 → 断言。
 * 每帧的 原始 GE 截图、Round-Trip 截图、差异热力图会插入到页面。
 */
import {
  FRAME_SAMPLE_COUNT,
  isFramePass,
  getFailedMetrics,
} from '../../features/frame-comparison/core/frame-comparison-config';
import { runGERoundtripComparison } from '../../features/frame-comparison/core/run-ge-roundtrip-comparison';
import { runGEDSLRoundtripComparison } from '../../features/frame-comparison/core/run-ge-dsl-roundtrip-comparison';

const { expect } = chai;

function isAborted(signal?: AbortSignal): boolean {
  return !!signal?.aborted;
}

/** 每个动画的采样帧数 */
const SAMPLE_COUNT = FRAME_SAMPLE_COUNT;

/** ge2ir 帧率参数（不影响时长采样） */
const FRAME_RATE = 30;

/**
 * 对比模式：
 * - ge2ir 模式 `ge2ir`（默认）：GE → IR → GE round-trip。
 * - ge2dsl 模式 `ge2dsl`：GE → DSL → GE no-op round-trip，验证 preserved-data 链路无损。
 * 通过 URL 参数 ?mode=ge2dsl 切换。
 */
function getComparisonMode(): 'ge2ir' | 'ge2dsl' {
  return new URLSearchParams(window.location.search).get('mode') === 'ge2dsl' ? 'ge2dsl' : 'ge2ir';
}

const COMPARISON_RUNNERS = {
  ge2ir: runGERoundtripComparison,
  ge2dsl: runGEDSLRoundtripComparison,
} as const;

/** 从 URL 参数 ?max=N 读取最大测试数量，默认不限制 */
function getMaxFixtures(): number {
  const params = new URLSearchParams(window.location.search);
  const maxParam = params.get('max');

  return maxParam ? Math.max(1, parseInt(maxParam, 10) || Infinity) : Infinity;
}

// Load regression inputs from tests/fixtures/ge/urls.txt.

async function loadLocalFixtures(): Promise<string[]> {
  const files = await listInputFiles('ge');
  const params = new URLSearchParams(window.location.search);
  const exact = params.get('exact');
  const only = params.get('only');
  const filtered = exact ? files.filter(f => f === exact) : only ? files.filter(f => f.includes(only)) : files;
  const maxCount = getMaxFixtures();
  const selected = filtered.slice(0, maxCount);

  console.info(
    `[GE Test] Found ${files.length} files, testing ${selected.length} (exact=${exact ?? '-'}, only=${only ?? '-'}, max=${maxCount})`,
  );

  return selected;
}

async function loadLocalGEScene(fileName: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readInputText('ge', fileName)) as Record<string, unknown>;
}

// ─── 启动测试 ───
// Mocha 不支持 before() 里动态创建 it()，所以先同步 fetch 列表，
// 再调用 mocha.run() 前动态注册所有 it()。

export async function registerGEFrameRegressionSuite(
  galleryRoot: HTMLElement,
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const { signal } = options;

  if (isAborted(signal)) {
    return 0;
  }

  const fixtures = await loadLocalFixtures();

  if (fixtures.length === 0) {
    console.warn('[GE Test] tests/fixtures/ge/urls.txt 中没有输入 URL');

    return 0;
  }

  const mode = getComparisonMode();
  const runComparison = COMPARISON_RUNNERS[mode];
  const modeLabel = mode === 'ge2dsl' ? 'GE→DSL→GE' : 'GE→IR→GE';

  describe(`GE ↔ IR 帧回归测试 [${modeLabel}] (${fixtures.length} files)`, function () {
    for (const fileName of fixtures) {
      it(fileName, async function () {
        if (isAborted(signal)) {
          return;
        }

        const scene = await loadLocalGEScene(fileName);

        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        expect(scene.compositions, 'scene.compositions should exist').to.exist;

        const frames = await runComparison(scene, {
          frameRate: FRAME_RATE,
          sampleCount: SAMPLE_COUNT,
          signal,
        });

        expect(frames).to.have.length(SAMPLE_COUNT);

        // 渲染帧图片到页面
        renderFrameGallery(fileName, frames, galleryRoot, ['原始 GE', 'Round-Trip']);

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
