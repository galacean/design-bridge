import type { IRAnimatedProperty, IRComposition, IRPrecompLayer, IRScene } from '@galacean/animation-ir';
import { getIRSceneEntryComposition, type ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { createId } from '../../common/id';
import {
  hasAnimatedOpacity, isDefaultOpacity, mapOpacityToReferencedComposition, multiplyOpacityProperties,
} from './opacity';

interface CompositionGenerationRequest {
  id: string;
  ir: IRComposition;
  inheritedOpacity?: IRAnimatedProperty<number>;
  precompOutputIdByLayerId: Map<string, string>;
}

interface CompositionGenerationPlan {
  compositionById: ReadonlyMap<string, IRComposition>;
  requests: CompositionGenerationRequest[];
}

/** Plan only Compositions and instance-specific variants reachable from the playback entry. */
export function buildCompositionGenerationPlan(
  irScene: IRScene,
  diagnostics: ConversionDiagnostic[],
): CompositionGenerationPlan {
  const compositionById = new Map(irScene.compositions.map(composition => [composition.id, composition] as const));
  const entry = getIRSceneEntryComposition(irScene);
  const requests: CompositionGenerationRequest[] = [{
    id: entry.id,
    ir: entry,
    precompOutputIdByLayerId: new Map(),
  }];
  const requestById = new Map(requests.map(request => [request.id, request] as const));

  for (let requestIndex = 0; requestIndex < requests.length; requestIndex++) {
    const request = requests[requestIndex];

    for (const layer of request.ir.layers) {
      if (layer.type !== 'precomp') {
        continue;
      }
      const referenced = compositionById.get(layer.content.compositionId);

      if (referenced == null) {
        continue;
      }
      const instanceOpacity = multiplyOpacityProperties(
        request.inheritedOpacity,
        layer.transform?.opacity,
        layer.time.inFrame,
        layer.time.outFrame,
      );
      const referencedOpacity = mapOpacityToReferencedComposition(instanceOpacity, layer, request.ir, referenced);
      const requiresVariant = (layer.masks?.length ?? 0) > 0 ||
        layer.content.clipToBounds ||
        !isDefaultOpacity(referencedOpacity);

      const outputId = requiresVariant ? createId() : referenced.id;

      if (requiresVariant) {
        request.precompOutputIdByLayerId.set(layer.id, outputId);
      }
      if (!requestById.has(outputId)) {
        const variant: CompositionGenerationRequest = {
          id: outputId,
          ir: referenced,
          inheritedOpacity: referencedOpacity,
          precompOutputIdByLayerId: new Map(),
        };

        requests.push(variant);
        requestById.set(outputId, variant);
      }
      collectOpacityApproximationDiagnostic(request, layer, referenced, referencedOpacity, diagnostics);
    }
  }

  return { compositionById, requests };
}

function collectOpacityApproximationDiagnostic(
  request: CompositionGenerationRequest,
  layer: IRPrecompLayer,
  referenced: IRComposition,
  referencedOpacity: IRAnimatedProperty<number> | undefined,
  diagnostics: ConversionDiagnostic[],
): void {
  const hasAnimatedChildOpacity = referenced.layers.some(child =>
    child.type !== 'null' && child.type !== 'precomp' && hasAnimatedOpacity(child.transform?.opacity),
  );

  if (!hasAnimatedOpacity(referencedOpacity) || !hasAnimatedChildOpacity) {
    return;
  }
  diagnostics.push({
    code: 'GE_PRECOMP_OPACITY_APPROXIMATED',
    severity: 'warning',
    action: 'approximated',
    path: `$.compositions[id=${JSON.stringify(request.ir.id)}].layers[id=${JSON.stringify(layer.id)}].transform.opacity`,
    sourceId: layer.id,
    feature: 'precomp-opacity',
    message: 'Animated Precomp and child opacity curves were multiplied at their keyframe boundaries.',
  });
}

/** Report GE runtime limitations that apply to a source Precomp instance. */
export function collectPrecompExportDiagnostics(
  layer: IRPrecompLayer,
  compositionById: ReadonlyMap<string, IRComposition>,
  composition: IRComposition,
  diagnostics: ConversionDiagnostic[],
): void {
  const path = `$.compositions[id=${JSON.stringify(composition.id)}].layers[id=${JSON.stringify(layer.id)}]`;

  const expectedSourceStartFrame = compositionById.get(layer.content.compositionId)?.inPoint ?? 0;

  if (layer.time.sourceStartFrame != null && layer.time.sourceStartFrame < expectedSourceStartFrame) {
    diagnostics.push({
      code: 'GE_PRECOMP_SOURCE_START_UNSUPPORTED',
      severity: 'warning',
      action: 'approximated',
      path: `${path}.time.sourceStartFrame`,
      sourceId: layer.id,
      feature: 'precomp-source-start',
      message: 'GE 2.x cannot evaluate a nested Composition before its inPoint; the earliest source frame is used.',
    });
  }
  if (layer.time.stretch != null && layer.time.stretch !== 1) {
    diagnostics.push({
      code: 'GE_PRECOMP_STRETCH_UNSUPPORTED',
      severity: 'warning',
      action: 'approximated',
      path: `${path}.time.stretch`,
      sourceId: layer.id,
      feature: 'precomp-stretch',
      message: 'GE 2.x has no instance-local Precomp playback-rate field; stretch is emitted as 1.',
    });
  }
}
