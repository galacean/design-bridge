import { listSVGCases, readSVGCase, readSVGCaseSelection, type SVGCase } from '../../features/svg-test-inputs/case-api';
import { runSvgFrameComparison } from '../../features/frame-comparison/core/run-svg-frame-comparison';
import { getFailedMetrics, isFramePass } from '../../features/frame-comparison/core/frame-comparison-config';
import { renderFrameGallery } from '../../features/frame-comparison/regression/render-frame-gallery';
import { clearSVGReport, publishSVGReport, readSVGReport } from './frame-regression-report-store';
import type { SVGFrameResult } from '../../features/frame-comparison/core/types';
import type { SVGCaseResult, SVGRegressionReport } from './frame-regression-report-store';

export function selectSVGCases(cases: SVGCase[], query: URLSearchParams): SVGCase[] {
  const selectionId = query.get('selection');
  const selection = selectionId == null ? undefined : readSVGCaseSelection(selectionId);

  if (selection != null) {
    if (selection.type !== (query.get('type') ?? 'static')) { throw new Error('多选范围与案例类型不匹配。'); }
    const available = new Set(cases.map(item => item.name));
    const missing = selection.names.filter(name => !available.has(name));

    if (missing.length > 0) { throw new Error(`选中的案例已不存在：${missing.join('、')}`); }
  }
  const names = selection?.names ?? query.getAll('name');
  const filter = (query.get('filter') ?? '').toLowerCase();
  const mode = query.get('mode') ?? 'all';
  const only = (query.get('onlytags') ?? '').split(',').filter(Boolean);
  const skip = (query.get('skiptags') ?? '').split(',').filter(Boolean);
  const tag = query.get('tag');
  const closed = new Set(['pass', 'ge-capability', 'impl-diff', 'harness', 'case-issue']);
  const selected = cases.filter(item => (names.length === 0 || names.includes(item.name)) &&
    item.name.toLowerCase().includes(filter) && (only.length === 0 || only.includes(item.tag)) &&
    !skip.includes(item.tag) && (tag == null || tag === 'all' || item.tag === tag) &&
    (mode !== 'queue' || !closed.has(item.tag)) && (mode !== 'pass' || item.tag === 'pass'));
  const seed = query.get('seed') ?? '';

  if (seed !== '') {
    let state = Array.from(seed).reduce((value, character) => (value * 31 + character.charCodeAt(0)) >>> 0, 1);

    for (let index = selected.length - 1; index > 0; index--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const target = state % (index + 1);

      [selected[index], selected[target]] = [selected[target], selected[index]];
    }
  }
  const offset = Math.max(0, Number(query.get('offset')) || 0);
  const max = Number(query.get('max'));

  return selected.slice(offset, offset + (max > 0 ? max : selected.length));
}

export function summarizeSVGFrames(item: SVGCase, frames: SVGFrameResult[]): SVGCaseResult {
  if (frames.length === 0) { throw new Error('未生成可对比的帧。'); }
  const failures = frames.filter(frame => frame.comparisonState !== 'source-static' && !isFramePass(frame));
  const candidates = failures.length > 0 ? failures : frames;
  const worst = candidates.reduce((previous, current) => current.fullSsim < previous.fullSsim ? current : previous);
  const skipped = frames[0].comparisonState === 'source-static';

  return {
    name: item.name, pool: item.pool, tag: item.tag, noteSnapshot: item.note,
    pass: !skipped && frames.every(isFramePass), skipped,
    framePassCount: frames.filter(isFramePass).length, frameTotal: frames.length,
    comparisonState: frames[0].comparisonState, comparisonMessage: frames[0].comparisonMessage,
    fullSsim: Math.min(...frames.map(frame => frame.fullSsim)),
    coreRoiSsim: Math.min(...frames.map(frame => frame.coreRoiSsim)),
    blurredSsim: Math.min(...frames.map(frame => frame.blurredSsim)),
    pixelDiffRatio: Math.max(...frames.map(frame => frame.pixelDiffRatio)),
    localDiffDensity: Math.max(...frames.map(frame => frame.localDiffDensity ?? 0)),
    worstFrameTime: worst.time,
    svgDataUrl: worst.lottieDataUrl, effectsDataUrl: worst.effectsDataUrl, diffDataUrl: worst.diffDataUrl,
  };
}

async function compareCase(item: SVGCase, signal?: AbortSignal): Promise<SVGFrameResult[]> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);

  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) { cancel(); }
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const execution = readSVGCase(item, controller.signal).then(svg => runSvgFrameComparison(svg, {
      animated: item.type === 'dynamic', signal: controller.signal,
    }));
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('单案例超过 60 秒，已停止等待。');

        controller.abort(error);
        reject(error);
      }, 60000);
    });

    return await Promise.race([execution, timeout]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

function caseURL(item: SVGCase, time?: number): string {
  const query = new URLSearchParams({ fixture: item.name, type: item.type, run: '1' });

  if (time != null) { query.set('time', String(time)); }

  return `/svg-frame-test?${query}`;
}

function appendCaseLink(root: HTMLElement, item: SVGCase, status: 'PASS' | 'FAIL' | 'SKIP', url: string): void {
  const link = document.createElement('a');

  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = '在新标签页打开单案例对比';
  link.textContent = `${item.name} · ${status}`;
  link.ariaLabel = link.textContent;
  link.className = 'svg-regression-case-link';
  link.dataset.caseStatus = status.toLowerCase();
  root.appendChild(link);
}

function linkCaseLog(cases: SVGCase[], results: SVGCaseResult[], signal?: AbortSignal): void {
  if (typeof MutationObserver === 'undefined' || typeof document.getElementById !== 'function') { return; }
  const root = document.getElementById('mocha');

  if (root == null) { return; }
  const items = new Map(cases.map(item => [item.name, item]));
  const decorate = (heading: Element) => {
    const existing = heading.querySelector<HTMLAnchorElement>('.svg-regression-log-link');
    const text = Array.from(heading.childNodes).find(node =>
      node.nodeType === Node.TEXT_NODE && items.has(node.textContent?.trim() ?? ''));
    const item = items.get(existing?.textContent?.trim() ?? text?.textContent?.trim() ?? '');

    if (item == null) { return; }
    const result = results.find(entry => entry.name === item.name);
    const url = caseURL(item, result != null && !result.pass && !result.skipped ? result.worstFrameTime : undefined);

    if (existing == null && text != null) {
      const link = document.createElement('a');

      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = '在新标签页打开单案例对比';
      link.className = 'svg-regression-log-link';
      link.textContent = text.textContent;
      link.addEventListener('click', event => event.stopPropagation());
      heading.replaceChild(link, text);
    }
    const replay = heading.querySelector<HTMLAnchorElement>('a.replay');

    if (replay != null) {
      replay.href = url;
      replay.target = '_blank';
      replay.rel = 'noopener noreferrer';
      replay.title = '在新标签页打开单案例对比';
      replay.ariaLabel = `打开 ${item.name} 的单案例对比`;
      if (replay.dataset.svgCaseLinked !== 'true') {
        replay.dataset.svgCaseLinked = 'true';
        replay.addEventListener('click', event => event.stopPropagation());
      }
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) {
          if (node.matches('.test > h2')) { decorate(node); }
          if (node.parentElement?.matches('.test > h2')) { decorate(node.parentElement); }
          node.querySelectorAll('.test > h2').forEach(decorate);
        } else if (node.parentElement?.matches('.test > h2')) {
          decorate(node.parentElement);
        }
      }
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  signal?.addEventListener('abort', () => observer.disconnect(), { once: true });
}

export async function registerSVGFrameRegressionSuite(root: HTMLElement, options: { signal?: AbortSignal }) {
  const query = new URLSearchParams(window.location.search);
  const type = query.get('type') === 'dynamic' ? 'dynamic' : 'static';
  const cases = selectSVGCases(await listSVGCases(type, query.get('pool') ?? '', options.signal, query.get('source') ?? 'all'), query);

  if (options.signal?.aborted) { return 0; }
  const results: SVGCaseResult[] = [];
  const runId = crypto.randomUUID();

  linkCaseLog(cases, results, options.signal);
  clearSVGReport();
  function publish(status: SVGRegressionReport['status'], initial = false) {
    if (!initial && readSVGReport()?.runId !== runId) { return; }
    publishSVGReport({
      runId, status, type, plannedTotal: cases.length, total: results.length,
      passCount: results.filter(result => result.pass).length,
      failCount: results.filter(result => !result.pass && !result.skipped).length,
      skipCount: results.filter(result => result.skipped).length,
      ...(status !== 'running' && { completedAt: new Date().toISOString() }),
      results: [...results],
    });
  }
  const stopped = () => publish('stopped');

  publish(cases.length === 0 ? 'completed' : 'running', true);
  if (cases.length > 0) { options.signal?.addEventListener('abort', stopped, { once: true }); }
  describe(`SVG → GE 帧回归（${cases.length} 个案例）`, function () {
    for (const item of cases) {
      it(item.name, async function () {
        this.timeout(65000);
        if (options.signal?.aborted) { this.skip(); }
        let linked = false;

        try {
          const frames = await compareCase(item, options.signal);

          if (options.signal?.aborted) { this.skip(); }
          const result = summarizeSVGFrames(item, frames);
          const url = caseURL(item, !result.pass && !result.skipped ? result.worstFrameTime : undefined);

          appendCaseLink(root, item, result.skipped ? 'SKIP' : result.pass ? 'PASS' : 'FAIL', url);
          linked = true;
          if (!result.pass && !result.skipped) {
            const worst = frames.find(frame => frame.time === result.worstFrameTime) ?? frames[0];

            renderFrameGallery(item.name, [worst], root, ['SVG', 'GE'], { caseUrl: url });
          } else {
            delete result.svgDataUrl;
            delete result.effectsDataUrl;
            delete result.diffDataUrl;
          }
          results.push(result);
          if (result.skipped) { this.skip(); }
          const failed = frames.filter(frame => !isFramePass(frame));

          if (failed.length > 0) {
            throw new Error(failed.map(frame => `t=${frame.time.toFixed(2)}s：${getFailedMetrics(frame).join('；')}`)
              .join('\n'));
          }
        } catch (cause) {
          if (options.signal?.aborted) { this.skip(); }
          if (!results.some(result => result.name === item.name)) {
            const error = cause instanceof Error ? cause.message : String(cause);

            results.push({
              name: item.name, pool: item.pool, tag: item.tag, noteSnapshot: item.note, pass: false, skipped: false,
              framePassCount: 0, frameTotal: 0, error,
            });
            if (!linked) { appendCaseLink(root, item, 'FAIL', caseURL(item)); }
            const detail = document.createElement('p');

            detail.className = 'svg-regression-case-error';
            detail.dataset.caseStatus = 'fail';
            detail.textContent = error;
            root.appendChild(detail);
          }
          throw cause;
        } finally {
          const finished = results.length === cases.length;

          publish(options.signal?.aborted ? 'stopped' : finished ? 'completed' : 'running');
          if (finished) { options.signal?.removeEventListener('abort', stopped); }
        }
      });
    }
  });

  return cases.length;
}
