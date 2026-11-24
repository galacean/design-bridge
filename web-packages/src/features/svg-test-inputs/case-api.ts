import { readInputTextFromUrl } from '../local-inputs/input-api';

export type SVGCaseType = 'static' | 'dynamic';
export interface SVGCase { name: string; pool: string; type: SVGCaseType; tag: string; note: string }

export const casePools: Record<string, string> = {
  syn: '合成样本', ti: '真实模板', dspec: '规范动画', dreal: '真实 SMIL',
  'dreal-css': '真实 CSS', examples: '内置示例',
};

export const caseTags = [
  { value: '', label: '未标记' },
  { value: 'svg2ge', label: '转换器待修' },
  { value: 'ge-capability', label: 'GE 能力限制' },
  { value: 'impl-diff', label: '实现差异' },
  { value: 'harness', label: '工具问题' },
  { value: 'case-issue', label: '案例问题' },
  { value: 'pass', label: '已标记通过' },
];

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) { return {}; }

  return Object.fromEntries(Object.entries(value));
}

async function readJSON(url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal });
  const data: unknown = await response.json();
  const result = record(data);

  if (!response.ok || typeof result.error === 'string') {
    throw new Error(typeof result.error === 'string' ? result.error : `HTTP ${response.status}`);
  }

  return result;
}

export async function listSVGCases(type: SVGCaseType, pool = '', signal?: AbortSignal, source = 'all'): Promise<SVGCase[]> {
  if (type === 'dynamic' && source === 'fail') { throw new Error('静态失败名单仅支持静态 SVG。'); }
  const query = new URLSearchParams({ type, pool, source });
  const [data, tagsData] = await Promise.all([
    readJSON(`/api/svg2ge/${source === 'fail' && type === 'static' ? 'list-fail' : 'list-input'}?${query}`, signal), readJSON('/api/svg2ge/tags', signal),
  ]);
  const files = data.files;

  if (!Array.isArray(files) || !files.every((name: unknown) => typeof name === 'string')) {
    throw new Error('SVG 案例列表格式无效。');
  }
  const metadata = record(data.meta);
  const tags = record(tagsData.tags);

  return files.map((name: string) => {
    const meta = record(metadata[name]);
    const entry = record(tags[name]);

    return {
      name, type,
      pool: typeof meta.pool === 'string' ? meta.pool : '',
      tag: typeof entry.tag === 'string' ? entry.tag : '',
      note: typeof entry.note === 'string' ? entry.note : '',
    };
  });
}

export async function readSVGCase(item: SVGCase, signal?: AbortSignal): Promise<string> {
  const url = `/api/svg2ge/read-input/${encodeURIComponent(item.name)}?type=${item.type}`;

  return readInputTextFromUrl(url, signal, `读取 ${item.name} 失败：`);
}

export async function saveCaseTag(name: string, tag: string, note: string): Promise<void> {
  const response = await fetch(`/api/svg2ge/tags${tag === '' ? '/delete' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, tag, note }),
  });

  if (!response.ok) { throw new Error(`保存分类失败：HTTP ${response.status}`); }
}

interface SVGCaseSelection { type: SVGCaseType; names: string[] }
const PREFIX = 'svg-case-selection:';

export function storeSVGCaseSelection(type: SVGCaseType, names: string[]): string {
  const id = crypto.randomUUID();

  sessionStorage.setItem(PREFIX + id, JSON.stringify({ type, names: Array.from(new Set(names)) }));
  sessionStorage.setItem(`${PREFIX}last:${type}`, id);

  return id;
}

export function readSVGCaseSelection(id: string): SVGCaseSelection {
  const raw = sessionStorage.getItem(PREFIX + id);

  if (raw == null) { throw new Error('多选范围已失效，请返回案例库重新选择。'); }
  const value: unknown = JSON.parse(raw);

  if (value == null || typeof value !== 'object' || !('type' in value) ||
    (value.type !== 'static' && value.type !== 'dynamic') || !('names' in value) || !Array.isArray(value.names) ||
    value.names.length === 0 || !value.names.every((name: unknown) => typeof name === 'string')) {
    throw new Error('多选范围格式无效，请返回案例库重新选择。');
  }

  return { type: value.type, names: value.names.filter((name: unknown): name is string => typeof name === 'string') };
}

export function saveSVGSelectionDraft(type: SVGCaseType, names: string[]): void {
  if (names.length === 0) {
    clearSVGCaseSelection(type);

    return;
  }
  sessionStorage.setItem(`${PREFIX}draft:${type}`, JSON.stringify(Array.from(new Set(names))));
}

export function lastSVGCaseSelection(type: SVGCaseType): string[] {
  const draftKey = `${PREFIX}draft:${type}`;
  const draft = sessionStorage.getItem(draftKey);

  if (draft != null) {
    try {
      const names: unknown = JSON.parse(draft);

      if (Array.isArray(names) && names.every((name: unknown) => typeof name === 'string')) {
        return names.filter((name: unknown): name is string => typeof name === 'string');
      }
    } catch { /* Discard a corrupt draft instead of changing the run scope. */ }
    sessionStorage.removeItem(draftKey);

    return [];
  }
  const id = sessionStorage.getItem(`${PREFIX}last:${type}`);

  if (id == null) { return []; }
  try {
    return readSVGCaseSelection(id).names;
  } catch {
    sessionStorage.removeItem(`${PREFIX}last:${type}`);

    return [];
  }
}

export function clearSVGCaseSelection(type: SVGCaseType): void {
  sessionStorage.removeItem(`${PREFIX}draft:${type}`);
  sessionStorage.removeItem(`${PREFIX}last:${type}`);
}
