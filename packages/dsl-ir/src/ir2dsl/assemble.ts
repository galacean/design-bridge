import { IREndBehavior, type IRComposition, type IRScene, type IRLayer } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import type { Layer } from '../dsl/schema';
import { colorToHex } from '../common/utils';
import type { IRToDSLLayerMapping, IRToDSLResult } from './types';

export function assembleDSLResult(
  baselineScene: IRScene,
  baselineComposition: IRComposition,
  dslLayerByIRId: Map<string, Layer>,
  layerMapping: IRToDSLLayerMapping,
  diagnostics: ConversionDiagnostic[],
): IRToDSLResult {
  const layers = assembleDSLHierarchy(baselineComposition.layers, dslLayerByIRId);
  const frameRate = baselineComposition.frameRate;

  return {
    dsl: {
      meta: {
        name: baselineComposition.name ?? baselineComposition.id,
        duration: Math.max(0, (baselineComposition.outPoint - baselineComposition.inPoint) / frameRate),
        fps: frameRate,
        width: baselineComposition.width,
        height: baselineComposition.height,
        loop: baselineComposition.endBehavior === IREndBehavior.Loop,
        background_color: baselineComposition.backgroundColor != null ? colorToHex(baselineComposition.backgroundColor) : null,
      },
      layers,
    },
    preservedData: {
      baselineScene,
      layerMapping,
    },
    diagnostics,
  };
}

function assembleDSLHierarchy(sourceLayers: IRLayer[], dslLayerByIRId: Map<string, Layer>): Layer[] {
  const rootLayers: Layer[] = [];

  // IR is bottom-to-top while each DSL sibling array is top-to-bottom.
  for (const sourceLayer of sourceLayers) {
    const convertedLayer = dslLayerByIRId.get(sourceLayer.id);

    if (convertedLayer == null) {
      continue;
    }

    const parentLayerId = sourceLayer.parentId;
    const parentLayer = parentLayerId != null ? dslLayerByIRId.get(parentLayerId) : undefined;

    if (parentLayer != null) {
      parentLayer.children ??= [];
      parentLayer.children.unshift(convertedLayer);
    } else {
      rootLayers.unshift(convertedLayer);
    }
  }

  return rootLayers;
}
