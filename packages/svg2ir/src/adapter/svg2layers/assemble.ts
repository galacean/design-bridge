import type { IRScene } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import { SVG2IR_WARNING_CODES, type ConvertOptions, type SVG2IRWarning } from '../../common/types';
import type { SVGPreservedData } from '../../svg-preserved-data';
import type { SVGConversionContext } from '../../svg2ir/convert';
import { collectLayerWarning } from './converter/diagnostics/collect-warnings';
import { buildLayerConversionSession } from './converter/layers/conversion-session';
import { buildIRStaticLayers } from './converter/layers/build-layers';
import type { BakedLayersResult } from './baking/build-baked-layers';
import type { SVGStaticLayer, SVGToLayersResult } from './types';

export function assembleSVGStaticLayers(
  scene: IRScene,
  options: ConvertOptions,
  warnings: SVG2IRWarning[],
  preservedData?: SVGPreservedData,
  sourceIds?: Map<SVGStaticLayer, string>,
): { size: [number, number]; data: SVGStaticLayer[] } {
  const session = buildLayerConversionSession(scene, options, warnings, preservedData);
  const data = buildIRStaticLayers(session, sourceIds);
  const composition = session.composition;

  if (composition.backgroundColor != null) {
    collectLayerWarning(warnings, options, SVG2IR_WARNING_CODES.LAYERS_UNSUPPORTED_TYPE,
      'Composition background color is not an image or text layer.');
  }

  return { size: [composition.width, composition.height], data };
}

export interface SVGStaticLayerConversionContext extends SVGConversionContext {
  source: string;
  layerSources: ReadonlyMap<string, string>;
  warningSources: ReadonlyMap<SVG2IRWarning, string>;
}

interface SVGLayerAssemblyInput {
  context: SVGStaticLayerConversionContext;
  options: ConvertOptions;
  baking: BakedLayersResult;
}

/** Replace baked sources, combine native and raster layers in painter order, then report final diagnostics. */
export function assembleSVGLayers(input: SVGLayerAssemblyInput): SVGToLayersResult {
  const { ir: scene, warnings: contextWarnings, preservedData, layerSources, warningSources } = input.context;
  const { options, baking } = input;
  const warnings = contextWarnings.filter(warning => !baking.resolvesWarning(warning, warningSources.get(warning)));
  const composition = getIRSceneEntryComposition(scene);
  const nativeScene: IRScene = {
    ...scene,
    compositions: scene.compositions.map(candidate => candidate === composition ? {
      ...candidate,
      layers: candidate.layers.filter(layer => !baking.replacesSource(layerSources.get(layer.id))),
    } : candidate),
  };
  const sourceIds = new Map<SVGStaticLayer, string>();

  warnings.push(...baking.warnings);
  const native = assembleSVGStaticLayers(nativeScene, { ...options, strict: false, onWarning: undefined },
    warnings, preservedData, sourceIds);
  const ordered = native.data.map(layer => ({ path: layerSources.get(sourceIds.get(layer) ?? '') ?? '', layer }));

  ordered.push(...baking.layers);
  ordered.sort((left, right) => comparePaths(left.path, right.path));
  const counts = { image: 0, text: 0 };
  const data = ordered.map(({ layer }) => ({
    ...layer, id: `${layer.type}_${String(++counts[layer.type]).padStart(4, '0')}`,
  }));

  for (const warning of warnings) {
    options.onWarning?.(warning);
    if (options.strict === true) {
      const message = warning.message.replace(/^\[svg2ge:layers\] /, '');

      collectLayerWarning([], { ...options, onWarning: undefined }, warning.code, message, warning.elementSelector);
    }
  }

  return { size: native.size, data, warnings };
}

function comparePaths(left: string, right: string): number {
  const a = left.split('/').map(Number);
  const b = right.split('/').map(Number);

  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) { return a[index] - b[index]; }
  }

  return a.length - b.length;
}
