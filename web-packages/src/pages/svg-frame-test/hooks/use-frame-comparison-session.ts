import { useMemo, useState } from 'react';
import { isFramePass } from '../../../features/frame-comparison/core/frame-comparison-config';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';
import { convertSVGToEffects, getMeasureText } from '../../../features/frame-comparison/core/svg2ge-shared';
import { readSVGCase, type SVGCase } from '../../../features/svg-test-inputs/case-api';
import { prepareSvgComparisonInput, runSvgFrameComparison } from '../../../features/frame-comparison/core/run-svg-frame-comparison';
import type { FrameResult } from '../../../features/frame-comparison/core/types';
import { detectSVGComparisonMode } from '../detect-svg-comparison-mode';
import type { SVGComparisonMode } from '../detect-svg-comparison-mode';

export function useSVGFrameComparisonSession() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [source, setSource] = useState('');
  const [modeHint, setModeHint] = useState<SVGComparisonMode | null>(null);
  const [modeChoice, setModeChoice] = useState<'auto' | SVGComparisonMode>('auto');
  const [sourceName, setSourceName] = useState('');
  const [results, setResults] = useState<FrameResult[]>([]);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('导入 SVG 文件或粘贴源码后开始对比。');
  const [error, setError] = useState(false);
  const [resourceBaseUrl, setResourceBaseUrl] = useState<string | undefined>();
  const [activeCase, setActiveCase] = useState<SVGCase | null>(null);
  const [conversion, setConversion] = useState<ReturnType<typeof convertSVGToEffects> | null>(null);
  const [preview, setPreview] = useState<{ svg: string; width: number; height: number } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const detectedMode = useMemo(() => modeHint ?? detectSVGComparisonMode(source), [modeHint, source]);
  const mode = modeChoice === 'auto' ? detectedMode : modeChoice;
  const needsModeChoice = mode === 'uncertain';
  const animated = mode === 'animated';

  function reset() {
    cancelRequest();
    setResults([]);
    setConversion(null);
    setPreview(null);
    setElapsed(null);
    setSelectedFrame(0);
    setRunning(false);
    setError(false);
    setMessage('导入 SVG 文件或粘贴源码后开始对比。');
  }

  function changeSource(value: string, hint: SVGComparisonMode | null = null, name = '') {
    reset();
    setSource(value);
    setModeHint(hint);
    setModeChoice('auto');
    setSourceName(name);
    setResourceBaseUrl(undefined);
    setActiveCase(null);
  }

  function changeMode(value: 'auto' | SVGComparisonMode) {
    reset();
    setModeChoice(value);
  }

  async function loadFile(file: File) {
    reset();
    const signal = beginRequest();

    setRunning(true);

    try {
      const value = await file.text();

      if (signal.aborted) { return; }
      setSource(value);
      setModeHint(null);
      setModeChoice('auto');
      setSourceName(file.name);
      setResourceBaseUrl(undefined);
      setActiveCase(null);
      if (await convert(value, window.location.href)) {
        setMessage(`已加载 ${file.name}，转换完成。`);
      }
    } catch (cause) {
      if (signal.aborted) { return; }
      setError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) { setRunning(false); }
    }
  }

  async function run(input?: { source: string; animated: boolean; resourceBaseUrl?: string; time?: number }) {
    if (input == null && needsModeChoice) {
      setError(true);
      setMessage('无法确定是否有动画，请先选择对比模式。');

      return;
    }
    reset();
    const signal = beginRequest();

    setRunning(true);
    setMessage('正在准备 SVG…');
    const started = performance.now();

    try {
      const frames = await runSvgFrameComparison(input?.source ?? source, {
        animated: input?.animated ?? animated,
        signal,
        resourceBaseUrl: input == null ? resourceBaseUrl : input.resourceBaseUrl,
        onConverted: (prepared, result) => {
          if (signal.aborted) { return; }
          setPreview(prepared);
          setConversion(result);
        },
        onPhaseChange: phase => {
          if (signal.aborted) { return; }
          setMessage(phase === 'converting' ? '正在转换 SVG → GE…' : '正在初始化渲染器…');
        },
        onFrameProgress: (index, total, time) => {
          if (signal.aborted) { return; }
          setMessage(`正在对比帧 ${index + 1}/${total}（t=${time.toFixed(2)}s）…`);
        },
      });

      if (signal.aborted) { return; }
      setResults(frames);
      const requestedTime = input?.time;
      const requestedFrame = requestedTime == null ? -1 : frames.reduce((closest, frame, index) =>
        closest < 0 || Math.abs(frame.time - requestedTime) < Math.abs(frames[closest].time - requestedTime)
          ? index : closest, -1);

      setSelectedFrame(requestedFrame >= 0 ? requestedFrame : Math.max(0, frames.findIndex(frame =>
        frame.comparisonState !== 'source-static' && !isFramePass(frame))));
      setMessage('对比完成。');
      setElapsed(performance.now() - started);
    } catch (cause) {
      if (signal.aborted) { return; }
      setError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) { setRunning(false); }
    }
  }

  async function loadCase(item: SVGCase, options: { autoCompare?: boolean; time?: number } = {}) {
    reset();
    const signal = beginRequest();

    setRunning(true);

    setMessage(`正在读取 ${item.name}…`);
    try {
      const value = await readSVGCase(item, signal);

      if (signal.aborted) { return; }
      setSource(value);
      setModeHint(item.type === 'dynamic' ? 'animated' : 'static');
      setModeChoice('auto');
      setSourceName(item.name);
      setResourceBaseUrl(undefined);
      setActiveCase(item);
      if (options.autoCompare) {
        await run({ source: value, animated: item.type === 'dynamic', time: options.time });
      } else if (await convert(value, window.location.href)) {
        setMessage(`已加载 ${item.name}。转换完成。`);
      }
    } catch (cause) {
      if (signal.aborted) { return; }
      setError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) { setRunning(false); }
    }
  }

  async function loadURL(url: string) {
    reset();
    const signal = beginRequest();

    setRunning(true);

    try {
      const response = await fetch(url, { signal });

      if (!response.ok) { throw new Error(`HTTP ${response.status}`); }
      const value = await response.text();

      if (signal.aborted) { return; }
      setSource(value);
      setModeHint(null);
      setModeChoice('auto');
      setSourceName(url);
      setResourceBaseUrl(response.url || new URL(url, window.location.href).href);
      setActiveCase(null);
      if (await convert(value, response.url || new URL(url, window.location.href).href)) {
        setMessage('URL 已加载。转换完成。');
      }
    } catch (cause) {
      if (signal.aborted) { return; }
      setError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) { setRunning(false); }
    }
  }

  async function convert(value = source, base = resourceBaseUrl): Promise<boolean> {
    reset();
    const signal = beginRequest();
    const started = performance.now();

    setRunning(true);
    try {
      const prepared = await prepareSvgComparisonInput(value, base);

      if (signal.aborted) { return false; }
      const result = convertSVGToEffects(prepared.svg, {
        measureText: getMeasureText(), resourceBaseUrl: base ?? window.location.href,
      });

      setPreview(prepared);
      setConversion(result);
      setElapsed(performance.now() - started);
      setMessage('转换完成。');

      return true;
    } catch (cause) {
      if (signal.aborted) { return false; }
      setError(true);
      setMessage(cause instanceof Error ? cause.message : String(cause));

      return false;
    } finally {
      if (!signal.aborted) { setRunning(false); }
    }
  }

  function updateCaseTag(item: SVGCase) {
    setActiveCase(current => current?.name === item.name ? { ...current, tag: item.tag, note: item.note } : current);
  }

  return {
    source, animated, modeChoice, detectedMode, needsModeChoice, sourceName, results, selectedFrame,
    running, message, error,
    activeCase, conversion, preview, elapsed, loadCase, loadURL, convert, updateCaseTag,
    changeSource, changeMode, loadFile, run, cancel: reset, setSelectedFrame,
  };
}
