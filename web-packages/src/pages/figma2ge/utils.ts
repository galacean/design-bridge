import type { ConversionResult, DebugMapEntry, EffectsScene } from '@galacean/figma2ge';
import type { OutputMode } from './types';

export function asSearchableRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(entry => !!entry && typeof entry === 'object').map(entry => entry as Record<string, unknown>);
}

export function collectCandidateTokens(issueMessage: string): string[] {
  const byParen = /\(([^)]+)\)/.exec(issueMessage)?.[1];
  const inline = issueMessage.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];

  return [...(byParen ? [byParen] : []), ...inline];
}

export function stringifyResult(result: ConversionResult, mode: OutputMode): string {
  if (mode === 'full') {
    return JSON.stringify(result, null, 2);
  }

  return JSON.stringify(result.scene, null, 2);
}

export function buildSceneIdSet(scene: EffectsScene | undefined): Set<string> {
  if (!scene) {
    return new Set<string>();
  }

  return new Set<string>(
    [
      ...asSearchableRecords(scene.compositions).map(entry => String(entry.id ?? '')),
      ...asSearchableRecords(scene.items).map(entry => String(entry.id ?? '')),
      ...asSearchableRecords(scene.components).map(entry => String(entry.id ?? '')),
      ...asSearchableRecords(scene.textures).map(entry => String(entry.id ?? '')),
      ...asSearchableRecords(scene.images).map(entry => String(entry.id ?? '')),
    ].filter(Boolean),
  );
}

export function findDebugEntryBySceneObjectId(
  debugMap: ConversionResult['debugMap'],
  id: string,
): DebugMapEntry | undefined {
  return Object.values(debugMap).find(entry => entry.itemId === id || entry.componentIds.includes(id));
}

export function findEntityById(
  scene: EffectsScene | undefined,
  id: string,
): { label: string; value: Record<string, unknown> } | undefined {
  if (!scene || !id) {
    return undefined;
  }

  const groups: Array<{ label: string; list: Array<Record<string, unknown>> }> = [
    { label: 'composition', list: asSearchableRecords(scene.compositions) },
    { label: 'item', list: asSearchableRecords(scene.items) },
    { label: 'component', list: asSearchableRecords(scene.components) },
    { label: 'texture', list: asSearchableRecords(scene.textures) },
    { label: 'image', list: asSearchableRecords(scene.images) },
  ];

  for (const group of groups) {
    const hit = group.list.find(entry => typeof entry.id === 'string' && entry.id === id);

    if (hit) {
      return { label: group.label, value: hit };
    }
  }

  return undefined;
}
