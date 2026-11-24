import type { IRLayer, IRTextContent } from '@galacean/animation-ir';

export function estimateTextBounds(text: IRTextContent): { width: number; height: number } {
  const width = text.text.length * text.fontSize * 0.6 +
    text.letterSpacing * Math.max(text.text.length - 1, 0);

  return { width: Math.max(width, 1), height: Math.max(text.fontSize * 1.2, 1) };
}

/** Alignment point and first baseline relative to the top-left text layout box. */
export function getTextLayoutOrigin(text: IRTextContent, width: number): [number, number] {
  const alignment = text.textAlign === 'center' ? 0.5 : text.textAlign === 'right' ? 1 : 0;

  // Top-aligned text uses one third of the leading above the first baseline.
  return [alignment * width, text.fontSize + (text.lineHeight - text.fontSize) / 3];
}

export function getIRTextOrigin(layer: IRLayer): [number, number] {
  if (layer.type !== 'text') {
    return [0, 0];
  }
  const bounds = layer.localBounds;
  const [originX, originY] = getTextLayoutOrigin(layer.content, bounds?.width ?? estimateTextBounds(layer.content).width);

  return [(bounds?.x ?? 0) + originX, (bounds?.y ?? 0) + originY];
}
