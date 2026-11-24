import { useState } from 'react';
import { useDebugger } from './hooks/use-debugger';
import ControlPanel from './components/control-panel';
import ConversionSummaryCard from './components/conversion-summary-card';
import IssueList from './components/issue-list';
import MappingTrackerPanel from './components/mapping-tracker-panel';
import OutputPanel from './components/output-panel';
import PlayerPanel from './components/player-panel';
import type { spec } from '@galacean/effects';
import ThemeModeDropdown from '../../components/theme-mode-dropdown';

export default function FigmaToGE() {
  const { state, derived, refs, actions } = useDebugger();
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div className="min-h-screen px-4 py-2 md:px-6 md:py-3">
      <div className="mx-auto mb-3 flex w-full max-w-[1320px] justify-end">
        <ThemeModeDropdown />
      </div>

      <div className="mx-auto w-full max-w-[1320px] grid gap-3 md:grid-cols-[360px_1fr]">
        <aside className="self-start space-y-2 md:sticky md:top-3">
          <ControlPanel
            dragOver={state.dragOver}
            fileName={state.fileName}
            status={state.status}
            error={state.error}
            includeInvisibleNodes={state.includeInvisibleNodes}
            compositionName={state.compositionName}
            compositionDuration={state.compositionDuration}
            fileInputRef={refs.fileInputRef}
            setDragOver={actions.setDragOver}
            onDrop={actions.onDrop}
            onPickFile={actions.onPickFile}
            setIncludeInvisibleNodes={actions.setIncludeInvisibleNodes}
            setCompositionName={actions.setCompositionName}
            setCompositionDuration={actions.setCompositionDuration}
          />

          {state.result && (
            <ConversionSummaryCard
              scene={derived.scene}
              result={state.result}
              debugMapSize={derived.debugMapSize}
              warningCount={derived.warningCount}
              errorCount={derived.errorCount}
            />
          )}

          <button
            onClick={() => setShowDebug(v => !v)}
            className={`ui-btn h-[40px] w-full justify-between px-3 text-[12px] ${
              showDebug ? 'ui-btn-primary' : 'ui-btn-ghost'
            }`}
          >
            <span>调试面板</span>
            <span className="text-[11px]">{showDebug ? 'ON' : 'OFF'}</span>
          </button>
        </aside>

        <section className="relative">
          <PlayerPanel scene={derived.scene as unknown as spec.JSONScene} />

          {showDebug && (
            <div
              className="absolute inset-0 z-10 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border)] backdrop-blur-sm"
              style={{ backgroundColor: 'color-mix(in srgb, var(--bg) 92%, transparent)' }}
            >
              <div
                className="sticky top-0 flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5"
                style={{ backgroundColor: 'color-mix(in srgb, var(--bg) 94%, transparent)' }}
              >
                <span className="text-[13px] font-semibold text-[var(--color-text-emphasis)]">调试面板</span>
                <button onClick={() => setShowDebug(false)} className="ui-btn-icon" aria-label="关闭调试面板">
                  ✕
                </button>
              </div>
              <div className="p-3 space-y-3">
                {state.result && state.result.issues.length > 0 && (
                  <IssueList
                    title="转换问题"
                    items={state.result.issues}
                    onLocate={message => actions.locateFromIssue(message, 'issue')}
                  />
                )}

                {state.result && (
                  <IssueList
                    title={`Runtime 烟雾检查 · E${derived.smokeErrorCount} / W${derived.smokeWarningCount}`}
                    items={state.runtimeSmokeIssues}
                    onLocate={message => actions.locateFromIssue(message, 'runtime')}
                    tone={derived.smokeErrorCount > 0 ? 'warn' : 'success'}
                  />
                )}

                {state.result && (
                  <MappingTrackerPanel
                    result={state.result}
                    debugMapSize={derived.debugMapSize}
                    figmaNodeLookupId={state.figmaNodeLookupId}
                    trimmedLookupId={derived.trimmedLookupId}
                    matchedDebugEntry={derived.matchedDebugEntry}
                    previewObjects={derived.previewObjects}
                    locateHistory={state.locateHistory}
                    setFigmaNodeLookupId={actions.setFigmaNodeLookupId}
                    clearLocateHistory={actions.clearLocateHistory}
                    applyHistoryEntry={actions.applyHistoryEntry}
                  />
                )}

                {state.output && (
                  <OutputPanel
                    output={state.output}
                    outputMode={state.outputMode}
                    copied={state.copied}
                    setMode={actions.setMode}
                    copyOutput={actions.copyOutput}
                    downloadOutput={actions.downloadOutput}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
