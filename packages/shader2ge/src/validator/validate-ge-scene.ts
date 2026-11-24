import * as spec from '@galacean/effects-specification';
import type { ShaderDiagnostic } from '../conversion-types';

export function validateGEScene(scene: spec.JSONScene): ShaderDiagnostic[] {
  const diagnostics: ShaderDiagnostic[] = [];
  const compositionIds = collectIds(scene.compositions);
  const itemIds = collectIds(scene.items);
  const componentIds = collectIds(scene.components);
  const materialIds = collectIds(scene.materials);
  const shaderIds = collectIds(scene.shaders);
  const geometryIds = collectIds(scene.geometries);
  const imageIds = collectIds(scene.images);
  const textureIds = collectIds(scene.textures ?? []);
  const miscIds = collectIds(scene.miscs);
  const componentTypes = collectDataTypes(scene.components);
  const miscTypes = collectDataTypes(scene.miscs);

  if (scene.compositionId !== undefined) {
    validateReference(scene.compositionId, compositionIds, '$.compositionId', diagnostics);
  }

  scene.compositions.forEach((composition, index) => {
    validateReferences(composition.components, componentIds, `$.compositions[${index}].components`, diagnostics);
    composition.components.forEach((reference, referenceIndex) => {
      validateReferenceType(
        reference.id,
        componentTypes,
        spec.DataType.CompositionComponent,
        `$.compositions[${index}].components[${referenceIndex}]`,
        diagnostics,
      );
    });
    validateReferences(composition.children ?? [], itemIds, `$.compositions[${index}].children`, diagnostics);
  });

  scene.items.forEach((item, index) => {
    validateReferences(item.components, componentIds, `$.items[${index}].components`, diagnostics);
    validateReferences(item.children ?? [], itemIds, `$.items[${index}].children`, diagnostics);

    if (item.parentId !== undefined) {
      validateReference(item.parentId, itemIds, `$.items[${index}].parentId`, diagnostics);
    }
  });

  scene.components.forEach((component, index) => {
    if (component.dataType === spec.DataType.CompositionComponent) {
      const compositionComponent = component as spec.CompositionComponentData;

      validateReference(compositionComponent.item.id, compositionIds, `$.components[${index}].item`, diagnostics);
      validateReferences(compositionComponent.items, itemIds, `$.components[${index}].items`, diagnostics);
      validateReference(
        compositionComponent.timelineAsset.id,
        miscIds,
        `$.components[${index}].timelineAsset`,
        diagnostics,
      );
      validateReferenceType(
        compositionComponent.timelineAsset.id,
        miscTypes,
        spec.DataType.TimelineAsset,
        `$.components[${index}].timelineAsset`,
        diagnostics,
      );
      compositionComponent.sceneBindings.forEach((binding, bindingIndex) => {
        validateReference(
          binding.key.id,
          miscIds,
          `$.components[${index}].sceneBindings[${bindingIndex}].key`,
          diagnostics,
        );
        validateReferenceType(
          binding.key.id,
          miscTypes,
          spec.DataType.ObjectBindingTrack,
          `$.components[${index}].sceneBindings[${bindingIndex}].key`,
          diagnostics,
        );
        validateReference(
          binding.value.id,
          itemIds,
          `$.components[${index}].sceneBindings[${bindingIndex}].value`,
          diagnostics,
        );
      });

      return;
    }

    validateReference(component.item.id, itemIds, `$.components[${index}].item`, diagnostics);

    if (component.dataType === spec.DataType.EffectComponent) {
      const effectComponent = component as spec.EffectComponentData;

      validateReferences(effectComponent.materials, materialIds, `$.components[${index}].materials`, diagnostics);
      validateReference(effectComponent.geometry.id, geometryIds, `$.components[${index}].geometry`, diagnostics);
    }
  });

  scene.materials.forEach((material, index) => {
    validateReference(material.shader.id, shaderIds, `$.materials[${index}].shader`, diagnostics);
    Object.entries(material.textures).forEach(([name, texture]) => {
      validateReference(texture.texture.id, textureIds, `$.materials[${index}].textures.${name}.texture`, diagnostics);
    });
  });

  (scene.textures ?? []).forEach((texture, index) => {
    if ('source' in texture && typeof texture.source === 'object') {
      validateReference(texture.source.id, imageIds, `$.textures[${index}].source`, diagnostics);
    }
  });

  scene.miscs.forEach((misc, index) => {
    if (misc.dataType === spec.DataType.TimelineAsset) {
      const tracks = (misc as spec.TimelineAssetData).tracks;

      validateReferences(tracks, miscIds, `$.miscs[${index}].tracks`, diagnostics);
      tracks.forEach((track, trackIndex) => {
        validateReferenceType(
          track.id,
          miscTypes,
          spec.DataType.ObjectBindingTrack,
          `$.miscs[${index}].tracks[${trackIndex}]`,
          diagnostics,
        );
      });
    }

    if ('children' in misc && Array.isArray(misc.children)) {
      validateReferences(misc.children as spec.DataPath[], miscIds, `$.miscs[${index}].children`, diagnostics);
    }

    if ('clips' in misc && Array.isArray(misc.clips)) {
      const clips = misc.clips as unknown[];

      clips.forEach((clip, clipIndex) => {
        if (typeof clip === 'object' && clip !== null && 'asset' in clip) {
          const asset = (clip as Record<string, unknown>).asset as spec.DataPath;

          validateReference(asset.id, miscIds, `$.miscs[${index}].clips[${clipIndex}].asset`, diagnostics);
        }
      });
    }
  });

  appendJSONDiagnostics(scene, diagnostics);

  return diagnostics;
}

function collectIds(values: Array<{ id?: string }>): Set<string> {
  return new Set(values.flatMap(value => (value.id === undefined ? [] : [value.id])));
}

function collectDataTypes(values: Array<{ id?: string; dataType?: string }>): Map<string, string> {
  return new Map(
    values.flatMap(value =>
      value.id === undefined || value.dataType === undefined ? [] : [[value.id, value.dataType] as const],
    ),
  );
}

function validateReferences(
  references: spec.DataPath[],
  targetIds: Set<string>,
  path: string,
  diagnostics: ShaderDiagnostic[],
): void {
  references.forEach((reference, index) => {
    validateReference(reference.id, targetIds, `${path}[${index}]`, diagnostics);
  });
}

function validateReference(
  id: string,
  targetIds: Set<string>,
  path: string,
  diagnostics: ShaderDiagnostic[],
): void {
  if (targetIds.has(id)) {
    return;
  }
  diagnostics.push({
    code: 'SCENE_REFERENCE_INVALID',
    severity: 'error',
    message: `DataPath reference "${id}" does not resolve to the expected object pool.`,
    path,
  });
}

function validateReferenceType(
  id: string,
  targetTypes: Map<string, string>,
  expectedType: string,
  path: string,
  diagnostics: ShaderDiagnostic[],
): void {
  const actualType = targetTypes.get(id);

  if (actualType === undefined || actualType === expectedType) {
    return;
  }

  diagnostics.push({
    code: 'SCENE_REFERENCE_INVALID',
    severity: 'error',
    message: `DataPath reference "${id}" resolves to "${actualType}" instead of "${expectedType}".`,
    path,
  });
}

function appendJSONDiagnostics(scene: spec.JSONScene, diagnostics: ShaderDiagnostic[]): void {
  appendNonFiniteDiagnostics(scene, '$', diagnostics, new WeakSet<object>());

  try {
    const serialized = JSON.stringify(scene);
    const roundTrip = JSON.stringify(JSON.parse(serialized));

    if (roundTrip !== serialized) {
      diagnostics.push({
        code: 'SCENE_JSON_UNSTABLE',
        severity: 'error',
        message: 'Generated JSONScene changed after a JSON serialization round trip.',
        path: '$',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown serialization error';

    diagnostics.push({
      code: 'SCENE_JSON_UNSTABLE',
      severity: 'error',
      message: `Generated JSONScene is not JSON serializable: ${message}`,
      path: '$',
    });
  }
}

function appendNonFiniteDiagnostics(
  value: unknown,
  path: string,
  diagnostics: ShaderDiagnostic[],
  visited: WeakSet<object>,
): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      diagnostics.push({
        code: 'SCENE_VALUE_NON_FINITE',
        severity: 'error',
        message: 'Generated JSONScene contains a non-finite number.',
        path,
      });
    }

    return;
  }

  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return;
  }

  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendNonFiniteDiagnostics(entry, `${path}[${index}]`, diagnostics, visited));

    return;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    appendNonFiniteDiagnostics(entry, `${path}.${key}`, diagnostics, visited);
  });
}
