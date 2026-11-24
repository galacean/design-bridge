import type { LottieJSON } from '../common/conversion-types';
import { LottieConverterError, LOTTIE_CONVERTER_ERROR_CODES } from '../common/converter-error';

interface CompositionTimingInfo {
  frameRate: number;
  width: number;
  height: number;
  inPoint: number;
  outPoint: number;
  duration: number;
}

function readCompositionTimingInfo(json: LottieJSON): CompositionTimingInfo {
  const frameRate = Number(json['fr']);
  const width = Math.round(Number(json['w']));
  const height = Math.round(Number(json['h']));
  const inPoint = json['ip'];
  const outPoint = json['op'];
  const duration = (outPoint - inPoint) / frameRate;

  return { frameRate, width, height, inPoint, outPoint, duration };
}

/**
 * Parses serialized input and validates the required root composition fields.
 *
 * Validation is limited to the root composition timing and canvas fields.
 *
 * @throws `LottieConverterError` when the input is not an object with a valid `fr`, `w`, `h`, `ip`, and `op` range.
 */
export function parseLottieInput(input: string | LottieJSON): LottieJSON {
  let parsedInput: unknown;

  if (typeof input === 'string') {
    try {
      parsedInput = JSON.parse(input) as unknown;
    } catch (error) {
      throw new LottieConverterError(
        LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
        'The input is not a valid JSON string.',
        { cause: error instanceof Error ? error.message : String(error) },
      );
    }
  } else {
    parsedInput = input;
  }

  if (parsedInput == null || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
    throw new LottieConverterError(
      LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
      'The input is not a Lottie JSON object.',
    );
  }
  const json = parsedInput as LottieJSON;

  const timing = readCompositionTimingInfo(json);

  if (
    !Number.isFinite(timing.frameRate) ||
    timing.frameRate <= 0 ||
    !Number.isFinite(timing.width) ||
    timing.width <= 0 ||
    !Number.isFinite(timing.height) ||
    timing.height <= 0 ||
    !Number.isFinite(timing.inPoint) ||
    !Number.isFinite(timing.outPoint) ||
    timing.outPoint <= timing.inPoint ||
    !Number.isFinite(timing.duration)
  ) {
    throw new LottieConverterError(
      LOTTIE_CONVERTER_ERROR_CODES.INVALID_LOTTIE_JSON,
      'The required Lottie fields are invalid (fr, w, h, ip, or op).',
      {
        frameRate: timing.frameRate,
        width: timing.width,
        height: timing.height,
        ip: timing.inPoint,
        op: timing.outPoint,
        duration: timing.duration,
      },
    );
  }

  return json;
}
