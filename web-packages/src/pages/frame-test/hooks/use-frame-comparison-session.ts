import { useInputFiles } from '../../../features/local-inputs/use-input-files';
import { readInputText } from '../../../features/local-inputs/input-api';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';
import { useCallback, useEffect, useState } from 'react';
import type { LottieJSON } from '@galacean/lottie2ir';
import { runFrameComparison } from '../../../features/frame-comparison/core/run-frame-comparison';
import type { FrameResult } from '../../../features/frame-comparison/core/types';
import { FRAME_SAMPLE_COUNT, isFramePass } from '../../../features/frame-comparison/core/frame-comparison-config';

export type TestStatus = 'idle' | 'loading' | 'converting' | 'running' | 'done' | 'error';

export function useFrameComparisonSession() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [urlInput, setUrlInput] = useState('');
  const [status, setStatus] = useState<TestStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [lottieData, setLottieData] = useState<LottieJSON | null>(null);
  const [results, setResults] = useState<FrameResult[]>([]);
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [fileName, setFileName] = useState('');
  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('lottie');
  const [activeFile, setActiveFile] = useState<string | null>(null);

  useEffect(() => {
    if (fileListError != null) {
      setStatusMsg(fileListError);
      setStatus('error');
    }
  }, [fileListError]);

  const runFrameTest = useCallback(async (lottieJson: LottieJSON, signal: AbortSignal) => {
    setStatus('converting');
    setStatusMsg('正在转换 Lottie → GE...');
    setResults([]);
    setSelectedFrame(0);

    try {
      const frameResults = await runFrameComparison(lottieJson, {
        signal,
        sampleCount: FRAME_SAMPLE_COUNT,
        onPhaseChange: phase => {
          if (signal.aborted) {
            return;
          }
          setStatus(phase);
          if (phase === 'converting') {
            setStatusMsg('正在转换 Lottie → GE...');
          }
          if (phase === 'loading') {
            setStatusMsg('正在初始化渲染器...');
          }
        },
        onFrameProgress: (index, total, time) => {
          if (signal.aborted) {
            return;
          }
          setStatus('running');
          setStatusMsg(`正在对比帧 ${index + 1}/${total} (t=${time.toFixed(2)}s)...`);
        },
      });

      if (signal.aborted) {
        return;
      }

      setResults(frameResults);
      setStatus('done');

      const failCount = frameResults.filter(r => !isFramePass(r)).length;
      const passCount = frameResults.filter(r => isFramePass(r)).length;

      setStatusMsg(`测试完成，PASS: ${passCount}/${frameResults.length}，FAIL: ${failCount}/${frameResults.length}`);
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      setStatus('error');
      setStatusMsg(`测试失败: ${(err as Error).message}`);
    }
  }, []);

  const loadAndRun = useCallback(
    async (jsonStr: string, name: string, signal: AbortSignal) => {
      if (signal.aborted) {
        return;
      }
      try {
        const parsed = JSON.parse(jsonStr) as LottieJSON;

        setLottieData(parsed);
        setFileName(name);
        await runFrameTest(parsed, signal);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setStatus('error');
        setStatusMsg(`JSON 解析失败: ${(err as Error).message}`);
      }
    },
    [runFrameTest],
  );

  const loadInputFile = useCallback(
    async (fName: string) => {
      const signal = beginRequest();

      setActiveFile(fName);
      setStatus('loading');
      setStatusMsg(`正在加载 ${fName}...`);

      try {
        const content = await readInputText('lottie', fName, signal);

        await loadAndRun(content, fName, signal);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setStatus('error');
        setStatusMsg(`加载失败: ${(err as Error).message}`);
      }
    },
    [beginRequest, loadAndRun],
  );

  const loadFromUrl = useCallback(async () => {
    const signal = beginRequest();
    const url = urlInput.trim();

    if (!url) {
      return;
    }

    setStatus('loading');
    setStatusMsg('正在从 URL 加载...');

    try {
      const res = await fetch(url, { signal });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const content = await res.text();
      const name = url.split('/').pop() || 'url-input';

      await loadAndRun(content, name, signal);
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      setStatus('error');
      setStatusMsg(`URL 加载失败: ${(err as Error).message}`);
    }
  }, [beginRequest, urlInput, loadAndRun]);

  const loadFromFile = useCallback(
    async (file: File) => {
      const signal = beginRequest();

      setActiveFile(file.name);
      try {
        await loadAndRun(await file.text(), file.name, signal);
      } catch (error) {
        if (!signal.aborted) {
          setStatus('error');
          setStatusMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, loadAndRun],
  );

  const clear = useCallback(() => {
    cancelRequest();
    setStatus('idle');
    setStatusMsg('');
    setLottieData(null);
    setResults([]);
    setSelectedFrame(0);
    setFileName('');
    setActiveFile(null);
  }, [cancelRequest]);

  const isRunning = status === 'loading' || status === 'converting' || status === 'running';

  return {
    urlInput,
    setUrlInput: (value: string) => {
      cancelRequest();
      setUrlInput(value);
      setStatus('idle');
      setStatusMsg('');
    },
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
  };
}
