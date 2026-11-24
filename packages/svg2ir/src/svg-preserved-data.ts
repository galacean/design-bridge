import type { IRAnimatedProperty, IRBezierPath, IRColor, IRVec3 } from '@galacean/animation-ir';

/** SVG 富文本单个片段的保留数据。 */
export interface SVGPreservedTextSpan {
  text: string;
  fontSize?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  newLine: boolean;
  dx?: number;
  dxRaw?: string;
  dy?: number;
  dyRaw?: string;
}

/** SVG 文本层在核心 IR 之外保留的富文本数据。 */
export interface SVGPreservedTextData {
  spans: SVGPreservedTextSpan[];
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  isPathText: boolean;
  deltaWyForRich?: number;
}

/** SVG paint 动画在核心 IR 之外保留的数据。 */
export type SVGPreservedPaintAnimation =
  | {
      kind: 'context';
      staticElementOpacity: number;
      layerOpacityMultiplier: number;
      paintOpacity: { fill: number; stroke: number };
      solidColorAlpha: { fill: number; stroke: number };
      gradientStopColorAlpha: { fill: number[]; stroke: number[] };
      geometryScale?: IRAnimatedProperty<IRVec3>;
    }
  | {
      kind: 'opacity';
      target: 'fill' | 'stroke';
      opacity: IRAnimatedProperty<number>;
      alphaBase: number;
    }
  | {
      kind: 'solid-color';
      target: 'fill' | 'stroke';
      color: IRAnimatedProperty<IRColor>;
    }
  | {
      kind: 'gradient-stop-color';
      target: 'fill' | 'stroke';
      paintIndex: number;
      stopIndex: number;
      color: IRAnimatedProperty<IRColor>;
    }
  | {
      kind: 'stroke-width';
      width: IRAnimatedProperty<number>;
    };

/** SVG 形状路径的动画时间线。 */
export interface SVGPreservedShapeAnimation {
  keyframes: Array<{ time: number; paths: IRBezierPath[] }>;
}

/** GE Runtime 可加载的 SVG 字体定义。 */
export interface SVGFontDefinition {
  fontFamily: string;
  fontURL: string;
}

/** SVG parser 输出、GE 和静态分层适配阶段消费的旁路数据。 */
export interface SVGPreservedData {
  textDataByLayerId: Map<string, SVGPreservedTextData>;
  paintAnimationsByLayerId: Map<string, SVGPreservedPaintAnimation[]>;
  shapeAnimationsByLayerId?: Map<string, SVGPreservedShapeAnimation>;
}
