import { validateIRScene } from '@galacean/animation-ir/validator';
import { SVGConverterError, SVG_CONVERTER_ERROR_CODES, normalizeToConverterError } from '../common/errors';
import type { ConvertOptions, ConvertResult, SVG2IRWarning, SVGSource } from '../common/types';
import { parseSVGToIRScene } from './';
import type { SVGPreservedData, SVGPreservedPaintAnimation, SVGPreservedShapeAnimation, SVGPreservedTextData } from '../svg-preserved-data';

interface SVGPreservedDataCollectors {
  layerSourceCollector?: Map<string, string>;
  warningSourceCollector?: Map<SVG2IRWarning, string>;
  textDataByLayerId: Map<string, SVGPreservedTextData>;
  paintAnimationsByLayerId: Map<string, SVGPreservedPaintAnimation[]>;
  shapeAnimationsByLayerId: Map<string, SVGPreservedShapeAnimation>;
}

/**
 * 把 SVG 转为 Animation IR。Effects lowering 由 `convertSVGToGE` 负责。
 *
 * 该函数是 SVG→IR 的底层入口，供 Effects 转换器和 IR 测试复用。
 */
export function convertSVGToIR (source: SVGSource, options?: ConvertOptions): ConvertResult {
  return parseSVGToIRWithPreservedData(source, options);
}

export type SplitSVGOptions = ConvertOptions;

export interface SVGConversionContext extends ConvertResult {
  preservedData: SVGPreservedData;
}

export type SplitSVGResult = SVGConversionContext;

/** Convert SVG to IR and retain the GE-side data needed for source-specific lowering. */
export function splitSVG (source: SVGSource, options?: SplitSVGOptions): SplitSVGResult {
  const textDataByLayerId = new Map<string, SVGPreservedTextData>();
  const paintAnimationsByLayerId = new Map<string, SVGPreservedPaintAnimation[]>();
  const shapeAnimationsByLayerId = new Map<string, SVGPreservedShapeAnimation>();
  const result = parseSVGToIRWithPreservedData(source, options, {
    textDataByLayerId,
    paintAnimationsByLayerId,
    shapeAnimationsByLayerId,
  });

  return {
    ...result,
    preservedData: {
      textDataByLayerId,
      paintAnimationsByLayerId,
      shapeAnimationsByLayerId,
    },
  };
}

export function parseSVGToIRWithPreservedData (
  source: SVGSource,
  options?: ConvertOptions,
  collectors?: SVGPreservedDataCollectors,
): ConvertResult {
  const warnings: SVG2IRWarning[] = [];
  const emitWarning = (warning: SVG2IRWarning): void => {
    warnings.push(warning);
    options?.onWarning?.(warning);
  };
  const svgString = readSVGString(source);

  const irScene = parseSVGToIRScene(svgString, {
    ...options,
    onWarning: emitWarning,
    layerSourceCollector: collectors?.layerSourceCollector,
    warningSourceCollector: collectors?.warningSourceCollector,
    textDataCollector: collectors?.textDataByLayerId,
    paintAnimationsCollector: collectors?.paintAnimationsByLayerId,
    shapeAnimationCollector: collectors?.shapeAnimationsByLayerId,
  });

  try {
    validateIRScene(irScene);
  } catch (error) {
    throw normalizeToConverterError(
      error,
      SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'Animation IR 校验失败。',
      { stage: 'ir' },
    );
  }

  return { ir: irScene, warnings };
}

/** 校验并返回 SVG 字符串。当前公共 API 只接受字符串输入。 */
function readSVGString (source: SVGSource): string {
  if (typeof source !== 'string') {
    throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.INVALID_SVG, '输入必须是 SVG 字符串。');
  }

  return source;
}
