import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FrameTestPreview } from './frame-test-preview';
import { getOverallResult } from './frame-metrics';
import type { LottieFrameResult, SVGFrameResult } from '../core/types';

const frame: LottieFrameResult = {
  format: 'lottie' as const,
  time: 0, fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 0,
  edgeIoU: 1, lottieDataUrl: 'source.png', effectsDataUrl: 'target.png', diffDataUrl: 'diff.png',
};

const sourceStaticFrame: SVGFrameResult = {
  format: 'svg', time: 0, fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 0, localDiffDensity: 0,
  lottieDataUrl: '', effectsDataUrl: '', diffDataUrl: '', comparisonState: 'source-static',
};

describe('getOverallResult', () => {
  it('labels a native-static dynamic sample as SKIP instead of PASS or FAIL', () => {
    expect(getOverallResult(sourceStaticFrame)).toEqual({
      text: '⏭ SKIP',
      color: 'text-[var(--workbench-muted)]',
    });
  });

  it('labels a frozen GE animation as FAIL even when pixel metrics look perfect', () => {
    expect(getOverallResult({
      ...sourceStaticFrame,
      comparisonState: 'target-static',
    })).toEqual({
      text: '❌ FAIL',
      color: 'text-[var(--coral)]',
    });
  });
});

describe('shared frame preview labels', () => {
  it.each([
    { labels: undefined, expected: ['Lottie 原始', 'GE 转换'], alt: ['Lottie frame', 'GE frame'] },
    { labels: ['SVG 原始', 'GE 转换'] as [string, string], expected: ['SVG 原始', 'GE 转换'],
      alt: ['SVG 原始 frame', 'GE 转换 frame'] },
    { labels: ['原始 GE', '往返 GE'] as [string, string], expected: ['原始 GE', '往返 GE'],
      alt: ['原始 GE frame', '往返 GE frame'] },
  ])('uses caller labels or the existing Lottie defaults', ({ labels, expected, alt }) => {
    const markup = renderToStaticMarkup(
      <FrameTestPreview
        currentResult={frame} results={[frame]} selectedFrame={0} setSelectedFrame={() => undefined} labels={labels}
      />,
    );

    for (const [index, label] of expected.entries()) {
      expect(markup).toContain(`>${label}</div>`);
      expect(markup).toContain(`alt="${alt[index]}"`);
    }
    if (labels != null) { expect(markup).not.toContain('Lottie'); }
  });

  it('shows the reason for a skipped SVG frame and only its applicable metric', () => {
    const svgFrame: SVGFrameResult = {
      ...frame, format: 'svg', edgeIoU: undefined, localDiffDensity: 0.2,
      comparisonState: 'source-static', comparisonMessage: '原生 SVG 没有可观测变化。',
    };
    const markup = renderToStaticMarkup(
      <FrameTestPreview currentResult={svgFrame} results={[svgFrame]} selectedFrame={0} setSelectedFrame={() => undefined} />,
    );

    expect(markup).toContain('原生 SVG 没有可观测变化。');
    expect(markup).toContain('全图相似度');
    expect(markup).toContain('中心相似度');
    expect(markup).toContain('模糊相似度');
    expect(markup).toContain('最大局部差异率');
    expect(markup).toContain('像素差异率');
    expect(markup).not.toContain('轮廓 IoU');
  });

  it('does not show SVG-only metrics for Lottie', () => {
    const markup = renderToStaticMarkup(
      <FrameTestPreview currentResult={frame} results={[frame]} selectedFrame={0} setSelectedFrame={() => undefined} />,
    );

    expect(markup).toContain('轮廓 IoU');
    expect(markup).not.toContain('局部差异');
    expect(markup).toContain('核心 ROI');
    expect(markup).toContain('max-width:300px;max-height:300px');
    expect(markup).not.toContain('aria-label="预览背景"');
    expect(markup).not.toContain('aria-label="上一帧"');
  });
});
