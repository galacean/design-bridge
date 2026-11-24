import type { IRLocalBounds, IRTextLayer } from '@galacean/animation-ir';
import { SVG2IR_WARNING_CODES } from '../../../../common/types';
import { normalizeFontFamilyName } from '../../../../svg2ir/converter/text/font-metrics';
import {
  collectLayerWarning, throwInvalidLayerData, throwUnsupportedLayerFeature,
} from '../diagnostics/collect-warnings';
import { mapPointsToBBox, transformBoxCorners, type LayerPoint } from '../../matrix';
import { parseTextRuns } from './parse-text-runs';
import { buildTextRunLayout } from './text-layout';
import type { LayerConversionSession } from '../layers/conversion-session';
import type { StaticLayerState } from '../transform/build-transform';
import type { SVGTextFragment, SVGTextLayer } from '../../types';

function resolveTextBounds(layer: IRTextLayer): IRLocalBounds {
  if (layer.localBounds != null) { return layer.localBounds; }
  const content = layer.content;

  return {
    x: 0, y: 0,
    width: Math.max(content.text.length * content.fontSize * 0.6
      + Math.max(0, content.text.length - 1) * content.letterSpacing, 1),
    height: Math.max(content.lineHeight, content.fontSize * 1.2),
  };
}

export function convertIRTextLayer(
  layer: IRTextLayer,
  state: StaticLayerState,
  session: LayerConversionSession,
  id: string,
): SVGTextLayer | undefined {
  const { options, warnings } = session;
  const preserved = session.preservedData?.textDataByLayerId.get(layer.id);

  if (preserved?.isPathText === true) {
    throwUnsupportedLayerFeature('Text on a path cannot be expressed by flat text fragments.');
  }
  const matrix = state.matrix;
  const scaleX = Math.hypot(matrix.a, matrix.b);
  const scaleY = Math.hypot(matrix.c, matrix.d);

  if (matrix.a * matrix.d - matrix.b * matrix.c <= 0
    || Math.abs(scaleX - scaleY) > 1e-4
    || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 1e-4) {
    throwUnsupportedLayerFeature('Nonuniform text scaling, skew or reflection is not supported.');
  }
  const font = session.assets.get(layer.content.fontAssetId);

  if (font?.type !== 'font') { throwInvalidLayerData('Missing text font resource.'); }
  const runs = parseTextRuns(layer, font, preserved);

  if (runs.some(run => run.alpha < 1 - 1e-6)) {
    throwUnsupportedLayerFeature('Translucent text color cannot be expressed by RGB fragments.');
  }
  if (runs.some(run => run.bold || run.italic) || font.weight !== 400 || font.style !== 'normal') {
    collectLayerWarning(warnings, options, SVG2IR_WARNING_CODES.LAYERS_TEXT_STYLE_DROPPED,
      'Text weight/style is not consumed by the target fragment protocol.', id);
  }
  const bounds = resolveTextBounds(layer);
  const height = Math.max(bounds.height, layer.content.lineHeight);

  if (bounds.width <= 0 || height <= 0) { throwInvalidLayerData('Invalid text display size.'); }
  const positioned = buildTextRunLayout(runs, font.family, layer.content.letterSpacing, layer.content,
    [bounds.width, height], options, warnings, id, preserved != null, [scaleX, scaleY]);

  if (positioned.length === 0) { return undefined; }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const polygons = positioned.map(part => transformBoxCorners(matrix, [
    part.box[0] + centerX, part.box[1] + centerY, part.box[2] + centerX, part.box[3] + centerY,
  ]));
  const bbox = mapPointsToBBox(polygons.flat(), false);
  const rotation = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  const fragments: SVGTextFragment[] = positioned.map((part, index) => {
    const polygon: LayerPoint[] = polygons[index].map(point => [
      point[0] - bbox[0], point[1] - bbox[1],
    ]);

    return {
      content: part.run.text, bbox: mapPointsToBBox(polygon, false), polygon,
      font_family: normalizeFontFamilyName(font.family), font_size: part.run.fontSize * scaleY,
      color: part.run.color, letter_spacing: layer.content.letterSpacing * scaleX, direction: 'horizontal',
      rotation: rotation === 0 ? 0 : rotation,
    };
  });

  return {
    id, type: 'text', state: 'active', bbox,
    content: runs.map(run => run.text).join(''), fragments, erase_operations: [],
  };
}
