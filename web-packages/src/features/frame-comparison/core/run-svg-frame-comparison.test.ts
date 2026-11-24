import { describe, expect, it } from 'vitest';
import {
  classifyDynamicFrameVariation,
  ensureSvgComparisonViewport,
  hasVisualFrameVariation,
  hasSvgTimelineSeekFailure,
  readSvgSize,
} from './run-svg-frame-comparison';

describe('classifyDynamicFrameVariation', () => {
  it('skips a declared dynamic sample when the native SVG has no visual motion', () => {
    expect(classifyDynamicFrameVariation(
      ['source-a', 'source-a', 'source-a'],
      ['target-a', 'target-a', 'target-a'],
    )).toEqual({
      state: 'source-static',
      message: expect.stringContaining('原生 SVG'),
    });
  });

  it('fails visibly instead of throwing when SVG moves but GE stays frozen', () => {
    expect(classifyDynamicFrameVariation(
      ['source-a', 'source-b', 'source-c'],
      ['target-a', 'target-a', 'target-a'],
    )).toEqual({
      state: 'target-static',
      message: expect.stringContaining('GE'),
    });
  });

  it('keeps the normal metric path when both renderers produce changing frames', () => {
    expect(classifyDynamicFrameVariation(
      ['source-a', 'source-b'],
      ['target-a', 'target-b'],
    )).toEqual({ state: 'comparable' });
  });
});

describe('hasVisualFrameVariation', () => {
  it('rejects a dynamic comparison whose native SVG raster is identical at every sample', () => {
    expect(hasVisualFrameVariation([
      'data:image/png;base64,green-square',
      'data:image/png;base64,green-square',
      'data:image/png;base64,green-square',
    ])).toBe(false);
  });

  it('accepts a dynamic comparison as soon as one native SVG sample changes', () => {
    expect(hasVisualFrameVariation([
      'data:image/png;base64,frame-0',
      'data:image/png;base64,frame-1',
      'data:image/png;base64,frame-0',
    ])).toBe(true);
  });
});

describe('hasSvgTimelineSeekFailure', () => {
  it('accepts an advancing SVG clock even when rendered snapshots may be visually identical', () => {
    expect(hasSvgTimelineSeekFailure(
      [0, 0.25, 0.5, 1],
      [0, 0.25, 0.5, 1],
    )).toBe(false);
  });

  it('detects a stuck SVG clock at a non-zero sampling point', () => {
    expect(hasSvgTimelineSeekFailure(
      [0, 0.25, 0.5, 1],
      [0, 0, 0, 0],
    )).toBe(true);
  });

  it('does not invent a failure when the browser cannot expose getCurrentTime', () => {
    expect(hasSvgTimelineSeekFailure(
      [0, 0.25, 0.5, 1],
      [undefined, undefined, undefined, undefined],
    )).toBe(false);
  });

});

describe('ensureSvgComparisonViewport', () => {
  it('adds concrete dimensions when the SVG has no intrinsic viewport', () => {
    expect(ensureSvgComparisonViewport('<svg><rect width="10" height="10"/></svg>', 400, 300))
      .toContain('<svg width="400" height="300">');
  });

  it('replaces percentage dimensions when there is no viewBox to anchor them', () => {
    expect(ensureSvgComparisonViewport('<svg width="100%" height="100%"></svg>', 400, 300))
      .toContain('<svg width="400" height="300">');
  });

  it('materialises percentage dimensions while preserving an authored viewBox', () => {
    const svg = ensureSvgComparisonViewport(
      '<svg width="100%" height="100%" viewBox="0 0 480 360"></svg>',
      480,
      360,
    );

    expect(svg).toContain('<svg width="480" height="360" viewBox="0 0 480 360">');
  });

  it('keeps concrete authored dimensions and viewBox unchanged', () => {
    const svg = '<svg width="960" height="720" viewBox="0 0 480 360"></svg>';

    expect(ensureSvgComparisonViewport(svg, 960, 720)).toBe(svg);
  });
});

describe('readSvgSize', () => {
  it('uses viewBox dimensions instead of parsing percentage lengths as pixels', () => {
    expect(readSvgSize(
      '<svg width="100%" height="100%" viewBox="0 0 480 360"></svg>',
      400,
      300,
    )).toEqual({ width: 480, height: 360 });
  });
});
