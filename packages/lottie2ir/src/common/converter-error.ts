/** Stable error codes for public control flow. */
export const LOTTIE_CONVERTER_ERROR_CODES = {
  INVALID_LOTTIE_JSON: 'INVALID_LOTTIE_JSON',
  ZIP_PARSE_FAILED: 'ZIP_PARSE_FAILED',
  ZIP_JSON_NOT_FOUND: 'ZIP_JSON_NOT_FOUND',
  IR_VALIDATION_FAILED: 'IR_VALIDATION_FAILED',
  CONVERT_PIPELINE_FAILED: 'CONVERT_PIPELINE_FAILED',
} as const;

/** Stable failure category exposed by LottieConverterError.code for caller error handling. */
export type LottieConverterErrorCode = (typeof LOTTIE_CONVERTER_ERROR_CODES)[keyof typeof LOTTIE_CONVERTER_ERROR_CODES];

/** Error raised by Lottie parsing, conversion, and ZIP input handling. */
export class LottieConverterError extends Error {
  readonly code: LottieConverterErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: LottieConverterErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'LottieConverterError';
    this.code = code;
    this.details = details;
  }
}

function extractInternalCode(error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

/** Normalizes an unknown failure under the caller-selected public error code. */
export function normalizeToConverterError(
  error: unknown,
  fallbackCode: LottieConverterErrorCode,
  fallbackMessage: string,
  details?: Record<string, unknown>,
): LottieConverterError {
  if (error instanceof LottieConverterError) {
    if (details == null || Object.keys(details).length === 0) {
      return error;
    }

    return new LottieConverterError(error.code, error.message, {
      ...(error.details ?? {}),
      ...details,
    });
  }

  const internalCode = extractInternalCode(error);
  const message = error instanceof Error && error.message !== '' ? error.message : fallbackMessage;

  const normalizedDetails: Record<string, unknown> = {
    ...(details ?? {}),
    ...(internalCode != null ? { internalErrorCode: internalCode } : {}),
    ...(error instanceof Error ? { cause: error.message } : { cause: String(error) }),
  };

  return new LottieConverterError(fallbackCode, message, normalizedDetails);
}
