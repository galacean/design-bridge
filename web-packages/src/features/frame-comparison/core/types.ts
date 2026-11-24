export interface BaseFrameResult {
  time: number;
  fullSsim: number;
  coreRoiSsim: number;
  blurredSsim: number;
  pixelDiffRatio: number;
  lottieDataUrl: string;
  effectsDataUrl: string;
  diffDataUrl: string;
  /** Distinguish comparable frames from a frozen source or target. */
  comparisonState?: 'comparable' | 'source-static' | 'target-static';
  /** Reason for a non-comparable frame. */
  comparisonMessage?: string;
}

export interface LottieFrameResult extends BaseFrameResult {
  format: 'lottie';
  edgeIoU: number;
  localDiffDensity?: never;
}

export interface GEFrameResult extends BaseFrameResult {
  format: 'ge';
  edgeIoU: number;
  localDiffDensity?: never;
}

export interface SVGFrameResult extends BaseFrameResult {
  format: 'svg';
  edgeIoU?: never;
  localDiffDensity: number;
}

export type FrameResult = LottieFrameResult | GEFrameResult | SVGFrameResult;
