import type { IRColor, IRFontAsset, IRTextLayer } from '@galacean/animation-ir';
import type { SVGPreservedTextData, SVGPreservedTextSpan } from '../../../../svg-preserved-data';
import { mapSVGColorToIRColor } from '../../../../svg2ir/map-color';
import { throwInvalidLayerData } from '../diagnostics/collect-warnings';

export interface TextRun {
  text: string; fontSize: number; color: string; alpha: number;
  bold: boolean; italic: boolean;
}

export function parseTextRuns(layer: IRTextLayer, font: IRFontAsset, preserved?: SVGPreservedTextData): TextRun[] {
  const mapped = mapTextColor(layer.content.color);
  const base: TextRun = {
    text: layer.content.text, fontSize: layer.content.fontSize, color: mapped.hex, alpha: mapped.alpha,
    bold: font.weight === 700, italic: font.style === 'italic' || font.style === 'oblique',
  };

  if (preserved == null || preserved.spans.length === 0) { return [base]; }
  const defaultColor = `${mapped.hex.toLowerCase()}${Math.round(Math.max(0, Math.min(1, mapped.alpha)) * 255)
    .toString(16).padStart(2, '0')}`;
  const spans: SVGPreservedTextSpan[] = [];
  const styleKey = (span: SVGPreservedTextSpan): string =>
    `${span.fontSize ?? ''}|${span.color ?? defaultColor}|${span.bold === true}|${span.italic === true}`;

  for (const span of preserved.spans) {
    const previous = spans[spans.length - 1];

    if (previous != null && !span.newLine && styleKey(previous) === styleKey(span)) {
      previous.text += span.text;
    } else {
      spans.push({ ...span });
    }
  }

  return spans.filter(span => span.text !== '' || span.newLine).map(span => {
    const fontSize = span.fontSize == null || span.fontSize === '' ? base.fontSize : Number.parseFloat(span.fontSize);

    if (!Number.isFinite(fontSize) || fontSize <= 0) { throwInvalidLayerData('Invalid text fragment font size.'); }
    const color = span.color == null || span.color === '' ? layer.content.color : mapSVGColorToIRColor(span.color);

    if (color == null) { throwInvalidLayerData('Invalid text fragment color.'); }
    const resolved = mapTextColor(color);

    return {
      text: (span.newLine ? '\n' : '') + span.text, fontSize, color: resolved.hex, alpha: resolved.alpha,
      bold: span.bold === true || base.bold, italic: span.italic === true || base.italic,
    };
  });
}

function mapTextColor(color: IRColor): { hex: string; alpha: number } {
  const channels = color.slice(0, 3).map(channel =>
    Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, '0'),
  );

  return { hex: `#${channels.join('').toUpperCase()}`, alpha: color[3] };
}
