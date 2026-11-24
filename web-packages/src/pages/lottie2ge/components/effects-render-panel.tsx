import { readGESceneMetadata } from '../../../features/ge-preview/read-scene-metadata';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import EffectsPlayer from '../../../features/ge-preview/effects-player';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';

export default function EffectsRenderPanel() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const { beginRequest: beginListRequest } = useInputRequest();
  const [inputJson, setInputJson] = useState('');
  const [isEditing, setIsEditing] = useState(true);
  const [urlInput, setUrlInput] = useState('');
  const [effectsData, setEffectsData] = useState<Record<string, unknown> | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sidebar file list
  const [fileList, setFileList] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const loadFileList = useCallback(async () => {
    const signal = beginListRequest();

    try {
      const res = await fetch('/api/lottie2ge/list-output', { signal });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { files?: string[]; dirs?: string[] };
      // 合并顶层 JSON 文件和子目录（含 result.json 的）
      const items = [...(data.dirs ?? []), ...(data.files ?? [])];

      if (!signal.aborted) {
        setFileList(items);
      }
    } catch (error) {
      if (!signal.aborted) {
        setStatusMsg(`文件列表加载失败：${error instanceof Error ? error.message : String(error)}`);
        setIsError(true);
      }
    }
  }, [beginListRequest]);

  useEffect(() => {
    void loadFileList();
  }, [loadFileList]);

  const loadOutputFile = useCallback(async (name: string) => {
    const signal = beginRequest();

    setActiveFile(name);
    setStatusMsg(`正在加载 ${name}...`);
    setIsError(false);
    try {
      // 子目录读 result.json，顶层 JSON 文件直接读
      const apiPath = name.endsWith('.json')
        ? `/api/lottie2ge/read-output/${encodeURIComponent(name)}`
        : `/api/lottie2ge/read-output/${encodeURIComponent(name)}/result.json`;
      const res = await fetch(apiPath, { signal });

      if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
      const data = JSON.parse(await res.text()) as Record<string, unknown>;

      if (signal.aborted) {
        return;
      }

      // 将 images 中的相对路径转为可访问的绝对 URL
      if (!name.endsWith('.json')) {
        const images = data.images as Array<{ url: string }> | undefined;

        if (images) {
          for (const img of images) {
            if (img.url && !img.url.startsWith('data:') && !img.url.startsWith('http')) {
              img.url = `/api/lottie2ge/read-output-asset/${encodeURIComponent(name)}/${img.url}`;
            }
          }
        }
      }

      setInputJson(JSON.stringify(data, null, 2));
      setEffectsData(data);
      setIsEditing(false);
      setStatusMsg('');
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      setIsError(true);
      setStatusMsg((err as Error).message);
    }
  }, [beginRequest]);

  const doRender = useCallback((jsonStr: string) => {
    cancelRequest();
    try {
      const data = JSON.parse(jsonStr) as Record<string, unknown>;

      setEffectsData(data);
      setIsEditing(false);
      setStatusMsg('');
      setIsError(false);
    } catch (err) {
      setIsError(true);
      setStatusMsg((err as Error).message);
    }
  }, [cancelRequest]);

  const loadFromUrl = useCallback(
    async (url: string) => {
      const signal = beginRequest();

      setStatusMsg('正在从 URL 加载...');
      setIsError(false);
      try {
        const res = await fetch(url, { signal });

        if (!res.ok) {throw new Error(`HTTP ${res.status}: ${res.statusText}`);}
        const content = await res.text();

        if (signal.aborted) {
          return;
        }

        JSON.parse(content);
        setInputJson(content);
        doRender(content);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setIsError(true);
        setStatusMsg(`URL 加载失败: ${(err as Error).message}`);
      }
    },
    [beginRequest, doRender],
  );

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
        doRender(content);
      } catch (error) {
        if (!signal.aborted) {
          setIsError(true);
          setStatusMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, doRender],
  );

  const [renderWidth, renderHeight] = useMemo(() => {
    if (!effectsData) {return [320, 320];}
    const size = readGESceneMetadata(effectsData).previewSize ?? { width: 320, height: 320 };
    const w = size.width;
    const h = size.height;
    const maxSize = 320;
    const ratio = w / h;

    return ratio >= 1 ? [maxSize, Math.round(maxSize / ratio)] : [Math.round(maxSize * ratio), maxSize];
  }, [effectsData]);

  const clear = () => {
    cancelRequest();
    setInputJson('');
    setIsEditing(true);
    setUrlInput('');
    setEffectsData(null);
    setStatusMsg('');
    setIsError(false);
    setActiveFile(null);
  };

  return (
    <div
      className="ui-workspace"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];

        if (file?.name.endsWith('.json')) {void loadFromFile(file);}
      }}
    >
      {/* Sidebar */}
      <aside className="ui-soft-panel ui-file-sidebar">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 font-semibold text-[var(--color-text-emphasis)]">
          <span>Output 文件</span>
          <button onClick={() => { void loadFileList(); }} className="ui-btn ui-btn-icon" title="刷新列表">
            ↻
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-2 text-[13px] leading-[1.45]">
          {fileList.length === 0 ? (
            <div className="px-4 py-6 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
              暂无文件
            </div>
          ) : (
            fileList.map(f => (
              <button
                key={f}
                onClick={() => { void (loadOutputFile(f)); }}
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
        <div className="flex min-w-0 flex-col gap-3">

          {/* Input area */}
          <div className="ui-card space-y-3 shadow-sm">
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={e => { cancelRequest(); setUrlInput(e.target.value); }}
                onKeyDown={e => { void (e.key === 'Enter' && loadFromUrl(urlInput.trim())); }}
                placeholder="输入 GE JSON 的 URL 地址..."
                className="ui-input min-w-0 flex-1 px-3 text-[13px] leading-[1.45]"
              />
              <button
                onClick={() => { void (loadFromUrl(urlInput.trim())); }}
                disabled={!urlInput.trim()}
                className="ui-btn ui-btn-secondary"
              >
                从 URL 加载
              </button>
            </div>

            {/* Keep large scene text out of browser layout while previewing. */}
            {isEditing && (
              <textarea
                id="ge-render-json"
                aria-label="GE JSON"
                value={inputJson}
                spellCheck={false}
                wrap="off"
                onChange={e => { cancelRequest(); setInputJson(e.target.value); }}
                placeholder="粘贴 GE JSON 内容，或点击「选择文件」上传，或从左侧列表选择..."
                rows={5}
                className="ui-textarea w-full resize-y px-3 py-2 font-mono text-[12px] leading-[1.4]"
              />
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setIsEditing(value => !value)}
                className="ui-btn ui-btn-secondary"
                aria-expanded={isEditing}
                aria-controls="ge-render-json"
              >
                {isEditing ? '收起 JSON' : '编辑 JSON'}
              </button>
              <button
                onClick={() => doRender(inputJson.trim())}
                disabled={!inputJson.trim()}
                className="ui-btn ui-btn-primary"
              >
                渲染预览
              </button>
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
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];

                  if (file) {
                    setActiveFile(file.name);
                    void loadFromFile(file);
                  }
                  e.target.value = '';
                }}
              />
              {statusMsg && (
                <span
                  className={`ml-2 text-[12px] leading-[1.4] ${isError ? 'text-[var(--coral)]' : 'text-[var(--color-text-secondary)]'} `}
                >
                  {statusMsg}
                </span>
              )}
            </div>
          </div>

          {/* Preview */}
          <div className="ui-card min-w-0">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">渲染预览窗口</h4>
              <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                Galacean Effects Runtime
              </span>
            </div>
            <div className="flex min-w-0 flex-col items-center gap-2">
              <div className="ui-badge ui-badge-cyan">Galacean Effects</div>
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
  );
}
