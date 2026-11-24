import { useMemo } from 'react';
import type { DebugMapEntry, EffectsScene } from '@galacean/figma2ge';
import type { ScenePreviewObject } from '../types';
import { findEntityById } from '../utils';

interface UseScenePreviewParams {
  scene: EffectsScene | undefined;
  matchedDebugEntry: DebugMapEntry | undefined;
  trimmedFocusedSceneObjectId: string;
}

export function useScenePreview(params: UseScenePreviewParams): ScenePreviewObject[] {
  const { scene, matchedDebugEntry, trimmedFocusedSceneObjectId } = params;

  const previewIds = useMemo(() => {
    return Array.from(
      new Set([
        ...(matchedDebugEntry?.itemId ? [matchedDebugEntry.itemId] : []),
        ...(matchedDebugEntry?.componentIds ?? []),
        ...(trimmedFocusedSceneObjectId ? [trimmedFocusedSceneObjectId] : []),
      ]),
    );
  }, [matchedDebugEntry, trimmedFocusedSceneObjectId]);

  return useMemo(() => {
    return previewIds
      .map(id => {
        const found = findEntityById(scene, id);

        if (!found) {
          return null;
        }

        return {
          id,
          label: found.label,
          value: found.value,
        };
      })
      .filter((entry): entry is ScenePreviewObject => !!entry);
  }, [previewIds, scene]);
}
