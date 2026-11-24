import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  casePools, caseTags, lastSVGCaseSelection, listSVGCases, saveSVGSelectionDraft, storeSVGCaseSelection,
  type SVGCase, type SVGCaseType,
} from '../../../features/svg-test-inputs/case-api';

export default function SVGCaseList({ type, onTypeChange, onSelect, activeName, tagUpdate }: {
  type: SVGCaseType; onTypeChange: (type: SVGCaseType) => void;
  onSelect: (item: SVGCase) => void; activeName?: string;
  tagUpdate?: Pick<SVGCase, 'name' | 'tag' | 'note'>;
}) {
  const navigate = useNavigate();
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filterId = useId();
  const [selectedNames, setSelectedNames] = useState<string[]>(() => lastSVGCaseSelection(type));
  const [selectionMode, setSelectionMode] = useState(() => selectedNames.length > 0);
  const anchor = useRef<number | null>(null);
  const updateVersion = useRef(0);
  const updates = useRef(new Map<string, { version: number; tag: string; note: string }>());
  const [cases, setCases] = useState<SVGCase[]>([]);
  const [pool, setPool] = useState('');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('all');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const version = updateVersion.current;

    setError('');
    void listSVGCases(type, '', controller.signal).then(items => {
      if (!controller.signal.aborted) {
        setCases(items.map(item => {
          const update = updates.current.get(item.name);

          return update != null && update.version > version ? { ...item, tag: update.tag, note: update.note } : item;
        }));
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); }
    });

    return () => controller.abort();
  }, [type, revision]);
  useEffect(() => {
    if (tagUpdate == null) { return; }
    updateVersion.current++;
    updates.current.set(tagUpdate.name, { version: updateVersion.current, tag: tagUpdate.tag, note: tagUpdate.note });
    setCases(current => current.map(item => item.name === tagUpdate.name
      ? { ...item, tag: tagUpdate.tag, note: tagUpdate.note } : item));
  }, [tagUpdate]);
  useEffect(() => { anchor.current = null; }, [search, pool, tag]);
  const selected = new Set(selectedNames);
  const filtered = cases.filter(item => (pool === '' || item.pool === pool) &&
    (tag === 'all' || item.tag === tag) && item.name.toLowerCase().includes(search.toLowerCase()));

  function updateSelection(names: string[]) {
    setSelectedNames(names);
    try {
      saveSVGSelectionDraft(type, names);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function toggle(index: number, checked: boolean, range: boolean) {
    const first = range && anchor.current != null ? Math.min(anchor.current, index) : index;
    const last = range && anchor.current != null ? Math.max(anchor.current, index) : index;
    const next = new Set(selectedNames);

    for (const item of filtered.slice(first, last + 1)) {
      if (checked) { next.add(item.name); } else { next.delete(item.name); }
    }
    anchor.current = index;
    updateSelection(Array.from(next));
  }

  function runSelected() {
    try {
      const id = storeSVGCaseSelection(type, selectedNames);
      const query = new URLSearchParams({ type, selection: id, max: String(selectedNames.length), run: 'selected' });

      void navigate(`/svg-auto-frame-test?${query}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <aside className="ui-soft-panel ui-file-sidebar svg-case-sidebar" aria-label="SVG 案例库"
      data-filters-expanded={filtersExpanded}>
      <div className="svg-case-heading flex items-center justify-between gap-2 px-3 py-3">
        <h2 className="text-sm font-semibold">案例库 · {filtered.length}/{cases.length}</h2>
        <button className="ui-btn ui-btn-ghost svg-case-filter-toggle" aria-expanded={filtersExpanded}
          aria-controls={filterId} onClick={() => setFiltersExpanded(value => !value)}>
          筛选与多选
        </button>
        <button className="ui-btn ui-btn-icon" aria-label="刷新案例库" title="刷新案例库"
          onClick={() => setRevision(value => value + 1)}>↻</button>
      </div>
      <div className="svg-case-sidebar-body">
        <div className="svg-case-filters px-3 py-3 space-y-2">
          <div className="svg-case-search-fields">
            <label className="block text-xs">
              <span className="svg-case-type-caption">案例类型</span>
              <select aria-label="案例类型" className="ui-input w-full mt-1" value={type}
                onChange={event => onTypeChange(event.target.value === 'dynamic' ? 'dynamic' : 'static')}>
                <option value="static">静态 SVG</option><option value="dynamic">动态 SVG</option>
              </select>
            </label>
            <input
              className="ui-input w-full" aria-label="搜索 SVG 案例" placeholder="搜索文件名"
              value={search} onChange={event => setSearch(event.target.value)}
            />
          </div>
          <div id={filterId} className="svg-case-advanced space-y-2">
            <select className="ui-input w-full" aria-label="样本池" value={pool} onChange={e => setPool(e.target.value)}>
              <option value="">全部样本池</option>
              {Array.from(new Set(cases.map(item => item.pool))).map(value => <option key={value} value={value}>{casePools[value] ?? value}</option>)}
            </select>
            <select className="ui-input w-full" aria-label="案例分类筛选" value={tag} onChange={e => setTag(e.target.value)}>
              <option value="all">全部分类</option>
              {caseTags.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <div className="svg-case-selection-bar">
              <button className="ui-btn ui-btn-secondary" aria-pressed={selectionMode}
                onClick={() => setSelectionMode(value => !value)}>{selectionMode ? '完成多选' : '多选'}</button>
              {selectedNames.length > 0 && <span className="text-xs text-[var(--workbench-muted)]">
                已选 {selectedNames.length} 个
              </span>}
            </div>
            {selectionMode && <div className="space-y-2">
              <div className="flex gap-1">
                <button className="ui-btn ui-btn-secondary flex-1" disabled={filtered.length === 0} onClick={() => {
                  updateSelection(Array.from(new Set([...selectedNames, ...filtered.map(item => item.name)])));
                }}>全选当前筛选</button>
                <button className="ui-btn ui-btn-ghost" disabled={selectedNames.length === 0} onClick={() => {
                  updateSelection([]);
                }}>清空选择</button>
              </div>
            </div>}
          </div>
        </div>
        {error !== '' && <p role="alert" className="text-xs text-[var(--coral)]">{error}</p>}
        <div className="svg-case-files py-2" aria-label="SVG 案例文件">
          {filtered.map((item, index) => (
            <div key={item.name} className="flex min-w-0 items-center gap-1 rounded"
              style={selected.has(item.name) ? { background: 'var(--workbench-accent-dim)' } : undefined}>
              {selectionMode && <input
                type="checkbox" checked={selected.has(item.name)} aria-label={`选择 ${item.name}`}
                style={{ appearance: 'auto', width: 16, height: 16, flexShrink: 0, accentColor: 'var(--workbench-accent)' }}
                onChange={event => toggle(index, event.currentTarget.checked,
                  event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)}
              />}
              <button
                title={item.name} aria-current={item.name === activeName ? 'true' : undefined}
                className="ui-soft-file min-w-0 flex-1 text-left text-xs px-2 py-2"
                onClick={event => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) {
                    setSelectionMode(true);
                    toggle(index, !selected.has(item.name), event.shiftKey);
                  } else { onSelect(item); }
                }}
              ><span className="svg-case-name">{item.name}</span></button>
            </div>
          ))}
        </div>
      </div>
      <div className="svg-case-footer px-3 py-3 space-y-2">
        {(selectionMode || selectedNames.length > 0) && <button className="ui-btn ui-btn-primary w-full"
          disabled={selectedNames.length === 0} onClick={runSelected}>
          运行选中案例（{selectedNames.length}）
        </button>}
        <Link className="ui-btn ui-btn-secondary w-full" to={`/svg-auto-frame-test?type=${type}`}>打开批量回归</Link>
      </div>
    </aside>
  );
}
