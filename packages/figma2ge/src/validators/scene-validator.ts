import { spec } from '@galacean/effects';
import type { ConversionIssue, EffectsScene } from '../types';
import { asRecord } from '../utils';

export function validateSceneReferences(scene: EffectsScene): ConversionIssue[] {
  const issues: ConversionIssue[] = [];

  const itemIds = new Set(scene.items.map(item => item.id));
  const componentIds = new Set(scene.components.map(component => component.id));
  const compositionIds = new Set(scene.compositions.map(composition => composition.id));
  const miscIds = new Set((scene.miscs ?? []).map(m => m.id));

  if (
    scene.compositionId === undefined ||
    scene.compositionId.length === 0 ||
    !compositionIds.has(scene.compositionId)
  ) {
    issues.push({
      type: 'error',
      message: `scene.compositionId (${scene.compositionId}) is missing from scene.compositions.`,
    });
  }

  for (const composition of scene.compositions) {
    for (const child of composition.children ?? []) {
      if (!itemIds.has(child.id)) {
        issues.push({
          type: 'error',
          message: `Composition child reference points to missing item id: ${child.id}.`,
        });
      }
    }

    for (const component of composition.components ?? []) {
      if (!componentIds.has(component.id)) {
        issues.push({
          type: 'error',
          message: `Composition component reference points to missing component id: ${component.id}.`,
        });
      }
    }
  }

  for (const item of scene.items) {
    if (item.parentId !== undefined && item.parentId.length > 0 && !itemIds.has(item.parentId)) {
      issues.push({
        type: 'error',
        message: `Item ${item.id} references missing parentId: ${item.parentId}.`,
      });
    }

    for (const child of item.children ?? []) {
      if (!itemIds.has(child.id)) {
        issues.push({
          type: 'error',
          message: `Item ${item.id} references missing child item id: ${child.id}.`,
        });
      }
    }

    for (const component of item.components ?? []) {
      if (!componentIds.has(component.id)) {
        issues.push({
          type: 'error',
          message: `Item ${item.id} references missing component id: ${component.id}.`,
        });
      }
    }
  }

  for (const component of scene.components) {
    // CompositionComponent.item references a composition, not an item
    if (component.dataType === spec.DataType.CompositionComponent) {
      if (!compositionIds.has(component.item.id)) {
        issues.push({
          type: 'error',
          message: `CompositionComponent ${component.id} references missing composition id: ${component.item.id}.`,
        });
      }

      // Validate timeline references
      const compData = asRecord(component);

      if (compData) {
        const timelineAsset = asRecord(compData.timelineAsset);

        if (timelineAsset && typeof timelineAsset.id === 'string' && !miscIds.has(timelineAsset.id)) {
          issues.push({
            type: 'error',
            message: `CompositionComponent ${component.id} references missing timelineAsset id: ${timelineAsset.id}.`,
          });
        }

        const sceneBindings = Array.isArray(compData.sceneBindings) ? compData.sceneBindings : [];

        for (const binding of sceneBindings) {
          const b = asRecord(binding);

          if (!b) {
            continue;
          }
          const key = asRecord(b.key);
          const value = asRecord(b.value);

          if (key && typeof key.id === 'string' && !miscIds.has(key.id)) {
            issues.push({
              type: 'error',
              message: `CompositionComponent ${component.id} sceneBinding key references missing misc id: ${key.id}.`,
            });
          }
          if (value && typeof value.id === 'string' && !itemIds.has(value.id)) {
            issues.push({
              type: 'error',
              message: `CompositionComponent ${component.id} sceneBinding value references missing item id: ${value.id}.`,
            });
          }
        }
      }
    } else if (!itemIds.has(component.item.id)) {
      issues.push({
        type: 'error',
        message: `Component ${component.id} references missing item id: ${component.item.id}.`,
      });
    }
  }

  // Validate timeline internal references in miscs
  for (const misc of scene.miscs ?? []) {
    const rec = asRecord(misc);

    if (!rec) {
      continue;
    }

    // TimelineAsset.tracks → must reference miscs
    if (misc.dataType === spec.DataType.TimelineAsset) {
      const tracks = Array.isArray(rec.tracks) ? rec.tracks : [];

      for (const track of tracks) {
        const t = asRecord(track);

        if (t && typeof t.id === 'string' && !miscIds.has(t.id)) {
          issues.push({
            type: 'error',
            message: `TimelineAsset ${misc.id} references missing track id: ${t.id}.`,
          });
        }
      }
    }

    // Tracks with children → children must reference miscs
    const children = Array.isArray(rec.children) ? rec.children : [];

    for (const child of children) {
      const c = asRecord(child);

      if (c && typeof c.id === 'string' && !miscIds.has(c.id)) {
        issues.push({
          type: 'error',
          message: `Track ${misc.id} references missing child track id: ${c.id}.`,
        });
      }
    }

    // Clips' asset references → must reference miscs
    const clips = Array.isArray(rec.clips) ? rec.clips : [];

    for (const clip of clips) {
      const clipRec = asRecord(clip);

      if (!clipRec) {
        continue;
      }
      const asset = asRecord(clipRec.asset);

      if (asset && typeof asset.id === 'string' && !miscIds.has(asset.id)) {
        issues.push({
          type: 'error',
          message: `Track ${misc.id} clip references missing playable asset id: ${asset.id}.`,
        });
      }
    }
  }

  return issues;
}
