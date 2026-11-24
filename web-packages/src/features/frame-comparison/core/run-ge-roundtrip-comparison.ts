import { readGESceneMetadata } from '../../ge-preview/read-scene-metadata';
import { convertGEToIR, convertIRToGE } from '@galacean/ge-ir';
import { compareDataUrls } from './image-comparator';
import { FRAME_SAMPLE_COUNT, getSampleTimePoints } from './frame-comparison-config';
import type { GEFrameResult } from './types';
import { EffectsRenderer } from '../runtime/effects-renderer';

export interface RunGERoundtripComparisonOptions {
  /** ge2ir 帧率参数（仅影响 IR 帧换算，不影响时长采样）。默认 30。 */
  frameRate?: number;
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

/**
 * GE Round-Trip 帧对比：原始 GE 场景 → ge2ir → IR → ir2ge → Round-Trip GE，
 * 两侧用同一 GE 渲染/截图管线逐帧对比。
 *
 * 复用 FrameResult 字段：lottieDataUrl 存原始 GE 截图，effectsDataUrl 存
 * Round-Trip 截图（语义复用，避免改动下游 types/UI）。
 */
export async function runGERoundtripComparison(
  originScene: Record<string, unknown>,
  options: RunGERoundtripComparisonOptions = {},
): Promise<GEFrameResult[]> {
  throwIfAborted(options.signal);

  const { width, height } = readGESceneMetadata(originScene).previewSize ?? { width: 512, height: 512 };
  const frameRate = options.frameRate ?? 30;
  const sampleCount = options.sampleCount ?? FRAME_SAMPLE_COUNT;

  options.onPhaseChange?.('converting');
  const { scene: irScene, preservedData } = convertGEToIR(originScene, {
    frameRate, resourceBaseUrl: window.location.href,
  });
  const { scene } = convertIRToGE(irScene, { preservedData });
  const roundTripScene = scene as unknown as Record<string, unknown>;

  throwIfAborted(options.signal);

  options.onPhaseChange?.('loading');
  let renderer = new EffectsRenderer(width, height);

  try {
    await renderer.load(originScene);
    throwIfAborted(options.signal);

    const duration = renderer.getDuration();
    const timePoints = getSampleTimePoints(duration, sampleCount);
    const originDataUrls: string[] = [];

    for (const time of timePoints) {
      throwIfAborted(options.signal);
      renderer.gotoTime(time);
      originDataUrls.push(renderer.toDataUrl());
    }

    // GE warns when multiple Players coexist and long fixture runs can leak
    // state across their WebGL contexts. Dispose the origin Player before
    // creating the round-trip Player; a disposed canvas cannot be reused.
    renderer.dispose();
    renderer = new EffectsRenderer(width, height);
    await renderer.load(roundTripScene);
    throwIfAborted(options.signal);

    options.onPhaseChange?.('running');
    const frames: GEFrameResult[] = [];

    for (let i = 0; i < timePoints.length; i++) {
      throwIfAborted(options.signal);

      const time = timePoints[i];

      options.onFrameProgress?.(i, timePoints.length, time);

      renderer.gotoTime(time);

      const originDataUrl = originDataUrls[i];
      const roundTripDataUrl = renderer.toDataUrl();
      const result = await compareDataUrls(originDataUrl, roundTripDataUrl, width, height);

      throwIfAborted(options.signal);

      frames.push({
        format: 'ge' as const,
        time,
        fullSsim: result.fullSsim,
        coreRoiSsim: result.coreRoiSsim,
        blurredSsim: result.blurredSsim,
        edgeIoU: result.edgeIoU,
        pixelDiffRatio: result.pixelDiffRatio,
        lottieDataUrl: originDataUrl,
        effectsDataUrl: roundTripDataUrl,
        diffDataUrl: result.diffDataUrl,
      });
    }

    return frames;
  } finally {
    renderer.dispose();
  }
}
