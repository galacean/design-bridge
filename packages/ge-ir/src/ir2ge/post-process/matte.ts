import { IRMatteMode, type IRComposition } from '@galacean/animation-ir';
import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';
import { isRecord } from '../../common/json-normalization';
import type { ECSCollector, GeneratedComponentData } from '../types';
import {
  appendRuntimeMaskReference, type RuntimeMaskSourceMeta, type RuntimeMaskState,
} from './mask';

/** Lower Layer-reference mattes to GE's component mask source/target relationship. */
export function applyLayerMattes(
  ir: IRComposition,
  collector: ECSCollector,
  layerToComponentId: Readonly<Record<string, string>>,
  runtimeMaskState: RuntimeMaskState,
  diagnostics: ConversionDiagnostic[],
): void {
  const componentById = new Map(collector.components.map(component => [component.id, component] as const));

  for (const layer of ir.layers) {
    const matte = layer.matte;

    if (matte == null) {
      continue;
    }
    if (matte.mode === IRMatteMode.Luminance) {
      diagnostics.push(createMatteDiagnostic(
        layer.id,
        'GE_MATTE_MODE_UNSUPPORTED',
        'luminance-matte',
        'GE does not expose a luminance matte mode; the Layer matte was not generated.',
      ));
      continue;
    }
    const targetComponent = resolveLayerComponent(layer.id, layerToComponentId, componentById);
    const sourceComponent = resolveLayerComponent(matte.sourceLayerId, layerToComponentId, componentById);

    if (targetComponent == null || sourceComponent == null) {
      diagnostics.push(createMatteDiagnostic(
        layer.id,
        'GE_MATTE_COMPONENT_UNSUPPORTED',
        'missing-render-component',
        'The Layer matte source and target must both lower to one GE render component.',
      ));
      continue;
    }
    if (isRecord(targetComponent['mask']) && targetComponent['mask']['isMask'] === true) {
      diagnostics.push(createMatteDiagnostic(
        layer.id,
        'GE_MASK_MATTE_CONFLICT',
        'target-mask-source-conflict',
        'The target component is already a GE mask source, so the Layer matte was skipped.',
      ));
      continue;
    }
    const alphaMaskEnabled = matte.mode === IRMatteMode.Alpha;
    const sourceMask = sourceComponent['mask'];

    if (!canClaimMatteSource(sourceMask, alphaMaskEnabled)) {
      diagnostics.push(createMatteDiagnostic(
        layer.id,
        'GE_MATTE_SOURCE_CONFLICT',
        'source-mask-slot-conflict',
        'The matte source component already owns an incompatible GE mask role.',
      ));
      continue;
    }

    sourceComponent['mask'] = { isMask: true, alphaMaskEnabled };
    const sourceMeta: RuntimeMaskSourceMeta = {
      inverted: matte.inverted === true,
    };

    runtimeMaskState.sources.set(sourceComponent.id, sourceMeta);
    appendRuntimeMaskReference(targetComponent, sourceComponent.id, sourceMeta, runtimeMaskState);
  }
}

function resolveLayerComponent(
  layerId: string,
  layerToComponentId: Readonly<Record<string, string>>,
  componentById: ReadonlyMap<string, GeneratedComponentData>,
): GeneratedComponentData | undefined {
  const componentId = layerToComponentId[layerId];

  return componentId == null ? undefined : componentById.get(componentId);
}

function canClaimMatteSource(value: unknown, alphaMaskEnabled: boolean): boolean {
  if (value == null) {
    return true;
  }

  return isRecord(value) &&
    value['isMask'] === true &&
    value['alphaMaskEnabled'] === alphaMaskEnabled;
}

function createMatteDiagnostic(
  sourceId: string,
  code: string,
  feature: string,
  message: string,
): ConversionDiagnostic {
  return {
    code,
    severity: 'warning',
    action: 'unsupported',
    path: `$.layers[id=${JSON.stringify(sourceId)}].matte`,
    sourceId,
    feature,
    message,
  };
}
