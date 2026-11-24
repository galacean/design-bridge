/** SVG/CSS 颜色串 → IRColor [r,g,b,a] 0-1。 */
import type { IRColor } from '@galacean/animation-ir';
import { CSS_NAMED_COLORS } from './css-named-colors';

export function mapSVGColorToIRColor(c: string | null | undefined, opacity = 1): IRColor | null {
  if (c == null) { return null; }
  const raw = String(c).trim().toLowerCase();

  if (raw === '' || raw === 'none') { return null; }
  if (raw === 'transparent') { return [0, 0, 0, 0]; }
  const hex = parseHexColor(raw);

  if (hex != null) { return withOpacity(hex, opacity); }
  const rgb = parseRGBColor(raw);

  if (rgb != null) { return withOpacity(rgb, opacity); }
  const hsl = parseHSLColor(raw);

  if (hsl != null) { return withOpacity(hsl, opacity); }
  const named = CSS_NAMED_COLORS.get(raw);

  if (named != null) {
    return [named[0] / 255, named[1] / 255, named[2] / 255, clamp01(opacity)];
  }

  return [0, 0, 0, clamp01(opacity)];
}

function parseHexColor(raw: string): IRColor | null {
  const match = raw.match(/^#([0-9a-f]{3,8})$/);

  if (match == null || ![3, 4, 6, 8].includes(match[1].length)) { return null; }
  const hex = match[1];
  const expanded = hex.length <= 4
    ? Array.from(hex).map(char => `${char}${char}`).join('')
    : hex;
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const a = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  return [r, g, b, a];
}

function parseRGBColor(raw: string): IRColor | null {
  const match = raw.match(/^rgba?\((.*)\)$/);

  if (match == null) { return null; }
  const { components, alpha } = splitFunctionalColor(match[1]);

  if (components.length !== 3) { return null; }
  const values = components.map(parseRGBComponent);

  if (values.some(value => value == null)) { return null; }
  const parsedAlpha = parseAlpha(alpha);

  if (parsedAlpha == null) { return null; }

  return [values[0]!, values[1]!, values[2]!, parsedAlpha];
}

function parseHSLColor(raw: string): IRColor | null {
  const match = raw.match(/^hsla?\((.*)\)$/);

  if (match == null) { return null; }
  const { components, alpha } = splitFunctionalColor(match[1]);

  if (components.length !== 3) { return null; }
  const hue = parseHue(components[0]);
  const saturation = parsePercentage(components[1]);
  const lightness = parsePercentage(components[2]);
  const parsedAlpha = parseAlpha(alpha);

  if (hue == null || saturation == null || lightness == null || parsedAlpha == null) { return null; }
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSector = hue / 60;
  const intermediate = chroma * (1 - Math.abs(hueSector % 2 - 1));
  let r = 0;
  let g = 0;
  let b = 0;

  if (hueSector < 1) { r = chroma; g = intermediate; } else if (hueSector < 2) { r = intermediate; g = chroma; } else if (hueSector < 3) { g = chroma; b = intermediate; } else if (hueSector < 4) { g = intermediate; b = chroma; } else if (hueSector < 5) { r = intermediate; b = chroma; } else { r = chroma; b = intermediate; }
  const offset = lightness - chroma / 2;

  return [r + offset, g + offset, b + offset, parsedAlpha];
}

function splitFunctionalColor(body: string): { components: string[]; alpha?: string } {
  const slashParts = body.trim().split('/');
  const colorPart = slashParts[0].trim();
  let alpha = slashParts[1]?.trim();
  let components = colorPart.includes(',')
    ? colorPart.split(',').map(part => part.trim())
    : colorPart.split(/\s+/).filter(Boolean);

  if (colorPart.includes(',') && components.length === 4 && alpha == null) {
    alpha = components[3];
    components = components.slice(0, 3);
  }

  return { components, alpha };
}

function parseRGBComponent(value: string): number | null {
  if (value.endsWith('%')) {
    const percentage = Number(value.slice(0, -1));

    return Number.isFinite(percentage) ? clamp01(percentage / 100) : null;
  }
  const component = Number(value);

  return Number.isFinite(component) ? clamp01(component / 255) : null;
}

function parseAlpha(value: string | undefined): number | null {
  if (value == null || value === '') { return 1; }
  if (value.endsWith('%')) {
    const percentage = Number(value.slice(0, -1));

    return Number.isFinite(percentage) ? clamp01(percentage / 100) : null;
  }
  const alpha = Number(value);

  return Number.isFinite(alpha) ? clamp01(alpha) : null;
}

function parseHue(value: string): number | null {
  const match = value.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))(deg|grad|rad|turn)?$/);

  if (match == null) { return null; }
  const raw = Number(match[1]);

  if (!Number.isFinite(raw)) { return null; }
  const degrees = match[2] === 'turn' ? raw * 360
    : match[2] === 'rad' ? raw * 180 / Math.PI
      : match[2] === 'grad' ? raw * 0.9
        : raw;

  return (degrees % 360 + 360) % 360;
}

function parsePercentage(value: string): number | null {
  const match = value.trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))%$/);

  if (match == null) { return null; }
  const percentage = Number(match[1]);

  return Number.isFinite(percentage) ? clamp01(percentage / 100) : null;
}

function withOpacity(color: IRColor, opacity: number): IRColor {
  return [color[0], color[1], color[2], clamp01(color[3] * opacity)];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
