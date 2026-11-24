import type { LottieLayer } from '../common/conversion-types';
import { asRecord } from './parse-lottie-property';

/** Returns the first Text Document keyframe used for static text conversion. */
export function parseLottieTextDocument(layer: LottieLayer): Record<string, unknown> | undefined {
  if (layer.ty !== 5 || layer.t == null) {
    return undefined;
  }
  const textData = asRecord(layer.t);
  const documentData = asRecord(textData?.['d']);
  const keyframes = documentData?.['k'];

  return Array.isArray(keyframes) ? asRecord(asRecord(keyframes[0])?.['s']) : undefined;
}
