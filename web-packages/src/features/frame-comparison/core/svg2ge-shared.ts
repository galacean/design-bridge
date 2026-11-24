/** Shared SVG preprocessing and text measurement for conversion and comparison. */
import { convertSVGToGE, splitSVG, inferNumericWeightFromFamily, type SplitSVGOptions } from '@galacean/svg2ir';
import { inlineSvgImages } from '../../../utils/svg-inline-images';

export function convertSVGToEffects(source: string, options?: SplitSVGOptions) {
  const result = splitSVG(source, options);
  const geResult = convertSVGToGE(result, options);

  return { data: geResult.data, ir: result.ir, warnings: geResult.warnings };
}

export type GETextWeight = 'normal' | 'bold' | 'lighter';

export function inferWeightFromFontFamily(family: string): GETextWeight | undefined {
  const n = inferNumericWeightFromFamily(family);

  if (n == null) { return undefined; }
  if (n < 400) { return 'lighter'; }
  if (n < 500) { return 'normal'; }

  return 'bold';
}

/** Use sans-serif while retaining explicit or inferred font weight. */
export function normalizeSvgFontForComparison(svgString: string): string {
  return svgString.replace(
    /<(text|tspan)\b([^>]*)font-family=(["'])(.*?)\3([^>]*)>/gi,
    (_match, tag, before, _q, family, after) => {
      const weight = inferWeightFromFontFamily(family);
      const hasWeight = /\bfont-weight\s*=/i.test(String(before)) || /\bfont-weight\s*=/i.test(String(after));
      const weightAttr = weight != null && !hasWeight ? ` font-weight="${weight}"` : '';

      return `<${tag}${before}font-family="sans-serif"${weightAttr}${after}>`;
    },
  );
}

let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

export function getMeasureText(): (fontDesc: string, text: string) => {
  width: number;
  fontBoundingBoxAscent?: number;
  fontBoundingBoxDescent?: number;
  actualBoundingBoxAscent?: number;
  hangingBaseline?: number;
} {
  if (sharedMeasureCtx == null && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');

    sharedMeasureCtx = canvas.getContext('2d');
  }

  return (fontDesc: string, text: string) => {
    if (sharedMeasureCtx != null) {
      sharedMeasureCtx.font = fontDesc;

      // Measure against the same alphabetic baseline used by GE.
      sharedMeasureCtx.textBaseline = 'alphabetic';
      const m = sharedMeasureCtx.measureText(text);

      return {
        width: m.width,
        fontBoundingBoxAscent: m.fontBoundingBoxAscent,
        fontBoundingBoxDescent: m.fontBoundingBoxDescent,
        actualBoundingBoxAscent: m.actualBoundingBoxAscent,
        hangingBaseline: m.hangingBaseline,
      };
    }

    return { width: 0 };
  };
}

export async function prepareSvgForConvert(svgString: string, resourceBaseUrl?: string): Promise<string> {
  const normalized = normalizeSvgFontForComparison(svgString);

  return inlineSvgImages(normalized, 10000, resourceBaseUrl);
}
