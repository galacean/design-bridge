/** Compare native SVG snapshots with GE at the same sampling times. */
import { compareDataUrls } from './image-comparator';
import { resolveTargetSeekTime } from './frame-comparison-config';
import { END_OF_TIMELINE_PROBE_RATIO, FRAME_SAMPLE_COUNT, getSampleTimePoints } from './frame-comparison-config';
import type { SVGFrameResult } from './types';

import { SvgRenderer, parseConcreteSvgLength, readRootSvgAttribute } from '../runtime/svg-renderer';
import { EffectsRenderer } from '../runtime/effects-renderer';
import { convertSVGToEffects, getMeasureText, prepareSvgForConvert } from './svg2ge-shared';

export interface RunSvgFrameComparisonOptions {
  signal?: AbortSignal;
  onPhaseChange?: (phase: 'converting' | 'loading' | 'running') => void;
  onFrameProgress?: (index: number, total: number, time: number) => void;
  /** 帧对比和可见预览使用同一份 SVG 与 GE scene。 */
  onConverted?: (
    preparedInput: PreparedSvgComparisonInput,
    result: SvgFrameConversionResult,
  ) => void;
  /** Sample animation frames; defaults to a single static frame. */
  animated?: boolean;
  sampleCount?: number;
  resourceBaseUrl?: string;
}

export type SvgFrameConversionResult = ReturnType<typeof convertSVGToEffects>;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    if (signal.reason instanceof Error) { throw signal.reason; }

    throw new Error('SVG 帧对比 aborted');
  }
}

/** Identical source snapshots are non-comparable, even when the SVG clock advances. */
export function hasVisualFrameVariation(dataUrls: string[]): boolean {
  const first = dataUrls[0];

  return first != null && dataUrls.some(dataUrl => dataUrl !== first);
}

export type DynamicFrameVariationState = 'comparable' | 'source-static' | 'target-static';

/**
 * Pixel thresholds can hide a frozen target on a mostly transparent canvas.
 * Classify source/target motion separately before evaluating visual similarity.
 */
export function classifyDynamicFrameVariation(
  sourceDataUrls: string[],
  targetDataUrls: string[],
): { state: DynamicFrameVariationState; message?: string } {
  if (!hasVisualFrameVariation(sourceDataUrls)) {
    return {
      state: 'source-static',
      message: '原生 SVG 在全部采样点没有可观测像素变化；该样本可能是事件/脚本触发、合法 no-op、无效 SMIL、不可见动画或 WPT 绿色 pass-marker，不能据此判定动画转换通过。',
    };
  }
  if (!hasVisualFrameVariation(targetDataUrls)) {
    return {
      state: 'target-static',
      message: '原生 SVG 在采样窗口内有可观测动画，但 GE 所有采样帧完全相同；动画转换或 Galacean Effects Runtime seek 未生效。',
    };
  }

  return { state: 'comparable' };
}

/** Prefer concrete width/height, then viewBox dimensions, then the supplied fallback. */
export function readSvgSize(
  svgString: string, fallbackW: number, fallbackH: number,
): { width: number; height: number } {
  const openingTag = svgString.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  // Percentage dimensions depend on the embedding viewport, not intrinsic pixel dimensions.
  const authoredWidth = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'width'));
  const authoredHeight = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'height'));
  const viewBoxParts = (readRootSvgAttribute(openingTag, 'viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const viewBoxWidth = viewBoxParts[2];
  const viewBoxHeight = viewBoxParts[3];
  const width = authoredWidth ?? viewBoxWidth;
  const height = authoredHeight ?? viewBoxHeight;

  return {
    width: Number.isFinite(width) && width > 0 ? width : fallbackW,
    height: Number.isFinite(height) && height > 0 ? height : fallbackH,
  };
}

/** Give both renderers the same concrete viewport while preserving the authored viewBox. */
export function ensureSvgComparisonViewport(svgString: string, width: number, height: number): string {
  const openingTag = svgString.match(/<svg\b[^>]*>/i)?.[0];

  if (openingTag == null) { return svgString; }
  const authoredWidth = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'width'));
  const authoredHeight = parseConcreteSvgLength(readRootSvgAttribute(openingTag, 'height'));

  if (authoredWidth != null && authoredHeight != null) {
    return svgString;
  }
  const withoutDimensions = openingTag.replace(
    /\s+(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    '',
  );
  const sizedTag = withoutDimensions.replace(
    /^<svg\b/i,
    `<svg width="${width}" height="${height}"`,
  );

  return svgString.replace(openingTag, sizedTag);
}

export interface PreparedSvgComparisonInput {
  svg: string;
  width: number;
  height: number;
}

/** Share font, image and viewport preprocessing between previews and comparisons. */
export async function prepareSvgComparisonInput(svgString: string, resourceBaseUrl?: string): Promise<PreparedSvgComparisonInput> {
  const inlinedSvg = await prepareSvgForConvert(svgString, resourceBaseUrl);
  const { width, height } = readSvgSize(inlinedSvg, 400, 300);

  return {
    svg: ensureSvgComparisonViewport(inlinedSvg, width, height),
    width,
    height,
  };
}

/** Match both canvases to the GE headless size limit. */
const GE_HEADLESS_MAX_CANVAS = 2048;

function capToGeCanvasSize(width: number, height: number): { width: number; height: number } {
  if (width <= GE_HEADLESS_MAX_CANVAS && height <= GE_HEADLESS_MAX_CANVAS) {
    return { width, height };
  }
  const aspect = width / height;

  if (height >= width) {
    return { width: Math.round(GE_HEADLESS_MAX_CANVAS * aspect), height: GE_HEADLESS_MAX_CANVAS };
  }

  return { width: GE_HEADLESS_MAX_CANVAS, height: Math.round(GE_HEADLESS_MAX_CANVAS / aspect) };
}

async function compareSvgFrame(
  time: number, svgDataUrl: string, effectsDataUrl: string, width: number, height: number,
): Promise<SVGFrameResult> {
  const metrics = await compareDataUrls(svgDataUrl, effectsDataUrl, width, height, { localDiffDensity: true });

  return {
    format: 'svg', time,
    fullSsim: metrics.fullSsim,
    coreRoiSsim: metrics.coreRoiSsim,
    blurredSsim: metrics.blurredSsim,
    pixelDiffRatio: metrics.pixelDiffRatio,
    localDiffDensity: metrics.localDiffDensity,
    lottieDataUrl: svgDataUrl,
    effectsDataUrl,
    diffDataUrl: metrics.diffDataUrl,
  };
}

export async function runSvgFrameComparison(
  svgString: string,
  options: RunSvgFrameComparisonOptions = {},
): Promise<SVGFrameResult[]> {
  throwIfAborted(options.signal);
  const animated = options.animated === true;

  // Use the same sans-serif font on both sides to isolate geometry differences.
  const preparedInput = await prepareSvgComparisonInput(svgString, options.resourceBaseUrl);
  const { svg: comparisonSvg, width: rawWidth, height: rawHeight } = preparedInput;
  // Use equal canvas sizes so resizing does not dilute differences.
  const { width, height } = capToGeCanvasSize(rawWidth, rawHeight);

  options.onPhaseChange?.('converting');
  const frameConversionResult = convertSVGToEffects(comparisonSvg, {
    measureText: getMeasureText(), resourceBaseUrl: options.resourceBaseUrl ?? window.location.href,
  });

  throwIfAborted(options.signal);
  options.onConverted?.(preparedInput, frameConversionResult);
  const effectsData = frameConversionResult.data;

  options.onPhaseChange?.('loading');
  const svgRenderer = new SvgRenderer(width, height, animated);
  const effectsRenderer = new EffectsRenderer(width, height);

  try {
    const composition = frameConversionResult.ir.compositions[0];
    const irDuration = animated
      ? Math.max(0, (composition.outPoint - composition.inPoint) / composition.frameRate)
      : undefined;

    await svgRenderer.load(comparisonSvg, irDuration);
    await effectsRenderer.load(effectsData as unknown as Record<string, unknown>);
    throwIfAborted(options.signal);

    options.onPhaseChange?.('running');

    if (animated) {
      const duration = svgRenderer.getDuration();
      const sampleCount = options.sampleCount ?? FRAME_SAMPLE_COUNT;
      const timePoints = getSampleTimePoints(duration, sampleCount);
      const frames: SVGFrameResult[] = [];
      const sourceObservedTimes: Array<number | undefined> = [];

      for (let i = 0; i < timePoints.length; i++) {
        throwIfAborted(options.signal);
        const t = timePoints[i];

        options.onFrameProgress?.(i, timePoints.length, t);

        await svgRenderer.gotoTimeAsync(t);
        const observed = svgRenderer.getObservedAnimationTime();

        sourceObservedTimes.push(observed);
        effectsRenderer.gotoTime(resolveTargetSeekTime(t, observed));

        const svgDataUrl = svgRenderer.toDataUrl();
        const effectsDataUrl = effectsRenderer.toDataUrl();

        frames.push(await compareSvgFrame(t, svgDataUrl, effectsDataUrl, width, height));
      }

      if (frames.length > 1) {
        await appendEndOfTimelineProbe({
          frames, timePoints, sourceObservedTimes, svgRenderer, effectsRenderer, width, height, duration,
          onFrameProgress: options.onFrameProgress,
        });

        const classification = classifyDynamicFrameVariation(
          frames.map(frame => frame.lottieDataUrl),
          frames.map(frame => frame.effectsDataUrl),
        );

        if (hasSvgTimelineSeekFailure(timePoints, sourceObservedTimes)) {
          throw new Error('动态帧基建异常：SVG timeline currentTime 未到达采样点，setCurrentTime seek 未生效。');
        }
        for (const frame of frames) {
          frame.comparisonState = classification.state;
          frame.comparisonMessage = classification.message;
        }
      }

      return frames;
    }

    options.onFrameProgress?.(0, 1, 0);
    svgRenderer.gotoTime(0);
    effectsRenderer.gotoTime(0);

    const svgDataUrl = svgRenderer.toDataUrl();
    const effectsDataUrl = effectsRenderer.toDataUrl();
    const frame = await compareSvgFrame(0, svgDataUrl, effectsDataUrl, width, height);

    throwIfAborted(options.signal);

    return [frame];
  } finally {
    svgRenderer.dispose();
    effectsRenderer.dispose();
  }
}

/** Check observed SMIL seek times; identical raster frames alone do not prove a seek failure. */
export function hasSvgTimelineSeekFailure(
  expectedTimes: number[],
  observedTimes: Array<number | undefined>,
  toleranceSeconds = 1 / 120,
): boolean {
  for (let index = 0; index < expectedTimes.length; index++) {
    const expected = expectedTimes[index];
    const observed = observedTimes[index];

    if (!Number.isFinite(observed)) { continue; }
    if (Math.abs((observed as number) - expected) > toleranceSeconds) { return true; }
  }

  return false;
}

/**
 * The interior grid misses animations whose only change occurs at the final boundary,
 * such as a single-value animation with fill="freeze". Probe those samples just past
 * the end; skip the probe for changing samples to avoid mixing in loop wrap-around.
 */
async function appendEndOfTimelineProbe(input: {
  frames: SVGFrameResult[];
  timePoints: number[];
  sourceObservedTimes: Array<number | undefined>;
  svgRenderer: SvgRenderer;
  effectsRenderer: EffectsRenderer;
  width: number;
  height: number;
  duration: number;
  onFrameProgress?: RunSvgFrameComparisonOptions['onFrameProgress'];
}): Promise<void> {
  const { frames, timePoints, sourceObservedTimes, svgRenderer, effectsRenderer, width, height, duration } = input;
  const first = frames[0]?.lottieDataUrl;

  if (first == null || duration <= 0) { return; }
  if (frames.some(frame => frame.lottieDataUrl !== first)) { return; }
  const probeTime = duration * END_OF_TIMELINE_PROBE_RATIO;

  await svgRenderer.gotoTimeAsync(probeTime);
  sourceObservedTimes.push(svgRenderer.getObservedAnimationTime());
  effectsRenderer.gotoTime(resolveTargetSeekTime(probeTime, svgRenderer.getObservedAnimationTime()));

  const svgDataUrl = svgRenderer.toDataUrl();
  const effectsDataUrl = effectsRenderer.toDataUrl();

  if (svgDataUrl === first) { return; }
  const frame = await compareSvgFrame(probeTime, svgDataUrl, effectsDataUrl, width, height);

  input.onFrameProgress?.(frames.length, frames.length + 1, probeTime);
  frames.push(frame);
  timePoints.push(probeTime);
}
