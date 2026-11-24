import { readGESceneMetadata } from '../../features/ge-preview/read-scene-metadata';
import { useInputFiles } from '../../features/local-inputs/use-input-files';
import { readInputText } from '../../features/local-inputs/input-api';
import { useInputRequest } from '../../features/local-inputs/use-input-request';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { convertDSLToGE } from '../../features/dsl-conversion/ge-dsl-workflow';
import type { Composition } from '@galacean/dsl-ir';
import EffectsPlayer from '../../features/ge-preview/effects-player';
import WorkbenchHeader from '../../components/workbench-header';

export default function DslToGE() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [inputJson, setInputJson] = useState('');
  const [effectsData, setEffectsData] = useState<Record<string, unknown> | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const [convertTime, setConvertTime] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sidebar file list state
  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('dsl');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (fileListError != null) {
      setStatusMsg(fileListError);
      setIsError(true);
    }
  }, [fileListError]);

  const doConvertAndRender = useCallback((jsonStr: string) => {
    cancelRequest();
    try {
      const dsl = JSON.parse(jsonStr) as Composition;
      const t0 = performance.now();
      const { scene } = convertDSLToGE(dsl);
      const GEScene = scene as unknown as Record<string, unknown>;
      const elapsed = performance.now() - t0;

      setEffectsData(GEScene);
      setConvertTime(elapsed);
      setStatusMsg(`转换成功 (${elapsed.toFixed(1)}ms)`);
      setIsError(false);
    } catch (err) {
      setIsError(true);
      const retainedMessage = effectsData == null ? '' : '；已保留上一次成功结果';

      setStatusMsg(`转换失败：${(err as Error).message}${retainedMessage}`);
    }
  }, [cancelRequest, effectsData]);

  const loadFromFile = useCallback(
    async (file: File) => {
      const signal = beginRequest();

      setActiveFile(file.name);
      try {
        const content = await file.text();

        if (signal.aborted) {
          return;
        }

        setInputJson(content);
        doConvertAndRender(content);
      } catch (error) {
        if (!signal.aborted) {
          setIsError(true);
          setStatusMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, doConvertAndRender],
  );

  const loadInputFile = useCallback(
    async (fileName: string) => {
      const signal = beginRequest();

      setActiveFile(fileName);
      try {
        const content = await readInputText('dsl', fileName, signal);

        if (signal.aborted) {
          return;
        }

        setInputJson(content);
        doConvertAndRender(content);
      } catch (error) {
        if (!signal.aborted) {
          setIsError(true);
          setStatusMsg(`加载失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, doConvertAndRender],
  );

  const downloadEffectsJson = useCallback(() => {
    if (!effectsData) {
      return;
    }
    const blob = new Blob([JSON.stringify(effectsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'ge-output.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [effectsData]);

  const clear = () => {
    cancelRequest();
    setActiveFile(null);
    setInputJson('');
    setEffectsData(null);
    setStatusMsg('');
    setIsError(false);
    setConvertTime(null);
  };

  const [renderWidth, renderHeight] = useMemo(() => {
    if (!effectsData) {
      return [500, 500];
    }
    const size = readGESceneMetadata(effectsData).previewSize;

    if (size != null) {
      return [size.width, size.height];
    }

    return [500, 500];
  }, [effectsData]);

  const itemCount = effectsData ? ((effectsData['items'] as unknown[]) ?? []).length : 0;
  const imageCount = effectsData ? ((effectsData['images'] as unknown[]) ?? []).length : 0;

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell dsl2ge-workbench">
        <WorkbenchHeader title="DSL 转换" description="加载或编辑 DSL，预览并导出 GE 场景。" />

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
            <div className="ui-card dsl-source-editor space-y-3">
              <textarea
                aria-label="DSL JSON"
                value={inputJson}
                onChange={e => { cancelRequest(); setInputJson(e.target.value); }}
                placeholder="粘贴 DSL JSON 内容，或点击「选择文件」上传，或拖拽 JSON 文件到此区域..."
                rows={5}
                className="ui-textarea w-full resize-y px-3 py-2 font-mono text-[12px] leading-[1.4]"
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => doConvertAndRender(inputJson.trim())}
                  disabled={!inputJson.trim()}
                  className="ui-btn ui-btn-primary"
                >
                  转换并渲染
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="ui-btn ui-btn-secondary">
                  选择文件
                </button>
                <button onClick={downloadEffectsJson} disabled={!effectsData} className="ui-btn ui-btn-secondary">
                  下载 GE JSON
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
                {statusMsg && (
                  <span
                    className={`ml-2 text-[12px] leading-[1.4] ${isError ? 'text-[var(--coral)]' : 'text-[var(--cyan)]'}`}
                  >
                    {statusMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Current file indicator */}
            {activeFile && effectsData && (
              <div className="ui-card-compact">
                <div className="flex flex-wrap items-center justify-center gap-4 text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
                  <span>当前文件：{activeFile}</span>
                  <span>
                    Items: <strong className="text-[var(--color-text-primary)]">{itemCount}</strong>
                  </span>
                  <span>
                    Images: <strong className="text-[var(--color-text-primary)]">{imageCount}</strong>
                  </span>
                  <span>
                    Size:{' '}
                    <strong className="text-[var(--color-text-primary)]">
                      {renderWidth}x{renderHeight}
                    </strong>
                  </span>
                  {convertTime != null && (
                    <span>
                      Time: <strong className="text-[var(--color-text-primary)]">{convertTime.toFixed(1)}ms</strong>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Preview area */}
            <div className="ui-card min-w-0">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">渲染预览</h4>
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  Galacean Effects Runtime
                </span>
              </div>
              <div className="flex min-w-0 flex-col items-center gap-2">
                <EffectsPlayer
                  effectsData={effectsData}
                  width={renderWidth}
                  height={renderHeight}
                  showInfo
                  fitContainer
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
