import { IRPaintType, IRShapePrimitiveType } from '@galacean/animation-ir';
import type { IRBezierPath, IRColor, IRShape } from '@galacean/animation-ir';
import type { Shape, Text } from '@lottie-animation-community/lottie-types';
import type { LottieFont, LottieShapeElement, LottieVisualLayer } from '../common/conversion-types';
import { parseLottieTextDocument } from '../parser/parse-lottie-text-document';
import { toFiniteNumber } from '../parser/parse-lottie-property';
import { convertLottieShapes } from './convert-lottie-shapes';

function isFiniteColor(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(channel => typeof channel === 'number' && Number.isFinite(channel));
}

function collectOutlinePaths(items: LottieShapeElement[]): Shape.Path[] | undefined {
  const paths: Shape.Path[] = [];

  for (const item of items) {
    if (item.hd === true) {
      continue;
    }
    if (item.ty === 'gr') {
      const nested = collectOutlinePaths(item.it ?? []);

      if (nested == null) {
        return undefined;
      }
      paths.push(...nested);
    } else if (item.ty === 'sh' && item.ks.a !== 1) {
      paths.push(item);
    } else {
      return undefined;
    }
  }

  return paths;
}

/** Embedded glyph paths use 100-unit font coordinates, independent of the exported font size. */
export function convertLottieTextGlyphs(
  layer: LottieVisualLayer,
  fonts: LottieFont[],
  chars: Text.CharacterData[],
): IRShape[] | undefined {
  const document = parseLottieTextDocument(layer);
  const font = fonts.find(item => item.fName === document?.['f']);

  if (document == null || font == null || typeof document['t'] !== 'string' ||
    document['sz'] != null || document['ps'] != null || toFiniteNumber(document['sw'], 0) !== 0) {
    return undefined;
  }
  const color = document['fc'];

  if (!isFiniteColor(color)) {
    return undefined;
  }
  const fillColor: IRColor = [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, 1];
  const fontSize = toFiniteNumber(document['s'], 16);
  const scale = fontSize / 100;
  const tracking = toFiniteNumber(document['tr'], 0) * fontSize / 1000;
  const lineHeight = toFiniteNumber(document['lh'], fontSize);
  const baselineShift = toFiniteNumber(document['ls'], 0);
  const paths: IRBezierPath[] = [];
  const lines = document['t'].replace(/\r\n?/g, '\n').split('\n');

  for (const [lineIndex, line] of lines.entries()) {
    const glyphs = Array.from(line, character => chars.find(glyph =>
      glyph.ch === character && glyph.fFamily === font.fFamily && glyph.style === font.fStyle));

    if (glyphs.some(glyph => glyph == null)) {
      return undefined;
    }
    // Trailing spaces advance the pen but do not participate in Lottie's alignment width.
    const trimmedLength = Array.from(line.replace(/ +$/, '')).length;
    const width = glyphs.slice(0, trimmedLength).reduce((sum, glyph) => sum + (glyph?.w ?? 0) * scale + tracking, 0) -
      (trimmedLength > 0 ? tracking : 0);
    let x = document['j'] === 1 ? -width : document['j'] === 2 ? -width / 2 : 0;
    const y = lineIndex * lineHeight + (lineIndex > 0 ? 1 : 0) - baselineShift;

    for (const glyph of glyphs) {
      if (glyph == null) {
        return undefined;
      }
      if ('shapes' in glyph.data) {
        const outlinePaths = collectOutlinePaths(glyph.data.shapes);

        if (outlinePaths == null) {
          return undefined;
        }
        const converted = convertLottieShapes([
          { ty: 'gr', it: outlinePaths },
          { ty: 'fl', c: { a: 0, k: fillColor }, o: { a: 0, k: 100 }, r: 1 },
        ]);

        for (const shape of converted.shapes) {
          if (shape.primitiveType !== IRShapePrimitiveType.Custom) {
            return undefined;
          }
          for (const path of shape.customPaths) {
            paths.push({
              closed: path.closed,
              points: path.points.map(point => ({
                x: (point.x + shape.position[0]) * scale + x,
                y: (point.y + shape.position[1]) * scale + y,
              })),
              inTangents: path.inTangents.map(point => ({ x: point.x * scale, y: point.y * scale })),
              outTangents: path.outTangents.map(point => ({ x: point.x * scale, y: point.y * scale })),
            });
          }
        }
      } else if (glyph.ch.trim() !== '') {
        return undefined;
      }
      x += glyph.w * scale + tracking;
    }
  }

  return paths.length === 0 ? [] : [{
    primitiveType: IRShapePrimitiveType.Custom,
    customPaths: paths,
    position: [0, 0],
    fills: [{ type: IRPaintType.Solid, color: fillColor }],
    strokes: [],
  }];
}
