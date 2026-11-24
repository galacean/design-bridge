import type { LottieJSON } from '@galacean/lottie2ir';
import { compareDataUrls } from './image-comparator';
import { FRAME_SAMPLE_COUNT, getSampleTimePoints } from './frame-comparison-config';
import type { LottieFrameResult } from './types';
import { LottieRenderer } from '../runtime/lottie-renderer';
import { EffectsRenderer } from '../runtime/effects-renderer';
import { convertLottieToGE } from '../../lottie-conversion/convert-lottie-to-ge';

export interface RunFrameComparisonOptions {
  sampleCount?: number;
  signal?: AbortSignal;
  onPhaseChange?: (phase: 'converting' | 'loading' | 'running') => void;
  onFrameProgress?: (index: number, total: number, time: number) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Frame comparison aborted');
  }
}

export async function runFrameComparison(
  lottieJSON: LottieJSON,
  options: RunFrameComparisonOptions = {},
): Promise<LottieFrameResult[]> {
  throwIfAborted(options.signal);

  const width = Number(lottieJSON.w) || 512;
  const height = Number(lottieJSON.h) || 512;
  const sampleCount = options.sampleCount ?? FRAME_SAMPLE_COUNT;

  options.onPhaseChange?.('converting');
  const convertResult = await convertLottieToGE(lottieJSON);

  throwIfAborted(options.signal);

  const effectsData = convertResult.data as unknown as Record<string, unknown>;

  options.onPhaseChange?.('loading');
  const lottieRenderer = new LottieRenderer(width, height);
  const effectsRenderer = new EffectsRenderer(width, height);

  try {
    await lottieRenderer.load(lottieJSON as unknown as Record<string, unknown>);
    await effectsRenderer.load(effectsData);
    throwIfAborted(options.signal);

    options.onPhaseChange?.('running');
    const duration = lottieRenderer.getDuration();
    const timePoints = getSampleTimePoints(duration, sampleCount);
    const frames: LottieFrameResult[] = [];

    for (let i = 0; i < timePoints.length; i++) {
      throwIfAborted(options.signal);

      const time = timePoints[i];

      options.onFrameProgress?.(i, timePoints.length, time);

      lottieRenderer.gotoTime(time);
      effectsRenderer.gotoTime(time);

      const lottieDataUrl = await lottieRenderer.toDataUrl();
      const effectsDataUrl = effectsRenderer.toDataUrl();
      const result = await compareDataUrls(lottieDataUrl, effectsDataUrl, width, height);

      throwIfAborted(options.signal);

      frames.push({
        time,
        format: 'lottie' as const,
        fullSsim: result.fullSsim,
        coreRoiSsim: result.coreRoiSsim,
        blurredSsim: result.blurredSsim,
        edgeIoU: result.edgeIoU,
        pixelDiffRatio: result.pixelDiffRatio,
        lottieDataUrl,
        effectsDataUrl,
        diffDataUrl: result.diffDataUrl,
      });
    }

    return frames;
  } finally {
    lottieRenderer.dispose();
    effectsRenderer.dispose();
  }
}
