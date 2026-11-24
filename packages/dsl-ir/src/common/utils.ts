import type { IRColor } from '@galacean/animation-ir';
import { v4 } from 'uuid';

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const EPSILON = 1e-6;

export type HexColorInput = readonly [number, number, number] | readonly [number, number, number, number] | IRColor;

/** Generate a 32-character hexadecimal UUID v4. */
export function createId(): string {
  return v4().replaceAll('-', '');
}

/** Convert normalized RGB(A) channels to a canonical hex color. */
export function colorToHex(color: HexColorInput): string {
  const colorChannels: [number, number, number, number] = [
    color[0] ?? 0,
    color[1] ?? 0,
    color[2] ?? 0,
    color.length >= 4 ? (color[3] ?? 1) : 1,
  ];
  const hexParts = colorChannels.map(channel => {
    const byteValue = Math.max(0, Math.min(255, Math.round(channel * 255)));

    return byteValue.toString(16).padStart(2, '0');
  });

  return hexParts[3] === 'ff' ? `#${hexParts.slice(0, 3).join('')}` : `#${hexParts.join('')}`;
}

/** Normalize supported hex forms for semantic comparison. */
export function normalizeHex(hexColor: string): string {
  const normalizedHex = hexColor.replace(/^#/, '').toLowerCase();

  if (normalizedHex.length === 3) {
    const [red, green, blue] = [
      normalizedHex[0] + normalizedHex[0],
      normalizedHex[1] + normalizedHex[1],
      normalizedHex[2] + normalizedHex[2],
    ];

    return `#${red}${green}${blue}`;
  }

  if (normalizedHex.length === 6) {
    return `#${normalizedHex}`;
  }

  if (normalizedHex.length === 8) {
    const alpha = normalizedHex.slice(6, 8);

    return alpha === 'ff' ? `#${normalizedHex.slice(0, 6)}` : `#${normalizedHex}`;
  }

  return hexColor.toLowerCase();
}

/** Compare nullable hex colors after normalization. */
export function isHexEqual(leftHex: string | null | undefined, rightHex: string | null | undefined): boolean {
  if (leftHex == null && rightHex == null) {
    return true;
  }
  if (leftHex == null || rightHex == null) {
    return false;
  }

  return normalizeHex(leftHex) === normalizeHex(rightHex);
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function isAbsoluteResourceUrl(value: string): boolean {
  try {
    new URL(value);

    return true;
  } catch {
    return false;
  }
}

export function hexToIRColor(hexColor: string): IRColor {
  const hex = hexColor.replace(/^#/, '');

  if (hex.length === 3) {
    return [
      parseHexByte(`${hex[0]}${hex[0]}`, hexColor) / 255,
      parseHexByte(`${hex[1]}${hex[1]}`, hexColor) / 255,
      parseHexByte(`${hex[2]}${hex[2]}`, hexColor) / 255,
      1,
    ];
  }

  if (hex.length === 6 || hex.length === 8) {
    return [
      parseHexByte(hex.slice(0, 2), hexColor) / 255,
      parseHexByte(hex.slice(2, 4), hexColor) / 255,
      parseHexByte(hex.slice(4, 6), hexColor) / 255,
      hex.length === 8 ? parseHexByte(hex.slice(6, 8), hexColor) / 255 : 1,
    ];
  }

  throw new Error(`[dsl-ir:color] Invalid hex color: ${hexColor}`);
}

export function resolveFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function secondsToFrames(seconds: number, frameRate: number): number {
  return resolveFiniteNumber(seconds, 0) * frameRate;
}

export function isScalarEqual(leftValue: number, rightValue: number): boolean {
  return Math.abs(leftValue - rightValue) <= EPSILON;
}

export function isNumberArrayEqual(leftValues: readonly number[], rightValues: readonly number[]): boolean {
  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => Math.abs(value - rightValues[index]) <= EPSILON);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function toJSONPath(path: string): string {
  if (path === '') {
    return '$';
  }

  return path.startsWith('$') ? path : `$.${path}`;
}

function parseHexByte(value: string, source: string): number {
  if (!/^[\da-fA-F]{2}$/.test(value)) {
    throw new Error(`[dsl-ir:color] Invalid hex color: ${source}`);
  }

  return parseInt(value, 16);
}
