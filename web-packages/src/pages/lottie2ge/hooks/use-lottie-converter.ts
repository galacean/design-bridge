import { useState, useCallback } from 'react';
import type { LottieJSON, LottieToIRResult } from '@galacean/lottie2ir';
import { convertLottieTextToGE } from '../../../features/lottie-conversion/convert-lottie-to-ge';
import { readInputText } from '../../../features/local-inputs/input-api';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';

type ConversionDiagnostic = LottieToIRResult['diagnostics'][number];

export type ConvertStatus = 'idle' | 'converting' | 'success' | 'error';

export interface ConvertResult {
  effectsData: Record<string, unknown> | null;
  diagnostics: ConversionDiagnostic[];
  message: string;
  ms: number;
}

export interface ConverterState {
  status: ConvertStatus;
  message: string;
  inputJson: string;
  urlInput: string;
  lottieData: LottieJSON | null;
  effectsData: Record<string, unknown> | null;
  diagnostics: ConversionDiagnostic[];
  result: ConvertResult | null;
}

export function useLottieConverter() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [state, setState] = useState<ConverterState>({
    status: 'idle',
    message: '',
    inputJson: '',
    urlInput: '',
    lottieData: null,
    effectsData: null,
    diagnostics: [],
    result: null,
  });

  const setInputJson = useCallback((v: string) => {
    cancelRequest();
    setState(s => ({ ...s, inputJson: v, status: 'idle', message: '' }));
  }, [cancelRequest]);

  const setUrlInput = useCallback((v: string) => {
    cancelRequest();
    setState(s => ({ ...s, urlInput: v, status: 'idle', message: '' }));
  }, [cancelRequest]);

  const convertText = useCallback(async (jsonStr: string, signal: AbortSignal) => {
    if (!jsonStr.trim()) {
      return;
    }

    setState(s => ({
      ...s,
      status: 'converting',
      message: '正在转换...',
      lottieData: null,
      effectsData: null,
      diagnostics: [],
      result: null,
    }));

    try {
      const lottieData = JSON.parse(jsonStr) as LottieJSON;
      const t0 = performance.now();
      const converted = await convertLottieTextToGE(jsonStr);

      if (signal.aborted) {
        return;
      }
      const ms = Math.round(performance.now() - t0);
      const extra = converted.diagnostics.length > 0 ? ` | ${converted.diagnostics.length} 项诊断` : '';
      const result: ConvertResult = {
        effectsData: converted.data as unknown as Record<string, unknown>,
        diagnostics: converted.diagnostics,
        message: `转换完成 (${ms}ms)${extra}`,
        ms,
      };

      setState(s => ({
        ...s,
        status: 'success',
        message: result.message,
        lottieData,
        effectsData: result.effectsData,
        diagnostics: result.diagnostics,
        result,
      }));
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      setState(s => ({
        ...s,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
        lottieData: null,
        effectsData: null,
        result: null,
      }));
    }
  }, []);

  const doConvert = useCallback((jsonStr: string) => convertText(jsonStr, beginRequest()), [beginRequest, convertText]);

  const loadSource = useCallback(
    async (read: (signal: AbortSignal) => Promise<string>, label: string) => {
      const signal = beginRequest();

      setState(s => ({
        ...s, inputJson: '', status: 'converting', message: `正在加载${label}...`,
        lottieData: null, effectsData: null, diagnostics: [], result: null,
      }));
      try {
        const content = await read(signal);

        if (signal.aborted) {
          return;
        }
        JSON.parse(content);
        setState(s => ({ ...s, inputJson: content }));
        await convertText(content, signal);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setState(s => ({
          ...s,
          status: 'error',
          message: `加载失败: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    },
    [beginRequest, convertText],
  );

  const loadFromUrl = useCallback((url: string) => loadSource(async signal => {
    const response = await fetch(url, { signal });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.text();
  }, ' URL'), [loadSource]);

  const loadFromFile = useCallback((file: File) => loadSource(() => file.text(), file.name), [loadSource]);
  const loadInputFile = useCallback((fileName: string) => loadSource(
    signal => readInputText('lottie', fileName, signal), fileName,
  ), [loadSource]);

  const clear = useCallback(() => {
    cancelRequest();
    setState({
      status: 'idle',
      message: '',
      inputJson: '',
      urlInput: '',
      lottieData: null,
      effectsData: null,
      diagnostics: [],
      result: null,
    });
  }, [cancelRequest]);

  return {
    state,
    actions: { setInputJson, setUrlInput, doConvert, loadFromUrl, loadFromFile, loadInputFile, clear },
  };
}
