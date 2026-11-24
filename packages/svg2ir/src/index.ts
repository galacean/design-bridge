/**
 * @galacean/svg2ir — SVG → Animation IR / Effects 转换引擎。
 *
 * 根入口提供 SVG→IR、SVG 保留数据拆分及 GE/静态分层输出。
 */

export { convertSVGToIR, splitSVG } from './svg2ir/convert';
export { convertSVGToLayers } from './adapter/svg2layers/convert';
export { convertSVGToGE } from './adapter/svg2ge/convert';
export type {
  ConvertOptions,
  ConvertResult,
  SVG2IRWarning,
  SVG2IRWarningCode,
  SVGSource,
} from './common/types';
export type { SplitSVGOptions, SplitSVGResult, SVGConversionContext } from './svg2ir/convert';
export type { SVGToGEOptions, SVGToGEResult } from './adapter/svg2ge/types';
export type {
  SVGPreservedData,
  SVGFontDefinition,
  SVGPreservedPaintAnimation,
  SVGPreservedShapeAnimation,
  SVGPreservedTextData,
  SVGPreservedTextSpan,
} from './svg-preserved-data';
export type {
  SVGStaticLayer, SVGImageLayer, SVGTextLayer, SVGTextFragment, SVGLayerBBox,
  SVGToLayersOptions, SVGToLayersResult, SVGLayerEraseOperation, SVGImageResource, SVGImageResourceLoader,
} from './adapter/svg2layers/types';

export { inferNumericWeightFromFamily } from './svg2ir/converter/text/font-metrics';
