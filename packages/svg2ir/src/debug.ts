/**
 * 内部调试入口，不属于稳定 API。
 *
 * 仅供仓库内 parser、validation 和错误排障使用。
 */

// Parser and input helpers
export { parseSVGToIRScene } from './svg2ir';

// Error helpers
export {
  SVGConverterError,
  SVG_CONVERTER_ERROR_CODES,
  isSVGConverterErrorCode,
  normalizeToConverterError,
} from './common/errors';
export type { SVGConverterErrorCode } from './common/errors';
