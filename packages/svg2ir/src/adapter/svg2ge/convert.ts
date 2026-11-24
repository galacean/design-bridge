import type { SVGSource } from '../../common/types';
import { parseSVGToIRWithPreservedData } from '../../svg2ir/convert';
import type { SVGConversionContext } from '../../svg2ir/convert';
import type { SVGPreservedData } from '../../svg-preserved-data';
import { assembleSVGGE } from './assemble';
import type { SVGToGEOptions, SVGToGEResult } from './types';

/** SVG→GE 显式入口。传入 preservedData 时应用 SVG 专属后处理。 */
export function convertSVGToGE(
  source: SVGSource,
  options?: SVGToGEOptions,
  preservedData?: SVGPreservedData,
): SVGToGEResult;
export function convertSVGToGE(
  context: SVGConversionContext,
  options?: SVGToGEOptions,
  preservedData?: SVGPreservedData,
): SVGToGEResult;
export function convertSVGToGE(
  sourceOrContext: SVGSource | SVGConversionContext,
  options?: SVGToGEOptions,
  preservedData?: SVGPreservedData,
): SVGToGEResult {
  const { fonts: _fonts, ...parserOptions } = options ?? {};
  const context = typeof sourceOrContext === 'string'
    ? parseSVGToIRWithPreservedData(sourceOrContext, parserOptions)
    : sourceOrContext;

  return assembleSVGGE(context, options, preservedData ?? (typeof sourceOrContext === 'string'
    ? undefined
    : sourceOrContext.preservedData));
}
