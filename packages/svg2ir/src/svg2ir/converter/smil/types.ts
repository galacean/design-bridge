import type { IRAnimatedProperty, IRBezierHandle, IRVec3 } from '@galacean/animation-ir';
import type { SVGMatrix } from '../../matrix';

export interface SMILSample {
  time: number;
  value: number[];
  cycle: number;
  sourceIndex: number;
  /**
   * fractional active interval 结束位置的合成样本 metadata。
   * 该值已经按 authored simple-time 计算，不能作为普通 keyframe 再次应用 spline 缓动。
   */
  activeEndSegment?: {
    cycleStartTime: number;
    segmentIndex: number;
    startTime: number;
    endTime: number;
    startValue: number[];
    endValue: number[];
  };
}

export interface SMILInterval {
  begin: number;
  end: number;
  sampleStart: number;
  sampleEnd: number;
}

/** 解析后的 active SMIL interval，已展开有限 repeat。 */
export interface SMILAnimation {
  attributeName: string;
  type: string;
  begin: number;
  end: number;
  fill: 'remove' | 'freeze';
  additive: 'replace' | 'sum';
  byOnly: boolean;
  indefinite: boolean;
  calcMode: 'linear' | 'discrete' | 'spline' | 'paced';
  keySplines: IRBezierHandle[][];
  samples: SMILSample[];
  intervals: SMILInterval[];
}

export interface TransformContext {
  ancestorMatrix: SVGMatrix;
  selfMatrix: SVGMatrix;
  localCenter: [number, number];
  ancestorStopNode?: globalThis.Element | null;
  preserveAncestorTransforms?: boolean;
  geometry?: GeometryContext;
  geometryScaleSink?: { value?: IRAnimatedProperty<IRVec3> };
  comparisonDuration?: number;
  /** 将文本 paint alpha 与图层 opacity 分离，并在图层轨道上合成各级 authored opacity。 */
  composeOpacityAcrossStages?: boolean;
}

export interface GeometryContext {
  kind: 'rect' | 'circle' | 'ellipse' | 'line' | 'use';
  base: Record<string, number>;
  referenceWidth: number;
  referenceHeight: number;
}

export interface GeometryAnimation {
  animations: SMILAnimation[];
  matrixAtTime: (time: number) => SVGMatrix;
  scaleAtTime: (time: number) => { x: number; y: number };
}

export interface GeometrySample {
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
}

export interface TransformStage {
  node: globalThis.Element;
  staticMatrix: SVGMatrix;
  animations: SMILAnimation[];
  motions: MotionAnimation[];
  geometry?: GeometryAnimation;
  ignoreOpacity?: boolean;
}

export interface MotionPathSegment {
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
  length: number;
  samples: Array<{ t: number; length: number }>;
}

export interface MotionPath {
  segments: MotionPathSegment[];
  totalLength: number;
  vertexProgress: number[];
}

export interface MotionAnimation {
  begin: number;
  end: number;
  simpleDuration: number;
  activeDuration: number;
  fill: 'remove' | 'freeze';
  additive: 'replace' | 'sum';
  indefinite: boolean;
  calcMode: SMILAnimation['calcMode'];
  keySplines: IRBezierHandle[][];
  keyTimes: number[];
  keyPoints: number[];
  usesKeyPoints: boolean;
  path: MotionPath;
  pointValues?: Array<[number, number]>;
  rotate: 'auto' | 'auto-reverse' | number;
}

export const EPSILON = 1e-9;
export const BEGIN_TIME_EPSILON = 1e-7;
export const LINEAR_OUT_TANGENT: IRBezierHandle = { x: 1 / 3, y: 1 / 3 };
export const LINEAR_IN_TANGENT: IRBezierHandle = { x: 2 / 3, y: 2 / 3 };
export const MAX_SYNCBASE_EVENTS = 10000;

export type BeginTimeCache = Map<globalThis.Element, number[]>;

export interface SyncbaseDependency {
  source: globalThis.Element;
  target: globalThis.Element;
  event: 'begin' | 'end';
  offset: number;
}

export type SMILValueParser = (value: string, type: string) => number[] | null;
