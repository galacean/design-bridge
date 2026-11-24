import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FrameTestReportTable } from './frame-test-report-table';
import type { LottieFrameResult, SVGFrameResult } from '../core/types';

const base = {
  time: 0, fullSsim: 1, coreRoiSsim: 1, blurredSsim: 1, pixelDiffRatio: 0,
  lottieDataUrl: 'source', effectsDataUrl: 'target', diffDataUrl: 'diff',
};

describe('frame report metrics', () => {
  it('summarizes the maximum SVG local difference without a contour column', () => {
    const frames: SVGFrameResult[] = [
      { ...base, format: 'svg', localDiffDensity: 0.1 },
      { ...base, format: 'svg', time: 1, localDiffDensity: 0.4 },
    ];
    const markup = renderToStaticMarkup(
      <FrameTestReportTable results={frames} selectedFrame={0} setSelectedFrame={() => undefined} />,
    );

    expect(markup).toContain('逐帧结果');
    expect(markup).toContain('全图相似度');
    expect(markup).toContain('中心相似度');
    expect(markup).toContain('模糊相似度');
    expect(markup).toContain('像素差异率');
    expect(markup).toContain('最大局部差异率');
    expect(markup).toContain('40.00%');
    expect(markup).not.toContain('轮廓 IoU');
  });

  it('keeps the contour metric without an SVG-only local difference column', () => {
    const frame: LottieFrameResult = { ...base, format: 'lottie', edgeIoU: 1 };
    const markup = renderToStaticMarkup(
      <FrameTestReportTable results={[frame]} selectedFrame={0} setSelectedFrame={() => undefined} />,
    );

    expect(markup).toContain('轮廓 IoU');
    expect(markup).not.toContain('局部差异');
    expect(markup).toContain('测试报告');
    expect(markup).toContain('核心 ROI');
    expect(markup).toContain('bg-[var(--workbench-surface)] rounded-2xl');
  });
});
