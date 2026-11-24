import type { DebugMapEntry, ConversionResult } from '@galacean/figma2ge';
import type { LocateHistoryEntry, ScenePreviewObject } from '../types';

interface MappingTrackerPanelProps {
  result: ConversionResult;
  debugMapSize: number;
  figmaNodeLookupId: string;
  trimmedLookupId: string;
  matchedDebugEntry: DebugMapEntry | undefined;
  previewObjects: ScenePreviewObject[];
  locateHistory: LocateHistoryEntry[];
  setFigmaNodeLookupId: (value: string) => void;
  clearLocateHistory: () => void;
  applyHistoryEntry: (entry: LocateHistoryEntry) => void;
}

export default function MappingTrackerPanel(props: MappingTrackerPanelProps) {
  const {
    result,
    debugMapSize,
    figmaNodeLookupId,
    trimmedLookupId,
    matchedDebugEntry,
    previewObjects,
    locateHistory,
    setFigmaNodeLookupId,
    clearLocateHistory,
    applyHistoryEntry,
  } = props;

  return (
    <div className="ui-card-compact p-4">
      <div className="ui-kicker mb-2">映射追踪</div>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <input
          value={figmaNodeLookupId}
          onChange={e => setFigmaNodeLookupId(e.target.value)}
          placeholder="输入 Figma Node ID（例如 rect-1）"
          className="ui-input px-2 text-[12px]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!figmaNodeLookupId) {
                const first = Object.keys(result.debugMap)[0];

                if (first) {
                  setFigmaNodeLookupId(first);
                }
              }
            }}
            className="ui-btn ui-btn-xs ui-btn-ghost"
          >
            示例
          </button>
        </div>
      </div>

      <div className="mt-3 text-[12px] text-[var(--color-text-primary)]">DebugMap entries: {debugMapSize}</div>

      {trimmedLookupId ? (
        matchedDebugEntry ? (
          <div className="ui-code ui-code-compact mt-2 text-[12px] text-[var(--color-text-primary)]">
            <div>figmaNodeId: {matchedDebugEntry.figmaNodeId}</div>
            <div>figmaNodeName: {matchedDebugEntry.figmaNodeName}</div>
            <div>itemId: {matchedDebugEntry.itemId ?? '(none)'}</div>
            <div>componentIds: {matchedDebugEntry.componentIds.join(', ') || '(none)'}</div>
            {matchedDebugEntry.skipped ? <div>skipped: true ({matchedDebugEntry.reason ?? 'unknown'})</div> : null}
          </div>
        ) : (
          <div className="mt-2 text-[12px] text-[var(--gold)]">未找到该 Figma Node ID 对应映射。</div>
        )
      ) : (
        <div className="mt-2 text-[12px] text-[var(--color-text-secondary)]">输入 Node ID 查看映射详情。</div>
      )}

      {previewObjects.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="ui-kicker">Scene 片段预览</div>
          <div className="grid gap-2 lg:grid-cols-2">
            {previewObjects.map(entry => (
              <div key={`${entry.label}-${entry.id}`} className="ui-code ui-code-compact">
                <div className="mb-1 text-[11px] text-[var(--color-text-secondary)]">
                  {entry.label} · {entry.id}
                </div>
                <pre className="max-h-[180px] overflow-auto text-[11px] leading-relaxed text-[var(--color-text-primary)]">
                  {JSON.stringify(entry.value, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {locateHistory.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="ui-kicker">定位历史</div>
            <button onClick={clearLocateHistory} className="ui-btn ui-btn-xs ui-btn-ghost">
              清空
            </button>
          </div>
          <ul className="space-y-1 max-h-[160px] overflow-auto">
            {locateHistory.map((entry, idx) => (
              <li
                key={`${entry.time}-${idx}`}
                className="ui-card-compact px-2 py-1.5 text-[11px] text-[var(--color-text-primary)]"
              >
                <div className="flex items-center justify-between">
                  <span>
                    {entry.time} · {entry.source}
                  </span>
                  <button onClick={() => applyHistoryEntry(entry)} className="ui-btn ui-btn-xs ui-btn-gold">
                    回跳
                  </button>
                </div>
                <div className="mt-0.5">figma: {entry.figmaNodeId ?? '(none)'}</div>
                <div>scene: {entry.sceneObjectId ?? '(none)'}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
