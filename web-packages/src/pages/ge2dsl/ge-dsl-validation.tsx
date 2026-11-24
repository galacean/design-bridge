import { useInputFiles } from '../../features/local-inputs/use-input-files';
import { readInputText } from '../../features/local-inputs/input-api';
import { useInputRequest } from '../../features/local-inputs/use-input-request';
import { readGESceneMetadata } from '../../features/ge-preview/read-scene-metadata';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import EffectsPlayer from '../../features/ge-preview/effects-player';
import WorkbenchHeader from '../../components/workbench-header';
import { convertGEInputRoundTrip } from './convert-ge-input-round-trip';

export default function GEToDSL() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [inputJson, setInputJson] = useState('');
  const [frameRate, setFrameRate] = useState(30);
  const [comparison, setComparison] = useState<ReturnType<typeof convertGEInputRoundTrip> | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('ge');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (fileListError != null) {
      setStatusMsg(fileListError);
      setIsError(true);
    }
  }, [fileListError]);

  const doConvert = useCallback((json: string) => {
    cancelRequest();
    setInputJson(json);
    try {
      const result = convertGEInputRoundTrip(json, frameRate, window.location.href);

      setComparison(result);
      setIsError(result.error != null);
      setStatusMsg(result.error ?? `保真往返完成 · ${result.elapsedMs.toFixed(1)}ms · ${result.diagnostics.length} 条诊断`);
    } catch (error) {
      setComparison(null);
      setIsError(true);
      setStatusMsg(`读取 GE 失败：${readErrorMessage(error)}`);
    }
  }, [cancelRequest, frameRate]);

  const loadFromFile = useCallback(async (file: File) => {
    const signal = beginRequest();

    setActiveFile(file.name);
    try {
      const content = await file.text();

      if (!signal.aborted) {
        doConvert(content);
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      setComparison(null);
      setIsError(true);
      setStatusMsg(`读取 GE 失败：${readErrorMessage(error)}`);
    }
  }, [beginRequest, doConvert]);

  const loadInputFile = useCallback(async (fileName: string) => {
    const signal = beginRequest();

    setActiveFile(fileName);
    try {
      const content = await readInputText('ge', fileName, signal);

      if (!signal.aborted) {
        doConvert(content);
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      setComparison(null);
      setInputJson('');
      setIsError(true);
      setStatusMsg(`读取 GE 失败：${readErrorMessage(error)}`);
    }
  }, [beginRequest, doConvert]);

  const clear = () => {
    cancelRequest();
    setInputJson('');
    setComparison(null);
    setStatusMsg('');
    setIsError(false);
    setActiveFile(null);
  };

  const previewSize = useMemo(() => {
    const data = comparison?.source;
    const size = readGESceneMetadata(data).previewSize;
    const aspect = size == null ? 1 : size.width / size.height;
    const height = Math.min(560, 720 / aspect);

    return { width: Math.round(height * aspect), height: Math.round(height) };
  }, [comparison]);

  const filteredFiles = fileList.filter(file => file.toLowerCase().includes(searchQuery.toLowerCase()));
  const diagnostics = comparison?.diagnostics ?? [];

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell ge2dsl-workbench">
        <WorkbenchHeader title="GE ↔ DSL 验证" description="以原始 GE 为基准，手动对比 GE ↔ DSL 保真往返的渲染结果。" />

        <div
          className="ui-workspace"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];

            if (file?.name.endsWith('.json')) {
              void loadFromFile(file);
            }
          }}
        >
          {/* Sidebar */}
          <aside className="ui-soft-panel ui-file-sidebar">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-[13px] leading-[1.45] font-semibold text-[var(--color-text-emphasis)]">
              <span>GE 输入文件</span>
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
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-3 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  暂无文件
                </div>
              ) : (
                filteredFiles.map(f => (
                  <button
                    key={f}
                    onClick={() => { void loadInputFile(f); }}
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
            {/* Toolbar */}
            <div className="ui-card ui-workspace-wide space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="ge-dsl-fps" className="text-[13px] text-[var(--color-text-secondary)]">转换帧率</label>
                <input id="ge-dsl-fps" type="number" min={1} max={120} value={frameRate}
                  onChange={event => {
                    cancelRequest();
                    setFrameRate(Math.max(1, Number(event.target.value) || 30));
                  }}
                  className="ui-input w-20 px-2 py-1 text-[12px] leading-[1.4]" />
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  fps（GE 中不存储帧率，需手动指定）
                </span>
                <div className="flex-1" />
                <button onClick={() => fileInputRef.current?.click()} className="ui-btn ui-btn-secondary">
                  选择文件
                </button>
                <button onClick={clear} className="ui-btn ui-btn-ghost">
                  清空
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  title="选择 JSON 文件"
                  aria-label="选择 JSON 文件"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];

                    if (file) {
                      void loadFromFile(file);
                    }
                    e.target.value = '';
                  }}
                />
              </div>
              {statusMsg && (
                <div className={`text-[12px] leading-[1.4] ${isError ? 'text-[var(--coral)]' : 'text-[var(--cyan)]'}`}>
                  {statusMsg}
                </div>
              )}
            </div>

            <div className="ui-card dsl-source-editor flex flex-col min-w-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-emphasis)]">
                    输入 GE
                  </h3>
                  <p className="mt-1 text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                    修改 GE 后重新转换，同时更新基准 GE 与往返 GE。
                  </p>
                </div>
                <button onClick={() => doConvert(inputJson)} disabled={inputJson.trim() === ''}
                  className="ui-btn ui-btn-primary shrink-0 whitespace-nowrap">
                  转换并对比
                </button>
              </div>
              <textarea
                aria-label="GE JSON"
                value={inputJson}
                onChange={e => { cancelRequest(); setInputJson(e.target.value); }}
                placeholder="选择文件、拖入文件或粘贴 GE JSON。修改后点击「转换并对比」。"
                className="ui-textarea h-[280px] w-full resize-y px-3 py-2 font-mono text-[12px] leading-[1.45]"
                spellCheck={false}
              />
            </div>

            {/* Two-column preview row */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 max-[900px]:grid-cols-1">
              <div className="ui-card flex min-w-0 flex-col overflow-hidden">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">
                      基准 GE
                    </h4>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">原始 GE，作为往返对比基准</p>
                  </div>
                  <span className="ui-badge ui-badge-gold ui-badge-tag shrink-0 whitespace-nowrap">原始输入</span>
                </div>
                <div className="mt-auto flex min-w-0 flex-col items-center gap-2">
                  <EffectsPlayer
                    effectsData={comparison?.source ?? null}
                    width={previewSize.width}
                    height={previewSize.height}
                    showInfo
                    fitContainer
                  />
                </div>
              </div>

              <div className="ui-card flex min-w-0 flex-col overflow-hidden">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">
                      往返 GE
                    </h4>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      基准 GE → IR → DSL → IR → GE，携带保真数据
                    </p>
                  </div>
                  <span className="ui-badge ui-badge-cyan ui-badge-tag shrink-0 whitespace-nowrap">保真往返</span>
                </div>
                <div className="mt-auto flex min-w-0 flex-col items-center gap-2">
                  <EffectsPlayer
                    effectsData={comparison?.scene ?? null}
                    width={previewSize.width}
                    height={previewSize.height}
                    showInfo
                    fitContainer
                  />
                </div>
              </div>
            </div>

            {/* Diagnostics */}
            {diagnostics.length > 0 && (
              <details className="ui-workspace-wide space-y-3">
                <summary className="cursor-pointer py-2 text-[12px] text-[var(--workbench-muted)]">
                  往返转换诊断（{diagnostics.length}）
                </summary>
                <div className="ui-card">
                  <div className="max-h-[260px] overflow-y-auto text-[12px] leading-[1.6] font-mono text-[var(--color-text-secondary)]">
                    {diagnostics.map((d, i) => (
                      <div key={i} className="flex gap-2 border-b border-[var(--border)] py-1 px-2">
                        <span className={d.severity === 'warning' ? 'text-[var(--coral)]' : 'text-[var(--sky)]'}>
                          [{d.severity}]
                        </span>
                        <span className="text-[var(--color-text-primary)]">{`${d.code}${d.sourceId != null ? ` · ${d.sourceId}` : ''}`}</span>
                        <span>{d.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
