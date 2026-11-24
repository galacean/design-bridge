import { useInputFiles } from '../../../features/local-inputs/use-input-files';
import { saveGEOutput } from '../../../features/local-inputs/save-ge-output';
import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import LottiePlayer from './lottie-player';
import type { LottiePlayerHandle } from './lottie-player';
import EffectsPlayer from '../../../features/ge-preview/effects-player';
import { useLottieConverter } from '../hooks/use-lottie-converter';

function generateFilePrefix(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const r = crypto.randomUUID();

  return `${y}${m}${d}-${r}`;
}

export default function ConvertPanel() {
  const { state, actions } = useLottieConverter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lottieRef = useRef<LottiePlayerHandle>(null);

  // Sidebar file list
  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('lottie');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMsg, setExportMsg] = useState('');
  const [exportFailed, setExportFailed] = useState(false);

  useEffect(() => {
    if (fileListError != null) {
      setExportMsg(fileListError);
      setExportFailed(true);
    }
  }, [fileListError]);

  const loadInputFile = useCallback(
    async (fileName: string) => {
      setActiveFile(fileName);
      await actions.loadInputFile(fileName);
    },
    [actions],
  );

  const exportAsJson = useCallback(async () => {
    if (!state.effectsData) {return;}
    setExportMsg('正在保存...');
    setExportFailed(false);
    try {
      const prefix = generateFilePrefix();
      const effectsStr = JSON.stringify(state.effectsData, null, 2);
      const res = await fetch('/api/lottie2ge/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: `tmp/output/${prefix}-effects.json`,
          content: effectsStr,
        }),
      });
      const data = (await res.json()) as { success: boolean };

      if (data.success) {
        setExportMsg(`已保存: tmp/output/${prefix}-effects.json`);
        void loadFileList();
      } else {
        setExportFailed(true);
        setExportMsg('保存失败');
      }
    } catch {
      setExportFailed(true);
      setExportMsg('保存失败');
    }
  }, [state.effectsData, loadFileList]);

  const saveSceneWithImages = useCallback(async () => {
    if (!state.effectsData) {return;}
    setExportMsg('正在保存...');
    setExportFailed(false);
    try {
      const prefix = generateFilePrefix();
      const outputDir = `tmp/output/${prefix}`;

      await saveGEOutput(state.effectsData, outputDir);
      setExportMsg(`已保存: ${outputDir}/`);
      void loadFileList();
    } catch (error) {
      setExportFailed(true);
      setExportMsg(error instanceof Error ? error.message : '保存失败');
    }
  }, [state.effectsData, loadFileList]);

  const [displayWidth, displayHeight] = useMemo(() => {
    if (!state.lottieData) {return [320, 320];}
    const w = Number(state.lottieData.w);
    const h = Number(state.lottieData.h);

    if (!w || !h) {return [320, 320];}
    const maxSize = 320;
    const ratio = w / h;

    return ratio >= 1 ? [maxSize, Math.round(maxSize / ratio)] : [Math.round(maxSize * ratio), maxSize];
  }, [state.lottieData]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];

    if (file?.name.endsWith('.json')) {void actions.loadFromFile(file);}
  };

  const statusColor =
    state.status === 'error'
      ? 'text-[var(--coral)]'
      : state.status === 'success'
        ? 'text-[var(--cyan)]'
        : 'text-[var(--color-text-secondary)]';

  return (
    <div
      className="ui-workspace"
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* Sidebar */}
      <aside className="ui-soft-panel ui-file-sidebar">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-[13px] leading-[1.45] font-semibold text-[var(--color-text-emphasis)]">
          <span>Input 文件</span>
          <button onClick={() => { void loadFileList(); }} className="ui-btn ui-btn-icon" title="刷新列表">
            ↻
          </button>
        </div>
        <div className="px-3 py-2 border-b border-[var(--border)]">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            aria-label="搜索文件"
            className="ui-input w-full px-2.5 py-1.5 text-[12px] leading-[1.4]"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-2 text-[13px] leading-[1.45]">
          {fileList.length === 0 ? (
            <div className="px-4 py-3 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
              暂无文件
            </div>
          ) : (
            fileList
              .filter(f => !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase()))
              .map(f => (
                <button
                  key={f}
                  onClick={() => { void (loadInputFile(f)); }}
                  title={f}
                  aria-current={activeFile === f ? 'true' : undefined}
                  className="ui-soft-file w-full truncate px-3 py-2 text-left"
                >
                  {f}
                </button>
              ))
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="ui-workspace-content">

        {/* Input area */}
        <div className="ui-card space-y-3 shadow-sm">
          <div className="flex gap-2">
            <input
              type="text"
              value={state.urlInput}
              onChange={e => actions.setUrlInput(e.target.value)}
              onKeyDown={e => { void (e.key === 'Enter' && actions.loadFromUrl(state.urlInput.trim())); }}
              placeholder="输入 Lottie JSON 的 URL 地址..."
              className="ui-input min-w-0 flex-1 px-3 text-[13px] leading-[1.45]"
            />
            <button
              onClick={() => { void (actions.loadFromUrl(state.urlInput.trim())); }}
              disabled={!state.urlInput.trim()}
              className="ui-btn ui-btn-secondary"
            >
              从 URL 加载
            </button>
          </div>

          <textarea
            value={state.inputJson}
            onChange={e => actions.setInputJson(e.target.value)}
            placeholder="粘贴 Lottie JSON 内容，或点击「选择文件」上传，或从 URL 加载..."
            rows={5}
            className="ui-textarea w-full resize-y px-3 py-2 font-mono text-[12px] leading-[1.4]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { void (actions.doConvert(state.inputJson.trim())); }}
              disabled={!state.inputJson.trim() || state.status === 'converting'}
              className="ui-btn ui-btn-primary"
            >
              转换并预览
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="ui-btn ui-btn-secondary">
              选择文件
            </button>
            <button onClick={() => { void saveSceneWithImages(); }} disabled={!state.effectsData} className="ui-btn ui-btn-violet">
              保存场景与图片
            </button>
            <button onClick={() => { void exportAsJson(); }} disabled={!state.effectsData} className="ui-btn ui-btn-gold">
              导出 JSON
            </button>
            <button
              onClick={() => {
                actions.clear();
                setActiveFile(null);
                setExportMsg('');
                setExportFailed(false);
              }}
              className="ui-btn ui-btn-ghost"
            >
              清空
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];

                if (file) {
                  setActiveFile(file.name);
                  void actions.loadFromFile(file);
                }
                e.target.value = '';
              }}
            />
            {(state.message || exportMsg) && (
              <span
                role={exportFailed ? 'alert' : 'status'}
                className={`ml-2 text-[12px] leading-[1.4] ${exportMsg ? exportFailed ? 'text-[var(--coral)]' : 'text-[var(--cyan)]' : statusColor}`}
              >
                {exportMsg || state.message}
              </span>
            )}
          </div>

          {state.diagnostics.length > 0 && (
            <details className="text-[12px] leading-[1.4] text-[var(--color-text-warning)]">
              <summary className="cursor-pointer">转换诊断 ({state.diagnostics.length})</summary>
              <ul className="mt-1 space-y-0.5 pl-3 text-[var(--color-text-warning)]">
                {state.diagnostics.map((diagnostic, i) => (
                  <li key={`${diagnostic.code}-${diagnostic.sourceId ?? 'root'}-${i}`}>
                    [{diagnostic.severity}/{diagnostic.action}] {diagnostic.code}: {diagnostic.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* File name */}
        {activeFile && state.status === 'success' && (
          <div className="ui-card-compact">
            <div className="text-center text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
              当前文件：{activeFile}
            </div>
          </div>
        )}

        {/* Preview area */}
        <div className="ui-card">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">预览</h4>
            <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">原始 Lottie · GE 对照</span>
          </div>
          <div className="grid grid-cols-2 justify-items-center gap-3 max-[767px]:grid-cols-1">
            <div
              className="flex w-full min-w-0 flex-col items-center gap-2"
              style={{ maxWidth: `calc(max(220px, 100dvh - 560px) * ${displayWidth / displayHeight})` }}
            >
              <div className="ui-badge ui-badge-gold">Lottie 原始</div>
              <LottiePlayer
                ref={lottieRef}
                animationData={state.lottieData as Record<string, unknown> | null}
                width={displayWidth}
                height={displayHeight}
                autoplay={!state.effectsData}
                fitContainer
              />
              {state.lottieData && (
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  {Number(state.lottieData.fr)}fps · {Number(state.lottieData.w)}×{Number(state.lottieData.h)}
                </span>
              )}
            </div>

            <div
              className="flex w-full min-w-0 flex-col items-center gap-2"
              style={{ maxWidth: `calc(max(220px, 100dvh - 560px) * ${displayWidth / displayHeight})` }}
            >
              <div className="ui-badge ui-badge-cyan">Galacean Effects</div>
              <EffectsPlayer
                effectsData={state.result?.effectsData ?? null}
                width={displayWidth}
                height={displayHeight}
                onReady={() => lottieRef.current?.goToAndPlay(0)}
                fitContainer
              />
              {state.result && (
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  {state.result.ms}ms
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
