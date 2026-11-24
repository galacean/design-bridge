import type { IRAsset, IRComposition, IRLayer, IRScene } from '@galacean/animation-ir';
import { getIRSceneEntryComposition } from '@galacean/animation-ir/adapter';
import type { ConvertOptions, SVG2IRWarning } from '../../../../common/types';
import type { SVGPreservedData } from '../../../../svg-preserved-data';
import { buildIRStaticStateResolver, type StaticLayerState } from '../transform/build-transform';

export interface LayerConversionSession {
  readonly composition: IRComposition;
  readonly assets: ReadonlyMap<string, IRAsset>;
  readonly maskSourceIds: ReadonlySet<string>;
  readonly preservedData: SVGPreservedData | undefined;
  readonly resolveLayerState: (layer: IRLayer) => StaticLayerState;
  readonly options: ConvertOptions;
  readonly warnings: SVG2IRWarning[];
}

export function buildLayerConversionSession(
  scene: IRScene,
  options: ConvertOptions,
  warnings: SVG2IRWarning[],
  preservedData?: SVGPreservedData,
): LayerConversionSession {
  const composition = getIRSceneEntryComposition(scene);
  const layers = new Map(composition.layers.map(layer => [layer.id, layer]));
  const maskSourceIds = new Set(composition.layers.flatMap(layer =>
    layer.matte == null ? [] : [layer.matte.sourceLayerId],
  ));

  return {
    composition, assets: new Map(scene.assets.map(asset => [asset.id, asset])), maskSourceIds,
    preservedData, resolveLayerState: buildIRStaticStateResolver(layers, composition.inPoint), options, warnings,
  };
}
