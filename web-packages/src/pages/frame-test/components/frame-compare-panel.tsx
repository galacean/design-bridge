import { useRef, useState } from 'react';
import WorkbenchHeader from '../../../components/workbench-header';
import { isFramePass } from '../../../features/frame-comparison/core/frame-comparison-config';
import { useFrameComparisonSession } from '../hooks/use-frame-comparison-session';
import { FrameTestInputPanel } from './frame-test-input-panel';
import { FrameTestPreview } from '../../../features/frame-comparison/preview/frame-test-preview';
import { FrameTestReportTable } from '../../../features/frame-comparison/preview/frame-test-report-table';

export default function FrameComparePanel() {
  const {
    urlInput,
    setUrlInput,
    status,
    statusMsg,
    lottieData,
    results,
    selectedFrame,
    setSelectedFrame,
    fileName,
    fileList,
    activeFile,
    loadFileList,
    loadInputFile,
    loadFromUrl,
    loadFromFile,
    clear,
    isRunning,
  } = useFrameComparisonSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const currentResult = results[selectedFrame] ?? null;

  return (
    <div
      className="ui-soft-workbench ui-page-shell min-h-screen"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];

        if (file?.name.endsWith('.json')) {
          void loadFromFile(file);
        }
      }}
    >
      <WorkbenchHeader title="Lottie 帧对比" description="加载动画，逐帧比较原始渲染、GE 转换与差异热力图。" />
      <div className="ui-workspace">
        {/* Sidebar */}
        <aside className="ui-soft-panel ui-file-sidebar">
          <div className="px-4 py-3 text-sm font-semibold border-b border-[var(--workbench-border)] flex items-center justify-between text-[var(--color-text-emphasis)]">
            <span>Input 文件</span>
            <button
              onClick={() => { void loadFileList(); }}
              className="ui-btn ui-btn-icon"
              title="刷新列表"
            >
              ↻
            </button>
          </div>
          <div className="px-3 py-2 border-b border-[var(--workbench-border)]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索文件..."
              aria-label="搜索文件"
              className="w-full px-2.5 py-1.5 text-xs bg-[var(--s1)] border border-[var(--workbench-border)] rounded-lg placeholder-[var(--workbench-muted)] focus:outline-none focus:border-[var(--workbench-accent)]"
            />
          </div>
          <div className="flex-1 overflow-y-auto py-2 text-sm">
            {fileList.length === 0 ? (
              <div className="px-4 py-3 text-[var(--workbench-muted)] text-xs text-center">暂无文件</div>
            ) : (
              fileList
                .filter(f => !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase()))
                .map(f => (
                  <button
                    key={f}
                    onClick={() => { void (loadInputFile(f)); }}
                    title={f}
                    aria-current={activeFile === f ? 'true' : undefined}
                    disabled={isRunning}
                    className="ui-soft-file w-full truncate px-3 py-2 text-left disabled:opacity-50"
                  >
                    {f}
                  </button>
                ))
            )}
          </div>
        </aside>

        {/* Main */}
        <div className="ui-workspace-content">
          <FrameTestInputPanel
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            isRunning={isRunning}
            loadFromUrl={loadFromUrl}
            clear={clear}
            fileInputRef={fileInputRef}
            loadFromFile={loadFromFile}
            status={status}
            statusMsg={statusMsg}
          />

          {currentResult == null && (
            <div className="ui-soft-panel flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2 p-6">
              <h2 className="text-[14px] font-medium text-[var(--color-text-emphasis)]">等待对比结果</h2>
              <p className="max-w-sm text-center text-[12px] leading-relaxed text-[var(--workbench-muted)]">
                从文件列表选择动画，或通过 URL、本地文件加载。完成后可拖动时间轴，查看每一帧的原始图、转换图与差异。
              </p>
            </div>
          )}

          {/* File info */}
          {fileName && lottieData && (
            <div className="text-center text-sm text-[var(--workbench-muted)]">
              {fileName} · {Number(lottieData.w)}×{Number(lottieData.h)} · {Number(lottieData.fr)}fps
            </div>
          )}

          {/* Overall verdict */}
          {status === 'done' &&
            results.length > 0 &&
            (() => {
              const hasAnyFail = results.some(r => !isFramePass(r));
              const failCount = results.filter(r => !isFramePass(r)).length;

              return (
                <div
                  className={`text-center py-4 rounded-2xl border ${
                    hasAnyFail
                      ? 'bg-[var(--coral-dim)] border-[var(--coral-border)] text-[var(--coral)]'
                      : 'bg-[var(--cyan-dim)] border-[var(--cyan-border)] text-[var(--cyan)]'
                  }`}
                >
                  <div className="text-2xl font-bold">{hasAnyFail ? '❌ FAIL' : '✅ PASS'}</div>
                  <div className="text-xs mt-1 opacity-70">
                    {hasAnyFail ? `${failCount}/${results.length} 帧未通过` : `全部 ${results.length} 帧通过`}
                  </div>
                </div>
              );
            })()}

          {currentResult && (
            <FrameTestPreview
              currentResult={currentResult}
              selectedFrame={selectedFrame}
              setSelectedFrame={setSelectedFrame}
              results={results}
            />
          )}

          {results.length > 0 && (
            <FrameTestReportTable results={results} selectedFrame={selectedFrame} setSelectedFrame={setSelectedFrame} />
          )}
        </div>
      </div>
    </div>
  );
}
