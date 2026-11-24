import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  createVirtualProject,
  extractSceneDocumentFromProject,
} from '@galacean/html2figma/browser';
import type { SceneResult, VirtualProject, VirtualProjectFile } from '@galacean/html2figma/browser';
import ThemeModeDropdown from '../../components/theme-mode-dropdown';
import { partitionSceneConversionResults } from './conversion-results';

type ConversionMode = 'browser' | 'playwright';

interface ServerConversionResponse {
  diagnosticCount?: number;
  count: number;
  scenes: SceneResult[];
}

function sceneName(fileName: string): string {
  return fileName.replace(/\.(html?|zip)$/i, '');
}

export default function HtmlToFigma() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [scenes, setScenes] = useState<SceneResult[] | null>(null);
  const [figmaHtml, setFigmaHtml] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);
  const [conversionMode, setConversionMode] = useState<ConversionMode>('browser');
  const [disableLocalScripts, setDisableLocalScripts] = useState(false);
  const [rasterizeSyntheticText, setRasterizeSyntheticText] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [diagnosticCount, setDiagnosticCount] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'loading' | 'copied'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'loading' | 'downloaded'>('idle');
  const [jsonCopied, setJsonCopied] = useState(false);
  const [schemaStatus, setSchemaStatus] = useState<'checking' | 'ok' | 'missing' | 'error'>('checking');
  const isBusy = isConverting || downloadState === 'loading';

  const fileInputRef = useRef<HTMLInputElement>(null);

  const checkSchema = useCallback(async () => {
    try {
      const resp = await fetch('/api/html2figma/check-schema');
      const { hasSchema } = await resp.json();

      if (hasSchema) {
        setSchemaStatus('ok');
      } else {
        setSchemaStatus('missing');
      }
    } catch {
      setSchemaStatus('error');
    }
  }, []);

  useEffect(() => {
    if (conversionMode === 'browser') {
      setSchemaStatus('ok');
    } else {
      setSchemaStatus('checking');
      void checkSchema();
    }
  }, [checkSchema, conversionMode]);

  const handleFiles = (files: File[]) => {
    if (isBusy) {
      return;
    }

    const valid = files.filter(f => {
      const name = f.name.toLowerCase();

      return name.endsWith('.zip') || name.endsWith('.html') || name.endsWith('.htm');
    });

    if (valid.length === 0) {return;}
    setSelectedFiles(valid);
    setError(null);
    setScenes(null);
    setFigmaHtml(null);
    setProgress(null);
    setCopyState('idle');
    setDownloadState('idle');
    setDiagnosticCount(0);
  };

  const handleConvert = async () => {
    if (selectedFiles.length === 0) {return;}
    setIsConverting(true);
    setProgress({ percent: 20, text: conversionMode === 'browser' ? '浏览器处理中...' : '上传转换中...' });
    setError(null);
    setScenes(null);
    setFigmaHtml(null);
    setCopyState('idle');
    setDownloadState('idle');
    setDiagnosticCount(0);

    try {
      const results = conversionMode === 'browser' ? await convertInBrowser() : await convertWithPlaywright();
      const { successfulScenes, failedScenes, failureMessage } = partitionSceneConversionResults(results.scenes);

      if (successfulScenes.length === 0) {
        throw new Error(failureMessage || '没有找到可转换的 HTML 场景。');
      }

      setScenes(results.scenes);
      setDiagnosticCount(results.diagnosticCount);
      setProgress({ percent: 100, text: `转换完成，共 ${successfulScenes.length} 个场景` });
      if (failedScenes.length > 0) {
        setError(failureMessage);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    } finally {
      setIsConverting(false);
    }
  };

  const convertWithPlaywright = async (): Promise<{ scenes: SceneResult[]; diagnosticCount: number }> => {
      const formData = new FormData();

      selectedFiles.forEach(file => formData.append('files', file));
      formData.append('viewport', isDesktop ? 'desktop' : 'mobile');
      formData.append('rasterizeSyntheticText', String(rasterizeSyntheticText));

      const response = await fetch('/api/html2figma/convert', { method: 'POST', body: formData });

      if (!response.ok) {throw new Error(`Server error: ${response.statusText}`);}

      const result = (await response.json()) as ServerConversionResponse;

      setProgress({ percent: 70, text: `正在转换 ${result.count} 个文件...` });

      const cleanScenes = result.scenes.map(scene => ({
        name: scene.name,
        error: scene.error,
        sceneData: scene.sceneData ? structuredClone(scene.sceneData) : undefined,
      }));

      return { scenes: cleanScenes, diagnosticCount: result.diagnosticCount ?? 0 };
  };

  const convertInBrowser = async (): Promise<{ scenes: SceneResult[]; diagnosticCount: number }> => {
    const scenes: SceneResult[] = [];
    let diagnostics = 0;

    for (let index = 0; index < selectedFiles.length; index++) {
      const file = selectedFiles[index];
      const lowerName = file.name.toLowerCase();

      setProgress({
        percent: 20 + Math.round((index / selectedFiles.length) * 60),
        text: `浏览器处理中：${file.name}`,
      });

      if (lowerName.endsWith('.zip')) {
        const { createVirtualProjectFromZip } = await import('@galacean/html2figma/browser/zip');
        const project = await createVirtualProjectFromZip(file);
        const entries = Array.from(project.files.values()).filter(entry => /\.html?$/i.test(entry.path));

        for (const entry of entries) {
          const entryProject = createVirtualProject(project.files.values(), entry.path);
          const result = await convertBrowserProject(entryProject, entry.path);

          scenes.push(result.scene);
          diagnostics += result.diagnosticCount;
        }
        continue;
      }

      const projectFile: VirtualProjectFile = {
        path: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        mimeType: file.type || 'text/html',
      };
      const result = await convertBrowserProject(createVirtualProject([projectFile], projectFile.path), file.name);

      scenes.push(result.scene);
      diagnostics += result.diagnosticCount;
    }

    return { scenes, diagnosticCount: diagnostics };
  };

  const convertBrowserProject = async (
    project: VirtualProject,
    name: string,
  ): Promise<{ scene: SceneResult; diagnosticCount: number }> => {
    try {
      const document = await extractSceneDocumentFromProject(project, {
        viewport: isDesktop ? { width: 1280, height: 1024 } : { width: 390, height: 844 },
        scriptPolicy: disableLocalScripts ? 'disabled' : 'sandboxed',
        rasterizeSyntheticText,
      });

      return {
        scene: { name: sceneName(name), sceneData: document.root },
        diagnosticCount: document.diagnostics.length,
      };
    } catch (err: unknown) {
      return {
        scene: { name: sceneName(name), error: err instanceof Error ? err.message : String(err) },
        diagnosticCount: 1,
      };
    }
  };

  const handleCopyFigma = async () => {
    if (!scenes) {return;}
    setCopyState('loading');
    try {
      let html: string;

      if (conversionMode === 'browser') {
        const { createFigmaClipboardInBrowser } = await import('@galacean/html2figma/browser/clipboard');
        const result = await createFigmaClipboardInBrowser(scenes, { localFontAccess: 'required' });

        html = result.html;
      } else {
        const resp = await fetch('/api/html2figma/generate-figma-clipboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenes }),
        });

        if (!resp.ok) {
          const payload = (await resp.json()) as { error?: string };

          throw new Error(payload.error || resp.statusText);
        }
        const payload = (await resp.json()) as { html: string };

        html = payload.html;
      }

      setFigmaHtml(html);

      const { writeFigmaClipboardHTML } = await import('@galacean/html2figma/browser/clipboard');

      await writeFigmaClipboardHTML(html);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setCopyState('idle');
    }
  };

  const handleCopyJson = async () => {
    if (!scenes) {return;}
    const json = JSON.stringify({ type: 'html2figma', scenes });

    try {
      await navigator.clipboard.writeText(json);
    } catch {
      const ta = document.createElement('textarea');

      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  };

  const handleDownloadFigma = async () => {
    if (!scenes) {return;}
    setDownloadState('loading');
    setError(null);

    try {
      const documentName = selectedFiles.length === 1 ? sceneName(selectedFiles[0].name) : 'html2figma';
      let bytes: Uint8Array;

      if (conversionMode === 'browser') {
        const { createFigmaFileInBrowser } = await import('@galacean/html2figma/browser/file');
        const result = await createFigmaFileInBrowser(scenes, {
          documentName,
          localFontAccess: 'required',
        });

        if (!result.validation.valid) {
          throw new Error(result.validation.errors.join('；') || '生成的 .fig 未通过结构校验');
        }
        bytes = result.bytes;
      } else {
        const response = await fetch('/api/html2figma/generate-figma-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scenes, documentName }),
        });

        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };

          throw new Error(payload.error || response.statusText);
        }
        if (response.headers.get('X-Figma-Validation') !== 'passed') {
          throw new Error('生成的 .fig 未通过结构校验');
        }
        bytes = new Uint8Array(await response.arrayBuffer());
      }

      const { downloadFigmaFile } = await import('@galacean/html2figma/browser/file');

      downloadFigmaFile(bytes, `${documentName}.fig`);
      setDownloadState('downloaded');
      setTimeout(() => setDownloadState('idle'), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setDownloadState('idle');
    }
  };

  const handleDebug = () => {
    if (figmaHtml) {
      const hasFigmeta = figmaHtml.includes('<!--(figmeta)');
      const hasFigma = figmaHtml.includes('<!--(figma)');
      const status = hasFigmeta && hasFigma ? '✅ Figma 标记完整' : '❌ Figma 标记不完整';

      console.log(
        `[调试] HTML 长度: ${figmaHtml.length} | figmeta: ${hasFigmeta} | figma: ${hasFigma} | ${status}`,
      );
    } else if (scenes) {
      setError('请先点击「复制为 Figma 格式」生成剪贴板数据，再进行调试');
    } else {
      setError('请先上传 ZIP 并点击「转换」');
    }
  };

  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

  const changeConversionMode = (mode: ConversionMode) => {
    if (isBusy) {
      return;
    }

    setConversionMode(mode);
    setScenes(null);
    setFigmaHtml(null);
    setProgress(null);
    setError(null);
    setDiagnosticCount(0);
    setCopyState('idle');
    setDownloadState('idle');
  };

  return (
    <div className="min-h-screen">
      <div className="relative z-[1] mx-auto w-full max-w-[820px] px-4 pb-10 pt-6 max-[768px]:px-3">
        <header className="mb-4 border-b border-[var(--border)] pb-3">
          <div className="mb-2 flex items-start justify-between gap-3 max-[768px]:flex-col max-[768px]:items-start">
            <div>
              <Link
                to="/"
                className="inline-flex items-center gap-1 text-[12px] leading-[1.4] text-[var(--color-text-secondary)]
                  transition-colors hover:text-[var(--color-text-primary)]"
              >
                ← 返回首页
              </Link>
              <h1 className="mt-2 text-[22px] leading-[1.25] text-[var(--color-text-emphasis)]">HTML to Figma Lab</h1>
              <p className="mt-1 text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
                上传 ZIP/HTML，转换后一键生成可粘贴到 Figma 的剪贴板内容。
              </p>
            </div>

            <ThemeModeDropdown />
          </div>
        </header>

        <section className="ui-card space-y-4 max-[768px]:p-4">
          <div className="ui-callout ui-callout-gold text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
            {conversionMode === 'browser'
              ? '本地模式在隔离沙箱中运行脚本；脚本无法访问父页面，' +
                '但可联网加载 Tailwind、字体和图片。'
              : 'Playwright 模式使用本地服务渲染页面，可处理外部资源和动态脚本。'}
          </div>

          <div
            className="ui-dropzone"
            data-active={dragOver ? 'true' : 'false'}
            aria-disabled={isBusy}
            onClick={() => {
              if (!isBusy) {
                fileInputRef.current?.click();
              }
            }}
            onDragOver={e => {
              e.preventDefault();
              if (!isBusy) {
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={event => {
              event.preventDefault();
              if (!isBusy) {
                setDragOver(false);
                handleFiles(Array.from(event.dataTransfer.files));
              }
            }}
          >
            <div className="mb-2 text-[26px] leading-none text-[var(--color-text-secondary)]" aria-hidden="true">
              ⬡
            </div>
            <p className="text-[13px] leading-[1.45] text-[var(--color-text-emphasis)]">
              拖放文件到此处，或点击选择
            </p>
            <p className="mt-1 text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
              支持 ZIP 压缩包或 HTML 文件
            </p>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.html,.htm"
            multiple
            disabled={isBusy}
            className="hidden"
            onChange={e => {
              if (e.target.files) {handleFiles(Array.from(e.target.files));}
              e.target.value = '';
            }}
          />

          {selectedFiles.length > 0 && (
            <div className="ui-card-compact flex items-center justify-between gap-3">
              <span className="truncate text-[13px] leading-[1.45] text-[var(--color-text-emphasis)]">
                {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles.length} 个文件`}
              </span>
              <span className="text-[11px] leading-[1.35] text-[var(--color-text-secondary)] shrink-0">
                {(totalSize / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">运行模式</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`ui-btn ui-btn-sm ${conversionMode === 'browser' ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
                  onClick={() => changeConversionMode('browser')}
                  aria-pressed={conversionMode === 'browser'}
                  disabled={isBusy}
                >
                  Browser
                </button>
                <button
                  type="button"
                  className={`ui-btn ui-btn-sm ${
                    conversionMode === 'playwright' ? 'ui-btn-secondary' : 'ui-btn-ghost'
                  }`}
                  onClick={() => changeConversionMode('playwright')}
                  aria-pressed={conversionMode === 'playwright'}
                  disabled={isBusy}
                >
                  Playwright
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">Viewport</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={`ui-btn ui-btn-sm ${!isDesktop ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
                  onClick={() => setIsDesktop(false)}
                  aria-pressed={!isDesktop}
                  disabled={isBusy}
                >
                  Mobile
                </button>
                <button
                  type="button"
                  className={`ui-btn ui-btn-sm ${isDesktop ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
                  onClick={() => setIsDesktop(true)}
                  aria-pressed={isDesktop}
                  disabled={isBusy}
                >
                  Desktop
                </button>
              </div>
            </div>
          </div>

          <label
            className="flex min-h-8 items-center gap-2 text-[12px] leading-[1.4] text-[var(--color-text-secondary)]"
          >
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0"
              style={{ appearance: 'auto' }}
              checked={rasterizeSyntheticText}
              onChange={event => setRasterizeSyntheticText(event.target.checked)}
              disabled={isBusy}
            />
            提高合成字体还原度（部分文字转为图片）
          </label>

          {conversionMode === 'browser' && (
            <label
              className="flex min-h-8 items-center gap-2 text-[12px] leading-[1.4]
                text-[var(--color-text-secondary)]"
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                style={{ appearance: 'auto' }}
                checked={disableLocalScripts}
                onChange={event => setDisableLocalScripts(event.target.checked)}
                disabled={isBusy}
              />
              禁用上传文件中的脚本
            </label>
          )}

          <div className="grid grid-cols-1 gap-2">
            <button
              disabled={selectedFiles.length === 0 || isBusy}
              onClick={() => { void handleConvert(); }}
              className="ui-btn ui-btn-primary w-full h-[var(--control-md)] md:h-[var(--control-sm)]"
            >
              转换
            </button>

            <button
              disabled={!scenes || isBusy}
              onClick={() => { void handleCopyFigma(); }}
              className={`ui-btn h-[var(--control-md)] w-full md:h-[var(--control-sm)] ${
                copyState === 'copied' ? 'ui-btn-primary' : 'ui-btn-gold'
              }`}
            >
              {copyState === 'loading'
                ? '生成中...'
                : copyState === 'copied'
                  ? '已复制，直接粘贴到 Figma'
                  : '复制为 Figma 格式'}
            </button>

            <button
              disabled={!scenes || isBusy}
              onClick={() => { void handleDownloadFigma(); }}
              className="ui-btn ui-btn-secondary h-[var(--control-md)] w-full md:h-[var(--control-sm)]"
            >
              {downloadState === 'loading'
                ? '生成 .fig 中...'
                : downloadState === 'downloaded'
                  ? '已验证并下载 .fig'
                  : '下载 .fig'}
            </button>
          </div>

          {progress && (
            <div>
              <div className="ui-progress">
                <div className="ui-progress-bar" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="mt-2 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                {progress.text}
              </p>
            </div>
          )}

          {error && <div className="ui-callout ui-callout-danger text-[12px] leading-[1.45]">{error}</div>}

          <div className="flex items-center gap-1 border-t border-[var(--border)] pt-3">
            <button
              disabled={!scenes || isBusy}
              onClick={() => { void handleCopyJson(); }}
              className="ui-btn ui-btn-xs ui-btn-ghost"
            >
              {jsonCopied ? '已复制 JSON' : '复制 JSON'}
            </button>

            <button disabled={isBusy} onClick={handleDebug} className="ui-btn ui-btn-xs ui-btn-ghost">
              调试
            </button>

            <span className="flex-1" />

            {diagnosticCount > 0 && (
              <span className="ui-badge ui-badge-compact ui-badge-danger">{diagnosticCount} 条诊断</span>
            )}

            <span
              className={`ui-badge ui-badge-compact ${
                schemaStatus === 'error' || schemaStatus === 'missing' ? 'ui-badge-danger' : 'ui-badge-cyan'
              }`}
            >
              {schemaStatus === 'checking'
                ? 'Schema 检查中'
                : schemaStatus === 'missing'
                  ? 'Schema 缺失'
                  : schemaStatus === 'error'
                    ? 'Schema 异常'
                    : 'Schema 就绪'}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
