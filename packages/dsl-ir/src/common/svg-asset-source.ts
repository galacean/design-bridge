import type { IRResourceSource } from '@galacean/animation-ir';
import { createIRResourceSource } from '@galacean/animation-ir/adapter';

export function readSVGAssetUrl(value: unknown): IRResourceSource | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return createIRResourceSource(value.trim());
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }

    return undefined;
  }
}

export function encodeInlineSVGUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`;
  } catch (error) {
    if (!(error instanceof URIError)) {
      throw error;
    }

    return undefined;
  }
}
