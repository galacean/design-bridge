import type { IRLayer } from '@galacean/animation-ir';
import { SVGConverterError, SVG_CONVERTER_ERROR_CODES } from '../../../../common/errors';
import {
  SVG2IR_WARNING_CODES, type ConvertOptions, type SVG2IRWarning, type SVG2IRWarningCode,
} from '../../../../common/types';

export class LayerConversionError extends Error {
  constructor(public readonly code: SVG2IRWarningCode, message: string) {
    super(message);
    this.name = 'LayerConversionError';
  }
}

export function throwUnsupportedLayerFeature(message: string): never {
  throw new LayerConversionError(SVG2IR_WARNING_CODES.LAYERS_UNSUPPORTED_FEATURE, message);
}

export function throwInvalidLayerData(message: string): never {
  throw new LayerConversionError(SVG2IR_WARNING_CODES.LAYERS_INVALID_DATA, message);
}

export function collectLayerWarning(
  warnings: SVG2IRWarning[],
  options: ConvertOptions,
  code: SVG2IRWarningCode,
  message: string,
  selector?: string,
): void {
  const warning: SVG2IRWarning = {
    code, message: `[svg2ge:layers] ${message}`,
    ...(selector != null && { elementSelector: selector }),
  };

  warnings.push(warning);
  options.onWarning?.(warning);
  const advisory = code === SVG2IR_WARNING_CODES.LAYERS_TEXT_BOUNDS_ESTIMATED
    || code === SVG2IR_WARNING_CODES.LAYERS_GRAPHIC_BAKED;

  if (options.strict === true && !advisory) {
    throw new SVGConverterError(SVG_CONVERTER_ERROR_CODES.LAYERS_CONVERSION_FAILED, warning.message, {
      stage: 'layers', sourceId: selector, warningCode: code,
    });
  }
}

export function collectUnsupportedIRLayer(
  layer: IRLayer,
  selector: string,
  warnings: SVG2IRWarning[],
  options: ConvertOptions,
): void {
  collectLayerWarning(warnings, options, SVG2IR_WARNING_CODES.LAYERS_UNSUPPORTED_TYPE,
    `Unsupported content type: ${layer.type}.`, selector);
}
