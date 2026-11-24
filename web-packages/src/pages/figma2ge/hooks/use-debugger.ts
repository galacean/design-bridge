import type React from 'react';
import { useCallback, useRef, useState } from 'react';
import { convertFigmaToEffects, validateRuntimeReadiness, decodeFigFile } from '@galacean/figma2ge';
import type { ConversionResult } from '@galacean/figma2ge';
import type { ConvertStatus, LocateHistoryEntry, OutputMode, ScenePreviewObject } from '../types';
import { useScenePreview } from './use-scene-preview';
import { buildSceneIdSet, collectCandidateTokens, findDebugEntryBySceneObjectId, stringifyResult } from '../utils';
import { useInputRequest } from '../../../features/local-inputs/use-input-request';

export function useDebugger() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<ConvertStatus>('idle');
  const [output, setOutput] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeSmokeIssues, setRuntimeSmokeIssues] = useState<Array<{ type: 'warning' | 'error'; message: string }>>(
    [],
  );
  const [copied, setCopied] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>('scene');
  const [includeInvisibleNodes, setIncludeInvisibleNodes] = useState(false);
  const [compositionName, setCompositionName] = useState('FigmaDebugComposition');
  const [compositionDuration, setCompositionDuration] = useState('5');
  const [figmaNodeLookupId, setFigmaNodeLookupId] = useState('');
  const [focusedSceneObjectId, setFocusedSceneObjectId] = useState('');
  const [locateHistory, setLocateHistory] = useState<LocateHistoryEntry[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const scene = result?.scene;
  const warningCount = result?.issues.filter(issue => issue.type === 'warning').length ?? 0;
  const errorCount = result?.issues.filter(issue => issue.type === 'error').length ?? 0;
  const smokeWarningCount = runtimeSmokeIssues.filter(issue => issue.type === 'warning').length;
  const smokeErrorCount = runtimeSmokeIssues.filter(issue => issue.type === 'error').length;
  const debugMapSize = result ? Object.keys(result.debugMap).length : 0;

  const trimmedLookupId = figmaNodeLookupId.trim();
  const trimmedFocusedSceneObjectId = focusedSceneObjectId.trim();
  const matchedDebugEntry = result && trimmedLookupId ? result.debugMap[trimmedLookupId] : undefined;

  const previewObjects: ScenePreviewObject[] = useScenePreview({
    scene,
    matchedDebugEntry,
    trimmedFocusedSceneObjectId,
  });

  const setMode = (mode: OutputMode) => {
    cancelRequest();
    setOutputMode(mode);
    if (result) {
      setOutput(stringifyResult(result, mode));
    }
  };

  const pushLocateHistory = (entry: LocateHistoryEntry) => {
    setLocateHistory(prev => [entry, ...prev].slice(0, 10));
  };

  const runConversion = useCallback(
    (figmaJson: unknown, sourceName: string, imagesByHash?: Map<string, Uint8Array>) => {
      setFileName(sourceName);
      setError(null);
      setOutput(null);
      setResult(null);
      setRuntimeSmokeIssues([]);
      setLocateHistory([]);
      setStatus('idle');

      try {
        const duration = Number(compositionDuration);
        const conversion = convertFigmaToEffects(
          figmaJson,
          {
            includeInvisibleNodes,
            compositionName: compositionName.trim() || 'FigmaDebugComposition',
            compositionDuration: Number.isFinite(duration) && duration > 0 ? duration : 5,
          },
          imagesByHash,
        );

        setResult(conversion);
        setOutput(stringifyResult(conversion, outputMode));
        setRuntimeSmokeIssues(validateRuntimeReadiness(conversion.scene));
        setStatus('done');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [compositionDuration, includeInvisibleNodes, compositionName, outputMode],
  );

  const processFile = async (file: File) => {
    const signal = beginRequest();

    setFileName(file.name);
    setError(null);
    setOutput(null);
    setResult(null);
    setRuntimeSmokeIssues([]);
    if (file.name.endsWith('.json')) {
      try {
        const text = await file.text();

        if (signal.aborted) {
          return;
        }
        const figmaJson = JSON.parse(text) as unknown;

        runConversion(figmaJson, file.name);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setFileName(file.name);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    } else if (file.name.endsWith('.fig')) {
      try {
        const buffer = await file.arrayBuffer();

        if (signal.aborted) {
          return;
        }
        const { message, images } = decodeFigFile(new Uint8Array(buffer));

        runConversion(message, file.name, images);
      } catch (err) {
        if (signal.aborted) {
          return;
        }
        setFileName(file.name);
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    } else {
      setError('请上传 .json 或 .fig 文件');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];

    if (file) {
      void processFile(file);
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (file) {
      void processFile(file);
    }
    e.target.value = '';
  };

  const copyOutput = async () => {
    if (!output) {
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
    } catch {
      const ta = document.createElement('textarea');

      ta.value = output;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadOutput = () => {
    if (!output) {
      return;
    }

    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = outputMode === 'full' ? 'figma2effects-debug-result.json' : 'galacean-effects-scene.json';
    a.click();

    URL.revokeObjectURL(url);
  };

  const locateFromIssue = (issueMessage: string, source: 'issue' | 'runtime') => {
    if (!result) {
      return;
    }

    const sceneIds = buildSceneIdSet(scene);

    for (const candidate of collectCandidateTokens(issueMessage)) {
      if (result.debugMap[candidate]) {
        setFigmaNodeLookupId(candidate);
        setFocusedSceneObjectId('');
        pushLocateHistory({
          time: new Date().toLocaleTimeString(),
          source,
          figmaNodeId: candidate,
          issueMessage,
        });

        return;
      }

      if (sceneIds.has(candidate)) {
        setFocusedSceneObjectId(candidate);
        const mapped = findDebugEntryBySceneObjectId(result.debugMap, candidate);

        if (mapped) {
          setFigmaNodeLookupId(mapped.figmaNodeId);
        }
        pushLocateHistory({
          time: new Date().toLocaleTimeString(),
          source,
          figmaNodeId: mapped?.figmaNodeId,
          sceneObjectId: candidate,
          issueMessage,
        });

        return;
      }
    }
  };

  const applyHistoryEntry = (entry: LocateHistoryEntry) => {
    if (entry.figmaNodeId) {
      setFigmaNodeLookupId(entry.figmaNodeId);
    }
    if (entry.sceneObjectId) {
      setFocusedSceneObjectId(entry.sceneObjectId);
    }
  };

  return {
    state: {
      dragOver,
      fileName,
      status,
      output,
      result,
      error,
      runtimeSmokeIssues,
      copied,
      outputMode,
      includeInvisibleNodes,
      compositionName,
      compositionDuration,
      figmaNodeLookupId,
      locateHistory,
    },
    derived: {
      scene,
      warningCount,
      errorCount,
      smokeWarningCount,
      smokeErrorCount,
      debugMapSize,
      trimmedLookupId,
      matchedDebugEntry,
      previewObjects,
    },
    refs: {
      fileInputRef,
    },
    actions: {
      setDragOver,
      setIncludeInvisibleNodes: (value: boolean) => { cancelRequest(); setIncludeInvisibleNodes(value); },
      setCompositionName: (value: string) => { cancelRequest(); setCompositionName(value); },
      setCompositionDuration: (value: string) => { cancelRequest(); setCompositionDuration(value); },
      setFigmaNodeLookupId,
      clearLocateHistory: () => setLocateHistory([]),
      onDrop,
      onPickFile,
      copyOutput,
      downloadOutput,
      setMode,
      locateFromIssue,
      applyHistoryEntry,
    },
  };
}
