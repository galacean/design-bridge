import './frame-compare-panel.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import SVGCaseList from './svg-case-list';
import SVGPlayer from './svg-player';
import CaseTagEditor from './case-tag-editor';
import { listSVGCases, type SVGCase, type SVGCaseType } from '../../../features/svg-test-inputs/case-api';
import EffectsPlayer from '../../../features/ge-preview/effects-player';
import { downloadJsonValue } from '../../../features/local-inputs/download-json';
import WorkbenchHeader from '../../../components/workbench-header';
import {
  FrameTestPreview, FramePreviewBackgroundControls, getFramePreviewBackground,
} from '../../../features/frame-comparison/preview/frame-test-preview';
import type { FramePreviewBackground } from '../../../features/frame-comparison/preview/frame-test-preview';
import { FrameTestReportTable } from '../../../features/frame-comparison/preview/frame-test-report-table';
import { isFramePass } from '../../../features/frame-comparison/core/frame-comparison-config';
import { svgFrameExamples } from '../svg-frame-examples';
import { useSVGFrameComparisonSession } from '../hooks/use-frame-comparison-session';

export default function SVGFrameComparePanel() {
  const [params, setParams] = useSearchParams();
  const fixture = params.get('fixture');
  const fixtureType: SVGCaseType = params.get('type') === 'dynamic' ? 'dynamic' : 'static';
  const autoCompare = params.get('run') === '1';
  const timeParam = params.get('time');
  const fixtureTime = timeParam != null && timeParam !== '' && Number.isFinite(Number(timeParam))
    ? Number(timeParam) : undefined;
  const session = useSVGFrameComparisonSession();
  const [caseType, setCaseType] = useState<SVGCaseType>(fixtureType);
  const [url, setURL] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [fixtureError, setFixtureError] = useState('');
  const [tagUpdate, setTagUpdate] = useState<SVGCase | undefined>();
  const [conversionToolsOpen, setConversionToolsOpen] = useState(false);
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<FramePreviewBackground>('black');
  const currentConversion = useRef(session.conversion);
  const importTools = useRef<HTMLDetailsElement>(null);
  const sourceTools = useRef<HTMLDetailsElement>(null);
  const tagTools = useRef<HTMLDetailsElement>(null);
  const conversionTools = useRef<HTMLDetailsElement>(null);
  const modeSelect = useRef<HTMLSelectElement>(null);
  const pendingSelection = useRef<string | null>(null);

  currentConversion.current = session.conversion;
  useEffect(() => { setSaveMessage(''); }, [session.source, session.conversion]);
  useEffect(() => {
    if (session.conversion == null) {
      setConversionToolsOpen(false);
      setLivePreviewOpen(false);
    }
  }, [session.conversion]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) { return; }
      for (const tool of [importTools.current, sourceTools.current, tagTools.current, conversionTools.current]) {
        if (tool != null && !tool.contains(event.target)) { tool.open = false; }
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') { return; }
      const openTool = [importTools.current, sourceTools.current, tagTools.current, conversionTools.current]
        .find(tool => tool?.open);

      if (openTool != null) {
        openTool.open = false;
        openTool.querySelector('summary')?.focus();
      }
    };

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  const loader = useRef(session.loadCase);

  loader.current = session.loadCase;
  useEffect(() => {
    setFixtureError('');
    if (fixture == null || fixture === '') { return; }
    if (pendingSelection.current === `${fixtureType}\0${fixture}`) {
      pendingSelection.current = null;

      return;
    }
    pendingSelection.current = null;
    const controller = new AbortController();

    setCaseType(fixtureType);
    void listSVGCases(fixtureType, '', controller.signal).then(items => {
      if (controller.signal.aborted) { return; }
      const item = items.find(entry => entry.name === fixture);

      void loader.current(item ?? { name: fixture, type: fixtureType, pool: '', tag: '', note: '' }, {
        autoCompare, time: fixtureTime,
      });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setFixtureError(cause instanceof Error ? cause.message : String(cause)); }
    });

    return () => controller.abort();
  }, [fixture, fixtureType, autoCompare, fixtureTime]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [exampleId, setExampleId] = useState(svgFrameExamples[0]?.id ?? '');
  const current = session.results[session.selectedFrame];
  const skipped = session.results.filter(frame => frame.comparisonState === 'source-static').length;
  const passed = session.results.filter(isFramePass).length;
  const failed = session.results.length - passed - skipped;
  const previewWidth = session.preview?.width ?? 1;
  const previewHeight = session.preview?.height ?? 1;
  const previewScale = Math.min(180 / previewWidth, 180 / previewHeight);
  const liveWidth = Math.max(1, Math.round(previewWidth * previewScale));
  const liveHeight = Math.max(1, Math.round(previewHeight * previewScale));

  function clearCaseAddress() {
    if (fixture == null) { return; }
    const next = new URLSearchParams(params);

    next.delete('fixture');
    next.delete('run');
    next.delete('time');
    setParams(next, { replace: true });
  }

  function selectCase(item: SVGCase) {
    const next = new URLSearchParams(params);

    next.set('fixture', item.name);
    next.set('type', item.type);
    next.delete('run');
    next.delete('time');
    if (next.toString() !== params.toString()) {
      pendingSelection.current = `${item.type}\0${item.name}`;
      setParams(next, { replace: true });
    }
    void session.loadCase(item);
  }

  return (
    <div className="ui-soft-workbench ui-page-shell svg-frame-workbench min-h-screen">
      <WorkbenchHeader title="SVG 帧对比" description="比较原生 SVG 与 GE 转换结果，查看每一帧的渲染差异。" />
      <div className="ui-workspace svg-frame-workspace">
        <SVGCaseList
          key={caseType} type={caseType} onTypeChange={setCaseType} tagUpdate={tagUpdate}
          activeName={session.activeCase?.name} onSelect={selectCase}
        />
        <section className="ui-soft-panel svg-frame-input min-w-0 p-4" aria-label="SVG 输入">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold">SVG 输入</h2>
            <details ref={importTools} className="svg-frame-tool">
              <summary className="ui-btn ui-btn-secondary">加载 SVG ▾</summary>
              <div className="svg-frame-tool-content svg-frame-import-content space-y-3">
                <button className="ui-btn ui-btn-secondary w-full" onClick={() => {
                  inputRef.current?.click();
                  if (importTools.current != null) { importTools.current.open = false; }
                }}>选择 SVG 文件</button>
                <label className="block text-xs" htmlFor="svg-frame-url">SVG URL</label>
                <div className="flex gap-2">
                  <input
                    id="svg-frame-url" className="ui-input min-w-0 flex-1" value={url}
                    onChange={event => setURL(event.target.value)} placeholder="SVG URL"
                  />
                  <button className="ui-btn ui-btn-secondary" disabled={url.trim() === ''} onClick={() => {
                    clearCaseAddress();
                    void session.loadURL(url.trim());
                    if (importTools.current != null) { importTools.current.open = false; }
                  }}>加载 URL</button>
                </div>
                {svgFrameExamples.length > 0 && <>
                  <label className="block text-xs" htmlFor="svg-frame-example">示例</label>
                  <div className="flex gap-2">
                    <select
                      id="svg-frame-example" aria-label="SVG 示例" value={exampleId} className="ui-input min-w-0 flex-1"
                      onChange={event => setExampleId(event.target.value)}
                    >
                      {svgFrameExamples.map(example =>
                        <option key={example.id} value={example.id}>{example.label}</option>)}
                    </select>
                    <button className="ui-btn ui-btn-secondary" onClick={() => {
                      const example = svgFrameExamples.find(item => item.id === exampleId);

                      if (example == null) { return; }
                      clearCaseAddress();
                      session.changeSource(example.source, null, `示例 · ${example.label}`);
                      void session.convert(example.source, window.location.href);
                      if (importTools.current != null) { importTools.current.open = false; }
                    }}>加载示例</button>
                  </div>
                </>}
              </div>
            </details>
            <input
              ref={inputRef} type="file" accept=".svg,image/svg+xml" className="hidden" aria-label="导入 SVG 文件"
              onChange={event => {
                const file = event.currentTarget.files?.[0];

                if (file != null) { clearCaseAddress(); void session.loadFile(file); }
                event.currentTarget.value = '';
              }}
            />
          </div>
          {fixtureError !== '' && <p role="alert" className="text-xs text-[var(--coral)]">{fixtureError}</p>}
          <p className="svg-frame-source-name mb-3" aria-label="当前输入" title={session.sourceName}>
            {session.sourceName || (session.source.trim() === '' ? '未加载 SVG' : '未命名 SVG')}
          </p>
          <label className="block text-xs mb-2" htmlFor="svg-frame-source">SVG 源码</label>
          <textarea
            id="svg-frame-source" value={session.source} onChange={event => {
              clearCaseAddress();
              session.changeSource(event.target.value);
            }}
            spellCheck={false} placeholder="粘贴 <svg>…</svg>"
            className="ui-input w-full min-h-[260px] resize-y font-mono text-xs"
          />
          <div className="svg-frame-mode-status mt-3" aria-label="对比模式状态" aria-live="polite">
            {session.source.trim() !== '' && (session.needsModeChoice ? <>
              <span>模式待确认</span>
              <button className="ui-btn ui-btn-secondary" onClick={() => {
                if (sourceTools.current != null) { sourceTools.current.open = true; }
                modeSelect.current?.focus();
              }}>选择模式</button>
            </> : <span>
              {session.modeChoice === 'auto' && session.detectedMode === 'invalid' ? 'SVG 待校验'
                : `${session.modeChoice === 'auto' ? '自动' : '手动'} · ${session.animated ? '动画多帧' : '静态单帧'}`}
            </span>)}
          </div>
          <div className="svg-frame-actions mt-4">
            <button
              className="ui-btn ui-btn-primary"
              disabled={!session.running && (session.source.trim() === '' || session.needsModeChoice)}
              onClick={() => { if (session.running) { session.cancel(); } else { void session.run(); } }}
            >{session.running ? '取消' : '开始对比'}</button>
            <details ref={sourceTools} className="svg-frame-tool svg-frame-source-tools">
              <summary className="ui-btn ui-btn-secondary svg-frame-more"
                aria-label="更多输入操作" title="更多输入操作">⋯</summary>
              <div className="svg-frame-tool-content svg-frame-source-menu">
                <button className="svg-frame-menu-item" disabled={session.running || session.source.trim() === ''}
                  onClick={() => {
                    void session.convert();
                    if (sourceTools.current != null) { sourceTools.current.open = false; }
                  }}>仅转换</button>
                <button className="svg-frame-menu-item" onClick={() => {
                  clearCaseAddress();
                  session.changeSource('');
                  if (sourceTools.current != null) { sourceTools.current.open = false; }
                }}>清空源码</button>
                <div className="svg-frame-mode-control">
                  <label htmlFor="svg-frame-mode">对比模式</label>
                  <select ref={modeSelect} id="svg-frame-mode" className="ui-input w-full" value={session.modeChoice}
                    onChange={event => {
                      const value = event.target.value;

                      session.changeMode(value === 'static' || value === 'animated' ? value : 'auto');
                    }}>
                    <option value="auto">自动识别</option>
                    <option value="static">静态单帧</option>
                    <option value="animated">动画多帧</option>
                  </select>
                </div>
              </div>
            </details>
          </div>
          <p
            role={session.error ? 'alert' : 'status'}
            className={`svg-frame-status mt-3 text-xs ${session.error ? 'text-[var(--coral)]' : 'text-[var(--workbench-muted)]'}`}
          >
            {session.message}
          </p>
        </section>
        <section className="ui-soft-panel svg-frame-results min-w-0 p-4" aria-label="SVG 对比结果">
          <header className="svg-frame-result-header">
            <h2 className="text-sm font-semibold">对比结果</h2>
            <div className="svg-frame-result-tools">
              {session.activeCase != null ? <details ref={tagTools} className="svg-frame-tool"
                onToggle={event => {
                  if (event.currentTarget.open && conversionTools.current != null) { conversionTools.current.open = false; }
                }}>
                <summary className="ui-btn ui-btn-secondary">案例分类</summary>
                <div className="svg-frame-tool-content svg-frame-tag-content">
                  <CaseTagEditor key={session.activeCase.name} item={session.activeCase}
                    onSaved={item => { session.updateCaseTag(item); setTagUpdate(item); }} />
                </div>
              </details> : <button className="ui-btn ui-btn-secondary" disabled title="选择案例后可分类">案例分类</button>}
              {session.conversion != null && session.preview != null ? <details ref={conversionTools}
                className="svg-frame-tool" onToggle={event => {
                  const open = event.currentTarget.open;

                  setConversionToolsOpen(open);
                  if (!open) { setLivePreviewOpen(false); }
                  if (open && tagTools.current != null) { tagTools.current.open = false; }
                }}>
                <summary className="ui-btn ui-btn-secondary">转换结果</summary>
                {conversionToolsOpen && <div className="svg-frame-tool-content space-y-3">
                  <div className="svg-frame-result-section space-y-3">
                    <h3 className="text-xs font-semibold">预览与诊断</h3>
                    <p className="text-xs text-[var(--workbench-muted)]">
                      IR 顶层图层 {session.conversion.ir.compositions[0].layers.length} ·
                      转换警告 {session.conversion.warnings.length}
                      {session.elapsed != null && ` · 本次用时 ${session.elapsed.toFixed(1)} ms`}
                    </p>
                    <details onToggle={event => setLivePreviewOpen(event.currentTarget.open)}>
                      <summary className="cursor-pointer text-xs">实时预览</summary>
                      {livePreviewOpen && <div className="space-y-3 mt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-[var(--workbench-muted)]">两侧独立播放</span>
                          <FramePreviewBackgroundControls value={previewBackground} onChange={setPreviewBackground}
                            label="实时预览背景" />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="min-w-0"><h4 className="text-xs mb-2">SVG 原始</h4>
                            <SVGPlayer svg={session.preview.svg} width={liveWidth}
                              height={liveHeight} background={getFramePreviewBackground(previewBackground)}
                              fitContainer autoplay /></div>
                          <div className="min-w-0"><h4 className="text-xs mb-2">GE 转换</h4>
                            <EffectsPlayer effectsData={session.conversion.data as unknown as Record<string, unknown>}
                              width={liveWidth} height={liveHeight}
                              background={getFramePreviewBackground(previewBackground)} fitContainer /></div>
                        </div>
                      </div>}
                    </details>
                    {session.conversion.warnings.length > 0 && <details>
                      <summary className="cursor-pointer text-xs">
                        转换警告（{session.conversion.warnings.length}）
                      </summary>
                      <ul className="text-xs space-y-1 mt-2">
                        {session.conversion.warnings.map((warning, index) => <li key={index}>
                          {warning.code}：{warning.message}
                        </li>)}
                      </ul>
                    </details>}
                    <details><summary className="cursor-pointer text-xs">IR 数据</summary>
                      <pre className="max-h-[280px] overflow-auto text-xs">
                        {JSON.stringify(session.conversion.ir, null, 2)}
                      </pre>
                    </details>
                  </div>
                  <div className="svg-frame-export-section space-y-2">
                    <h3 className="text-xs font-semibold">导出与保存</h3>
                    <div className="flex flex-wrap gap-2">
                      <button className="ui-btn ui-btn-secondary" onClick={() => {
                        downloadJsonValue('svg-scene.ge.json', session.conversion?.data);
                      }}>下载 GE JSON</button>
                      <button className="ui-btn ui-btn-secondary" onClick={() => {
                        downloadJsonValue('svg-scene.ir.json', session.conversion?.ir);
                      }}>下载 IR JSON</button>
                      <button className="ui-btn ui-btn-secondary" onClick={() => {
                        const savedConversion = session.conversion;

                        void fetch('/api/svg2ge/save', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            filePath: `tmp/output/svg2ge-${Date.now()}.json`,
                            content: JSON.stringify(session.conversion?.data, null, 2),
                          }),
                        }).then(response => {
                          if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
                          if (currentConversion.current === savedConversion) {
                            setSaveMessage('GE JSON 已保存到 tmp/output。');
                          }
                        }).catch((cause: unknown) => {
                          if (currentConversion.current === savedConversion) {
                            setSaveMessage(cause instanceof Error ? cause.message : String(cause));
                          }
                        });
                      }}>保存 GE 到输出目录</button>
                    </div>
                    {saveMessage !== '' && <p role="status" className="text-xs">{saveMessage}</p>}
                  </div>
                </div>}
              </details> : <button className="ui-btn ui-btn-secondary" disabled title="转换后可查看结果">
                转换结果
              </button>}
            </div>
          </header>
          {session.results.length === 0 ? (
            <div className="svg-frame-empty text-sm text-[var(--workbench-muted)]">
              暂无对比结果
            </div>
          ) : (
            <div className="svg-frame-result-body space-y-4">
              <p role="status" className="svg-frame-summary text-sm" aria-label="帧对比统计">
                帧统计 · PASS：{passed} · FAIL：{failed} · SKIP：{skipped}
              </p>
              {current != null && (
                <FrameTestPreview
                  currentResult={current} results={session.results} selectedFrame={session.selectedFrame}
                  setSelectedFrame={session.setSelectedFrame} labels={['SVG 原始', 'GE 转换']}
                  background={previewBackground} onBackgroundChange={setPreviewBackground}
                />
              )}
              <FrameTestReportTable
                results={session.results} selectedFrame={session.selectedFrame}
                setSelectedFrame={session.setSelectedFrame}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
