import { resolveDataPathId } from '../common/data-path';
import { isRecord } from '../common/json-normalization';
import { particleNumber, particleRecord } from './sample-particle-values';
import { particleTextureFillTable } from './texture-fill-table';

export function lookupParticleTextureFill(
  scene: Record<string, unknown>, system: Record<string, unknown>, given?: number,
): { fill: number; source: 'given' | 'table' | 'untextured' | 'default'; missing?: string } {
  if (given !== undefined && Number.isFinite(given) && given > 0 && given <= 1) {
    return { fill: given, source: 'given' };
  }
  const reference = particleRecord(system['renderer'])['texture'];
  const fallback = Math.PI / 4;

  if (reference == null) {
    return { fill: fallback, source: 'untextured' };
  }
  const textures = Array.isArray(scene['textures']) ? scene['textures'].filter(isRecord) : [];
  const texture = textures.find(value => value['id'] === resolveDataPathId(reference));
  const images = Array.isArray(scene['images']) ? scene['images'].filter(isRecord) : [];
  const source = texture?.['source'];
  const imageId = typeof source === 'string' ? source : resolveDataPathId(source);
  const image = typeof source === 'number' ? images[source]
    : images.find(value => value['id'] === imageId);
  const url = image?.['url'];

  if (typeof url !== 'string' || url.trim() === '') {
    return { fill: fallback, source: 'default', missing: 'unresolved source texture URL' };
  }
  const entry = particleTextureFillTable[url.trim().split(/[?#]/)[0]];
  const sheet = particleRecord(system['textureSheetAnimation']);
  const columns = Math.max(1, Math.floor(particleNumber(sheet['col'], 1)));
  const rows = Math.max(1, Math.floor(particleNumber(sheet['row'], 1)));
  const declaredTotal = particleNumber(sheet['total'], columns * rows);
  const total = Math.min(columns * rows, Math.max(1, Math.floor(declaredTotal === 0 ? columns * rows : declaredTotal)));

  if (entry == null || entry[1] !== columns || entry[2] !== rows || entry[3] !== total) {
    const reason = entry == null ? 'not in the fill table' : `sheet layout ${columns}x${rows}x${total} not in the fill table`;

    return { fill: fallback, source: 'default', missing: `${url} (${reason})` };
  }

  return { fill: entry[0], source: 'table' };
}
