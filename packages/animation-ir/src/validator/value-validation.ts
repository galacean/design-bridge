import type { IRValidationErrorCode } from './contract.js';
import type { ValidationContext } from './context.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept strings containing non-whitespace characters; preserve surrounding whitespace for exact identity matching. */
export function isIRId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isNumberTuple(value: unknown, length: number): value is number[] {
  if (!Array.isArray(value) || value.length !== length) {
    return false;
  }
  for (const element of value) {
    if (!isFiniteNumber(element)) {
      return false;
    }
  }

  return true;
}

export function isNormalizedNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

export function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

export function isNormalizedColor(value: unknown): value is number[] {
  return isNumberTuple(value, 4) && value.every(isNormalizedNumber);
}

export function isOneOfConst<T extends Record<string, string>>(value: unknown, constants: T): boolean {
  return typeof value === 'string' && Object.values(constants).includes(value);
}

export function validateOptionalFiniteNumber(
  ctx: ValidationContext,
  value: unknown,
  code: IRValidationErrorCode,
  path: string,
  options: { min?: number; max?: number } = {},
  layerId?: string,
): void {
  if (value === undefined) {
    return;
  }

  if (
    !isFiniteNumber(value) ||
    (options.min != null && value < options.min) ||
    (options.max != null && value > options.max)
  ) {
    ctx.error(code, path, 'must be a finite number in the supported range', layerId);
  }
}
export function validateOptionalPositiveFiniteNumber(
  ctx: ValidationContext,
  value: unknown,
  code: IRValidationErrorCode,
  path: string,
  layerId?: string,
): void {
  if (value !== undefined && !isPositiveFiniteNumber(value)) {
    ctx.error(code, path, 'must be a finite number greater than 0', layerId);
  }
}

export function validateColor(
  ctx: ValidationContext,
  value: unknown,
  code: IRValidationErrorCode,
  path: string,
  layerId?: string,
): void {
  if (!isNormalizedColor(value)) {
    ctx.error(code, path, 'must be an RGBA tuple with every channel in the 0..1 range', layerId);
  }
}
