/** SVG 专属 Effects 转换使用的 DataPath 和实体 ID 辅助。 */
import type { DataPath } from '@galacean/effects-specification';

/** 生成 32 位十六进制 Effects 实体 ID(与 ge-ir createId 同构)。 */
export function createId (): string {
  const bytes = new Uint8Array(16);

  globalThis.crypto.getRandomValues(bytes);

  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 把 ID 包装成 Effects DataPath 引用。 */
export function toDataPath (id: string): DataPath {
  return { id };
}
