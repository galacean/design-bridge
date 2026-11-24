/**
 * svg2ir 内部转换错误码常量。
 *
 * 内部转换阶段使用这些常量区分失败阶段,避免依赖 message 文本。
 *
 * 转换器遇到不可继续的错误(解析失败/IR 校验失败/生成失败)抛内部转换错误；
 * 可丢降级的特性走 warnings,不抛错。
 */

/** svg2ir 内部转换错误码,裸字符串(不带包名前缀)。 */
export const SVG_CONVERTER_ERROR_CODES = {
  /** SVG 串/资源无法解析为合法 SVG DOM。 */
  INVALID_SVG: 'INVALID_SVG',
  LAYERS_CONVERSION_FAILED: 'LAYERS_CONVERSION_FAILED',
  /** SVG 解析底座(reader/reader)初始化失败。 */
  PARSE_FAIL: 'PARSE_FAIL',
  /** IR 结构校验失败(animation-ir 内部 IR_xxx 映射到该码)。 */
  IR_VALIDATION_FAILED: 'IR_VALIDATION_FAILED',
} as const;

export type SVGConverterErrorCode =
  (typeof SVG_CONVERTER_ERROR_CODES)[keyof typeof SVG_CONVERTER_ERROR_CODES];

const SVG_CONVERTER_ERROR_BRAND = Symbol.for('@galacean/svg2ir/SVGConverterError');

/**
 * 判断输入值是否为 {@link SVGConverterErrorCode}。
 */
export function isSVGConverterErrorCode (code: unknown): code is SVGConverterErrorCode {
  if (typeof code !== 'string') {
    return false;
  }

  return Object.values(SVG_CONVERTER_ERROR_CODES).includes(code as SVGConverterErrorCode);
}

function isSVGConverterErrorLike (value: unknown): boolean {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<symbol, unknown> & { code?: unknown; name?: unknown };

  return candidate[SVG_CONVERTER_ERROR_BRAND] === true ||
    (candidate.name === 'SVGConverterError' && isSVGConverterErrorCode(candidate.code));
}

/** svg2ir 内部统一错误类型。 */
export class SVGConverterError extends Error {
  readonly code: SVGConverterErrorCode;
  readonly details?: Record<string, unknown>;

  constructor (code: SVGConverterErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'SVGConverterError';
    this.code = code;
    this.details = details;
    Object.defineProperty(this, SVG_CONVERTER_ERROR_BRAND, {
      value: true,
    });
  }
}

Object.defineProperty(SVGConverterError, Symbol.hasInstance, {
  value: isSVGConverterErrorLike,
});

function extractInternalCode (error: unknown): string | undefined {
  if (error == null || typeof error !== 'object') {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;

  return typeof code === 'string' ? code : undefined;
}

function mapInternalCodeToConverterCode (internalCode: string): SVGConverterErrorCode | undefined {
  if (isSVGConverterErrorCode(internalCode)) {
    return internalCode;
  }

  if (internalCode.startsWith('IR_PROJECTION_')) {
    return SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED;
  }

  if (internalCode.startsWith('IR_')) {
    return SVG_CONVERTER_ERROR_CODES.IR_VALIDATION_FAILED;
  }

  return undefined;
}

function mapSemanticDetailsFromInternalCode (internalCode: string): Record<string, unknown> {
  if (internalCode.startsWith('IR_PROJECTION_')) {
    return { projectionErrorCode: internalCode };
  }

  if (internalCode.startsWith('IR_')) {
    return { validationCode: internalCode };
  }

  return {};
}

/**
 * 将任意异常标准化为 {@link SVGConverterError},并尽量保留内部错误码与上下文。
 */
export function normalizeToConverterError (
  error: unknown,
  fallbackCode: SVGConverterErrorCode,
  fallbackMessage: string,
  details?: Record<string, unknown>,
): SVGConverterError {
  if (error instanceof SVGConverterError) {
    if (details == null || Object.keys(details).length === 0) {
      return error;
    }

    return new SVGConverterError(
      error.code,
      error.message,
      {
        ...(error.details ?? {}),
        ...details,
      },
    );
  }

  const internalCode = extractInternalCode(error);
  const mappedCode = internalCode != null
    ? mapInternalCodeToConverterCode(internalCode) ?? fallbackCode
    : fallbackCode;
  const message = error instanceof Error && error.message !== ''
    ? error.message
    : fallbackMessage;

  const normalizedDetails: Record<string, unknown> = {
    ...(details ?? {}),
    ...(internalCode != null ? { internalErrorCode: internalCode } : {}),
    ...(internalCode != null ? mapSemanticDetailsFromInternalCode(internalCode) : {}),
    ...(error instanceof Error ? { cause: error.message } : { cause: String(error) }),
  };

  return new SVGConverterError(mappedCode, message, normalizedDetails);
}
