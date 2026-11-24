import { SVG2IR_WARNING_CODES, type ConvertOptions, type SVG2IRWarning } from '../../../common/types';
import { canRasterizeSVG, rasterizeSVG } from '../../../svg-rasterizer/rasterize-svg';
import { collectLayerWarning } from '../converter/diagnostics/collect-warnings';
import type { SVGImageLayer } from '../types';
import { normalizeLayerBlending } from './normalize-layer-blending';
import { planGraphicBaking, validateGraphicSnapshot } from './plan-graphic-baking';
import { collectBakedStylesheetPaths, collectNonRenderingDeclarationPaths } from './resolve-baking-warnings';

export interface BakedLayersResult {
  layers: Array<{ path: string; layer: SVGImageLayer }>;
  warnings: SVG2IRWarning[];
  replacesSource: (path: string | undefined) => boolean;
  resolvesWarning: (warning: SVG2IRWarning, path: string | undefined) => boolean;
}

/** Rasterize graphics and track the source layers and warnings they replace. */
export async function buildBakedLayers(
  source: string,
  size: [number, number],
  options: ConvertOptions,
  rasterScale: number,
): Promise<BakedLayersResult> {
  const deferredOptions = { ...options, strict: false, onWarning: undefined };
  const bakedPaths: string[] = [];
  const baked: BakedLayersResult['layers'] = [];
  const bakingWarnings: SVG2IRWarning[] = [];
  const blending = normalizeLayerBlending(source);
  const plan = planGraphicBaking(blending.source);

  for (const downgrade of blending.downgrades) {
    collectLayerWarning(bakingWarnings, deferredOptions, SVG2IR_WARNING_CODES.LAYERS_BLEND_MODE_DOWNGRADED,
      `mix-blend-mode "${downgrade.mode}" was downgraded to "normal"; the layer is retained.`, downgrade.selector);
  }

  for (const warning of plan.warnings) {
    collectLayerWarning(bakingWarnings, deferredOptions, SVG2IR_WARNING_CODES.LAYERS_UNSUPPORTED_FEATURE,
      warning.message, warning.selector);
  }
  for (const scope of plan.scopes) {
    try {
      if (!canRasterizeSVG()) { throw new Error('Graphic baking requires a browser with SVG and Canvas support.'); }
      const image = await rasterizeSVG(blending.source, scope.path, size, rasterScale, validateGraphicSnapshot);

      bakedPaths.push(scope.path);
      const message = image == null
        ? 'Graphic rasterization produced no visible pixels; no image layer was emitted.'
        : scope.isGroup
          ? 'Graphic group baked into a single PNG; child graphics and paint/effect parameters are no longer editable.'
          : 'Graphic baked into a PNG; vector geometry and paint/effect parameters are no longer editable.';

      collectLayerWarning(bakingWarnings, deferredOptions, SVG2IR_WARNING_CODES.LAYERS_GRAPHIC_BAKED,
        message, scope.selector);
      if (image == null) { continue; }
      const [left, top, right, bottom] = image.bbox;
      const width = right - left;
      const height = bottom - top;

      baked.push({ path: scope.path, layer: {
        id: '', type: 'image', role: 'content', bbox: image.bbox, size: [width, height], rotation: [0, 0, 0],
        url: image.url, width, height,
      } });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      collectLayerWarning(bakingWarnings, deferredOptions, SVG2IR_WARNING_CODES.LAYERS_UNSUPPORTED_FEATURE,
        `Graphic baking failed: ${reason}`, scope.selector);
    }
  }
  const replacesSource = (path: string | undefined): boolean => path != null
    && bakedPaths.some(scope => scope === '' || path === scope || path.startsWith(`${scope}/`));
  const handledStyles = collectBakedStylesheetPaths(blending.source, replacesSource);
  const declarations = collectNonRenderingDeclarationPaths(source);

  return {
    layers: baked, warnings: bakingWarnings, replacesSource,
    resolvesWarning: (warning, path) => replacesSource(path)
      || (warning.code === SVG2IR_WARNING_CODES.ELEMENT_DROPPED && path != null
        && (handledStyles.has(path) || declarations.has(path))),
  };
}
