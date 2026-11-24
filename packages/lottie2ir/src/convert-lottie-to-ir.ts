import { resolveIRResourceUrl } from '@galacean/animation-ir/adapter';
import { assertIRScene } from '@galacean/animation-ir/validator';
import type { LottieJSON, LottieToIROptions, LottieToIRResult } from './common/conversion-types';
import { LOTTIE_CONVERTER_ERROR_CODES, normalizeToConverterError } from './common/converter-error';
import { assembleLottieIRScene } from './assemble-ir-scene';
import { parseLottieInput } from './parser/parse-lottie-input';

/**
 * Converts a Lottie JSON object or serialized JSON string to Animation IR.
 *
 * ZIP resources take precedence over URLs resolved through `resourceBaseUrl`. The generated Scene is validated before
 * it is returned. External images and fonts are not fetched; inspect diagnostics for reported fidelity limits.
 *
 * @throws `LottieConverterError` when parsing, conversion, or IR validation fails.
 */
export function convertLottieToIR(input: string | LottieJSON, options?: LottieToIROptions): LottieToIRResult {
  const json = parseLottieInput(input);

  const resolveResourceUrl = (resourceUrl: string): string => {
    if (options?.zipResources != null) {
      const resourcePath = [options.zipResources.dirPath, resourceUrl]
        .join('/')
        .replace(/[\\/]+/g, '/')
        .replace(/^\//, '');
      const embeddedUrl = options.zipResources.resources[resourcePath];

      if (embeddedUrl != null && embeddedUrl !== '') {
        return embeddedUrl;
      }
    }

    return resolveIRResourceUrl(resourceUrl, options?.resourceBaseUrl);
  };
  let assemblyResult: LottieToIRResult;

  try {
    assemblyResult = assembleLottieIRScene(json, {
      resolveResourceUrl,
    });
  } catch (error) {
    throw normalizeToConverterError(
      error,
      LOTTIE_CONVERTER_ERROR_CODES.CONVERT_PIPELINE_FAILED,
      'Failed to convert Lottie to Animation IR.',
      { stage: 'convert' },
    );
  }

  try {
    assertIRScene(assemblyResult.scene);
  } catch (error) {
    throw normalizeToConverterError(
      error,
      LOTTIE_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED,
      'Animation IR validation failed.',
      { stage: 'validate' },
    );
  }

  return assemblyResult;
}
