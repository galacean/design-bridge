import './regression-page.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import WorkbenchHeader from '../../components/workbench-header';
import FrameRegressionReport from '../../features/frame-comparison/regression/frame-regression-report';
import { downloadJsonValue } from '../../features/local-inputs/download-json';
import { caseTags, casePools } from '../../features/svg-test-inputs/case-api';
import { readSVGReport, clearSVGReport, subscribeSVGReports } from './frame-regression-report-store';
import type { SVGRegressionReport } from './frame-regression-report-store';

async function registerSuite(root: HTMLElement, options: { signal?: AbortSignal }) {
  const { registerSVGFrameRegressionSuite } = await import('./frame-regression.spec');

  return registerSVGFrameRegressionSuite(root, options);
}

export default function SVGRegressionPage() {
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState(params.get('type') ?? 'static');
  const [pool, setPool] = useState(params.get('pool') ?? '');
  const [filter, setFilter] = useState(params.get('fixture') ?? params.get('only') ?? params.get('filter') ?? '');
  const [max, setMax] = useState(params.get('max') ?? '100');
  const [tag, setTag] = useState(params.get('tag') ?? 'all');
  const [mode, setMode] = useState(params.get('mode') ?? 'all');
  const [source, setSource] = useState(params.get('source') ?? 'all');
  const [seed, setSeed] = useState(params.get('seed') ?? '');
  const [message, setMessage] = useState('');
  const [controller, setController] = useState(() => new AbortController());
  const [report, setReport] = useState<SVGRegressionReport | undefined>(readSVGReport);
  const [resultFilter, setResultFilter] = useState<'all' | 'pass' | 'fail' | 'skip'>('all');
  const runMenu = useRef<HTMLDetailsElement>(null);
  const exportMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => subscribeSVGReports(setReport), []);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) { return; }
      for (const menu of [runMenu.current, exportMenu.current]) {
        if (menu != null && !menu.contains(event.target)) { menu.open = false; }
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') { return; }
      const menu = [runMenu.current, exportMenu.current].find(item => item?.open);

      if (menu != null) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    };

    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  // Auto-start from CLI params: fixture -> filter, only -> filter, exact -> name.
  const cliFixture = params.get('fixture');
  const cliOnly = params.get('only');
  const cliExact = params.get('exact');

  useEffect(() => {
    if (cliExact == null && cliFixture == null && cliOnly == null) { return; }
    const next = new URLSearchParams(params);

    if (cliExact != null) {
      next.set('name', cliExact);
    } else if (cliFixture != null) {
      next.set('filter', cliFixture);
      setFilter(cliFixture);
    } else if (cliOnly != null) {
      next.set('filter', cliOnly);
      setFilter(cliOnly);
    }
    next.delete('fixture');
    next.delete('only');
    next.delete('exact');
    next.set('run', String(Date.now()));
    setParams(next, { replace: true });
  }, [cliExact, cliFixture, cliOnly, params, setParams]);
  const selectionId = params.get('selection');
  const normalizing = cliFixture != null || cliOnly != null || cliExact != null;
  const started = !normalizing && (params.get('run') != null || params.get('max') != null ||
    params.getAll('name').length > 0);
  const canStop = started && !controller.signal.aborted && (report == null || report.status === 'running');

  function run(all = false) {
    if (type === 'dynamic' && source === 'fail') {
      setMessage('静态失败名单仅支持静态 SVG。');

      return;
    }
    if (!all && max !== '' && (!Number.isInteger(Number(max)) || Number(max) <= 0)) {
      setMessage('案例数请输入正整数，或留空运行全部筛选案例。');

      return;
    }
    if (all) { setMax(''); }
    clearSVGReport();
    setMessage('');
    setController(new AbortController());
    setParams({
      type, pool, filter, tag, mode, seed, source, max: all ? '' : max, run: String(Date.now()),
      ...(selectionId != null && { selection: selectionId }),
    });
  }

  async function exportImages() {
    const report = readSVGReport();

    if (report == null) {
      setMessage('请等待当前批次完成。');

      return;
    }
    try {
      const { default: JSZip } = await import('jszip');
      const archive = new JSZip();
      let count = 0;

      for (const item of report.results.filter(result => !result.pass && !result.skipped)) {
        for (const [filename, value] of [
          ['left-svg.png', item.svgDataUrl], ['right-ge.png', item.effectsDataUrl], ['diff.png', item.diffDataUrl],
        ]) {
          const match = /^data:image\/png;base64,(.+)$/.exec(value ?? '');

          if (match == null) { continue; }
          archive.file(`${item.name.replace(/[\\/]/g, '_')}/${filename}`, match[1], { base64: true });
          count++;
        }
      }
      if (count === 0) {
        setMessage('本批次没有可导出的失败帧图片。');

        return;
      }
      const blob = await archive.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = 'svg-failed-frames.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage(`已导出 ${count} 张失败帧图片。`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function exportReport() {
    if (exportMenu.current != null) { exportMenu.current.open = false; }
    const report = readSVGReport();

    if (report == null) {
      setMessage('请等待当前批次完成。');

      return;
    }
    downloadJsonValue('svg-frame-report.json', report);
    setMessage(`已导出 ${report.total} 个案例的报告。`);
  }

  function saveFailureList() {
    if (exportMenu.current != null) { exportMenu.current.open = false; }
    const report = readSVGReport();

    if (report?.type !== 'static' || report.status !== 'completed') {
      setMessage('请先完整跑完一个静态批次，再替换失败名单。');

      return;
    }
    const names = report.results.filter(result => !result.pass && !result.skipped).map(result => result.name);

    if (!window.confirm(
      `将覆盖 tmp/fail-list.txt，仅保留本批次 ${names.length} 个失败案例。确定继续吗？`,
    )) {
      setMessage('已取消覆盖失败名单。');

      return;
    }
    void fetch('/api/svg2ge/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'tmp/fail-list.txt', content: names.join('\n') + '\n' }),
    }).then(response => {
      if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
      setMessage(`已将本批次 ${names.length} 个失败案例保存到 tmp/fail-list.txt。`);
    }).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : String(cause)));
  }

  const controls = (
    <div
      className={`${started ? '' : 'ui-soft-panel svg-regression-panel mb-3 '}svg-regression-controls p-4 space-y-4`}
    >
      {selectionId != null && <p className="text-xs">已选案例仍受运行范围、分类和文件名筛选影响。
        <button className="ui-btn ui-btn-ghost ml-2" onClick={() => {
          setMax('100');
          setParams({ type });
        }}>改用完整案例池</button>
      </p>}
      <div className="svg-regression-fields">
        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-semibold">案例范围</legend>
          <div className="svg-regression-case-fields">
            <label className="svg-regression-field">
              案例类型
              <select aria-label="案例类型" disabled={selectionId != null} className="ui-input" value={type}
                onChange={e => {
                  const value = e.target.value;

                  setType(value);
                  setPool('');
                  if (value === 'dynamic' && source === 'fail') { setSource('all'); }
                }}>
                <option value="static">静态 SVG</option><option value="dynamic">动态 SVG</option>
              </select>
            </label>
            <label className="svg-regression-field">
              案例来源
              <select aria-label="案例来源" disabled={selectionId != null} className="ui-input" value={source}
                onChange={e => { setSource(e.target.value); setPool(''); }}>
                <option value="all">完整案例池</option><option value="examples">内置示例</option>
                <option value="fail" disabled={type === 'dynamic'}>静态失败名单</option>
              </select>
            </label>
            <label className="svg-regression-field">
              样本池
              <select aria-label="样本池" disabled={selectionId != null} className="ui-input" value={pool}
                onChange={e => setPool(e.target.value)}>
                <option value="">全部样本池</option>
                {(source === 'examples' ? ['examples'] : type === 'dynamic'
                  ? ['dspec', 'dreal', 'dreal-css'] : ['syn', 'ti']).map(value =>
                  <option key={value} value={value}>{casePools[value] ?? value}</option>)}
              </select>
            </label>
            <label className="svg-regression-field">
              运行范围
              <select aria-label="运行范围" className="ui-input" value={mode} onChange={e => setMode(e.target.value)}>
                <option value="all">全部案例</option><option value="queue">待处理案例</option>
                <option value="pass">标记通过的案例</option>
              </select>
            </label>
            <label className="svg-regression-field">
              案例分类
              <select aria-label="案例分类" className="ui-input" value={tag} onChange={e => setTag(e.target.value)}>
                <option value="all">全部分类</option>
                {caseTags.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
              </select>
            </label>
            <label className="svg-regression-field">
              文件名筛选
              <input aria-label="文件名筛选" placeholder="搜索文件名" className="ui-input" value={filter}
                onChange={e => setFilter(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-3 text-sm font-semibold">执行参数</legend>
          <div className="svg-regression-run-fields">
            <label className="svg-regression-field">
              最多案例数
              <input aria-label="最多案例数" placeholder="留空为全量" className="ui-input" value={max}
                onChange={e => setMax(e.target.value)} type="number" min="1" />
            </label>
            <label className="svg-regression-field">
              抽样种子
              <input aria-label="抽样种子" placeholder="固定种子抽样（可选）" className="ui-input" value={seed}
                onChange={e => setSeed(e.target.value)} />
            </label>
          </div>
        </fieldset>
      </div>
      <div className="svg-regression-actions">
        <div role="group" aria-label="运行操作" className="flex flex-wrap gap-2">
          <div className="svg-regression-run-control">
            <button className="ui-btn ui-btn-primary svg-regression-run-main" aria-label="运行选定范围"
              title="按当前筛选和数量上限运行" onClick={() => run()}>运行</button>
            <details ref={runMenu} className="svg-regression-menu">
              <summary className="ui-btn ui-btn-secondary svg-regression-run-options"
                aria-label="运行选项" title="运行选项">▾</summary>
              <div className="svg-regression-menu-content">
                <button className="svg-regression-menu-item" onClick={() => {
                  if (runMenu.current != null) { runMenu.current.open = false; }
                  run(true);
                }}>{selectionId == null ? '运行全部筛选案例' : '运行筛选后的全部已选案例'}</button>
              </div>
            </details>
          </div>
          <button className={`ui-btn ui-btn-secondary${canStop ? '' : ' svg-regression-stop-idle'}`}
            disabled={!canStop}
            onClick={() => { controller.abort(); setMessage('已停止。'); }}>停止</button>
        </div>
        <div role="group" aria-label="报告与导出">
          <details ref={exportMenu} className="svg-regression-menu svg-regression-export-menu">
            <summary className="ui-btn ui-btn-secondary">导出与保存 ▾</summary>
            <div className="svg-regression-menu-content">
              <button className="svg-regression-menu-item" onClick={exportReport}>导出报告</button>
              <button className="svg-regression-menu-item" onClick={() => {
                if (exportMenu.current != null) { exportMenu.current.open = false; }
                void exportImages();
              }}>导出失败案例代表帧</button>
              <button className="svg-regression-menu-item" onClick={saveFailureList}>
                用本批次覆盖失败名单
              </button>
            </div>
          </details>
        </div>
      </div>
      {started && <div role="group" aria-label="筛选运行结果" className="svg-regression-result-filter">
        {([
          { value: 'all', label: '全部', name: '全部结果', count: report?.total ?? 0 },
          { value: 'pass', label: 'PASS', name: '通过结果', count: report?.passCount ?? 0 },
          { value: 'fail', label: 'FAIL', name: '失败结果', count: report?.failCount ?? 0 },
          { value: 'skip', label: 'SKIP', name: '跳过结果', count: report?.skipCount ?? 0 },
        ] as const).map(item => <button
          key={item.value} type="button" aria-label={item.name} aria-pressed={resultFilter === item.value}
          className="svg-regression-result-option"
          onClick={() => setResultFilter(item.value)}
        >{item.label} <span>{item.count}</span></button>)}
      </div>}
      {report != null && <p role="status" className="text-xs" aria-label="批量运行进度">
        {report.status === 'stopped' ? '已停止 · 已完成' : report.status === 'completed' ? '已完成' : '运行中 · 已完成'}{' '}
        {report.total}/{report.plannedTotal} · PASS {report.passCount} · FAIL {report.failCount} ·
        SKIP {report.skipCount}
      </p>}
      {message !== '' && <p role="status" className="text-xs">{message}</p>}
    </div>
  );

  return started ? (
    <FrameRegressionReport key={params.toString()} title="SVG 批量帧回归"
      description="从本地案例池筛选或全量运行，查看失败帧并跳转到单案例定位。"
      registerSuite={registerSuite} signal={controller.signal} className={`svg-regression-view-${resultFilter}`}
      controlsClassName="ui-soft-panel svg-regression-panel mb-3" controlsAs="div" collapsibleLog galleryTitle="案例结果">
      {controls}
    </FrameRegressionReport>
  ) : (
    <div className="ui-soft-workbench ui-page-shell min-h-screen">
      <WorkbenchHeader title="SVG 批量帧回归" description="筛选本地案例、抽样或全量运行，查看失败帧。" />
      {controls}
    </div>
  );
}
