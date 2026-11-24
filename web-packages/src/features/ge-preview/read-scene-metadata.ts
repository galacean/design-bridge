function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function readGESceneMetadata(scene: unknown) {
  const data = isRecord(scene) ? scene : {};
  const compositions: unknown[] = Array.isArray(data.compositions) ? data.compositions : [];
  const items: unknown[] = Array.isArray(data.items) ? data.items : [];
  const entry = (typeof data.compositionId === 'string'
    ? compositions.find(value => isRecord(value) && value.id === data.compositionId) : undefined) ?? compositions[0];
  const composition = isRecord(entry) ? entry : {};
  const size: unknown = composition.previewSize;
  const previewSize = Array.isArray(size) && typeof size[0] === 'number' && typeof size[1] === 'number' &&
    Number.isFinite(size[0]) && Number.isFinite(size[1]) && size[0] > 0 && size[1] > 0
    ? { width: size[0], height: size[1] } : null;
  const duration = typeof composition.duration === 'number' && Number.isFinite(composition.duration) &&
    composition.duration >= 0 ? composition.duration : null;
  const nestedLayers = items.reduce((total: number, item) => {
    const content = isRecord(item) && isRecord(item.content) ? item.content : {};

    return total + (Array.isArray(content.items) ? content.items.length : 0);
  }, 0);

  return {
    version: typeof data.version === 'string' ? data.version : null,
    duration,
    previewSize,
    compositions: compositions.length,
    items: items.length,
    nestedLayers,
  };
}
