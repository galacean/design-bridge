import { useCallback, useMemo, useState } from 'react';
import { convertDSLToGE, convertGEToDSL, type GEDSLPreservedData } from '../../features/dsl-conversion/ge-dsl-workflow';
import type { Composition } from '@galacean/dsl-ir';

import { useInputFiles } from '../../features/local-inputs/use-input-files';
import { readInputText } from '../../features/local-inputs/input-api';
import { readGESceneMetadata } from '../../features/ge-preview/read-scene-metadata';
import { useInputRequest } from '../../features/local-inputs/use-input-request';

type BundleSlot = 'ge' | 'dsl' | 'preservedData';

export function useDSLEditing() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const { beginRequest: beginDSLRequest, cancelRequest: cancelDSLRequest } = useInputRequest();
  const { beginRequest: beginPreservedRequest, cancelRequest: cancelPreservedRequest } = useInputRequest();
  const [GEText, setGEText] = useState('');
  const [dslText, setDslText] = useState('');
  const [preservedDataText, setPreservedDataText] = useState('');
  const [convertedData, setConvertedData] = useState<Record<string, unknown> | null>(null);
  const [convertedStats, setConvertedStats] = useState<ReturnType<typeof readGESceneMetadata> | null>(null);
  const [originalData, setOriginalData] = useState<Record<string, unknown> | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const [frameRate, setFrameRate] = useState(30);
  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('ge');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editorSlot, setEditorSlot] = useState<BundleSlot>('ge');

  const resetConvertedResult = useCallback(() => {
    setConvertedData(null);
    setConvertedStats(null);
    setPreviewEnabled(false);
  }, []);

  const clearBundle = useCallback(() => {
    cancelDSLRequest();
    cancelPreservedRequest();
    setDslText('');
    setPreservedDataText('');
    resetConvertedResult();
  }, [cancelDSLRequest, cancelPreservedRequest, resetConvertedResult]);

  const updateDSLText = useCallback((text: string) => {
    cancelRequest();
    cancelDSLRequest();
    setDslText(text);
  }, [cancelRequest, cancelDSLRequest]);

  const updatePreservedText = useCallback((text: string) => {
    cancelRequest();
    cancelPreservedRequest();
    setPreservedDataText(text);
  }, [cancelRequest, cancelPreservedRequest]);

  const updateGEText = useCallback((text: string) => {
    cancelRequest();
    clearBundle();
    setGEText(text);
    setOriginalData(null);
    setActiveFile(null);
    setStatusMsg('');
    setIsError(false);
  }, [cancelRequest, clearBundle]);

  const updateFrameRate = useCallback((value: number) => {
    if (value === frameRate) {
      return;
    }
    clearBundle();
    setFrameRate(value);
    setStatusMsg('');
    setIsError(false);
  }, [clearBundle, frameRate]);

  const loadInputFile = useCallback(async (fileName: string) => {
    const signal = beginRequest();

    clearBundle();
    setGEText('');
    setOriginalData(null);
    setActiveFile(fileName);
    try {
      const content = await readInputText('ge', fileName, signal);

      if (signal.aborted) {
        return;
      }

      setGEText(content);
      setEditorSlot('ge');
      setOriginalData(JSON.parse(content) as Record<string, unknown>);
      setStatusMsg(`已加载 ${fileName}`);
      setIsError(false);
    } catch (err) {
      if (signal.aborted) {
        return;
      }
      setIsError(true);
      setStatusMsg(`加载失败：${(err as Error).message}`);
    }
  }, [beginRequest, clearBundle]);

  const loadLocalFile = useCallback(
    async (slot: BundleSlot, file: File) => {
      cancelRequest();
      const signal = slot === 'ge' ? beginRequest()
        : slot === 'dsl' ? beginDSLRequest() : beginPreservedRequest();

      setEditorSlot(slot);
      if (slot === 'ge') {
        clearBundle();
        setGEText('');
        setOriginalData(null);
      } else if (slot === 'dsl') {
        setDslText('');
      } else {
        setPreservedDataText('');
      }
      try {
        const content = await file.text();

        if (signal.aborted) {
          return;
        }

        if (slot === 'ge') {
          setGEText(content);
          setActiveFile(file.name);
          try {
            setOriginalData(JSON.parse(content) as Record<string, unknown>);
          } catch {
            setOriginalData(null);
          }
        } else if (slot === 'dsl') {
          setDslText(content);
        } else {
          setPreservedDataText(content);
        }
        setStatusMsg(`已读取 ${file.name}`);
        setIsError(false);
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        setIsError(true);
        setStatusMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [beginRequest, beginDSLRequest, beginPreservedRequest, cancelRequest, clearBundle],
  );

  const convertInput = useCallback(() => {
    cancelRequest();
    clearBundle();
    try {
      const GEScene = JSON.parse(GEText) as Record<string, unknown>;
      const t0 = performance.now();
      const { dsl, preservedData } = convertGEToDSL(GEScene, {
        frameRate, resourceBaseUrl: window.location.href,
      });
      const elapsed = performance.now() - t0;

      setOriginalData(GEScene);
      setDslText(JSON.stringify(dsl, null, 2));
      setEditorSlot('dsl');
      setPreservedDataText(JSON.stringify(preservedData, null, 2));
      setStatusMsg(`已转换为 dsl.json + preserved-data.json，已展开预合成 (${elapsed.toFixed(1)}ms)`);
      setIsError(false);
    } catch (err) {
      setIsError(true);
      setStatusMsg(`GE 转 DSL 失败：${(err as Error).message}`);
    }
  }, [cancelRequest, clearBundle, GEText, frameRate]);

  const convertBundle = useCallback(() => {
    try {
      const dsl = parseDslText(dslText);
      const preservedData = JSON.parse(preservedDataText) as GEDSLPreservedData;
      const t0 = performance.now();
      const { scene } = convertDSLToGE(dsl, { preservedData });
      const GEScene = scene as unknown as Record<string, unknown>;
      const elapsed = performance.now() - t0;

      setConvertedData(GEScene);
      setConvertedStats(readGESceneMetadata(GEScene));
      // Auto-load the original-vs-round-tripped player comparison: the reverse
      // conversion is already done and `convertedData` is in memory, so the only
      // added cost is the player init (no JSON.stringify / textarea render in
      // this path — full text is never auto-rendered, only stats above).
      // `effectsData === null` is handled gracefully by EffectsPlayer.
      setPreviewEnabled(true);
      // Ensure original GE preview is also available for side-by-side comparison.
      if (originalData == null && GEText.trim() !== '') {
        try {
          setOriginalData(JSON.parse(GEText) as Record<string, unknown>);
        } catch {
          /* best-effort */
        }
      }
      setStatusMsg(
        `已由两个 JSON 转回 GE JSONScene (${elapsed.toFixed(1)}ms)。已自动加载原始 vs 转换后播放对比；大文件下卡顿可点「关闭预览」。`,
      );
      setIsError(false);
    } catch (err) {
      setIsError(true);
      const retainedMessage = convertedData == null ? '' : '；已保留上一次成功结果';

      setStatusMsg(`转换失败：${(err as Error).message}${retainedMessage}`);
    }
  }, [dslText, preservedDataText, originalData, GEText, convertedData]);

  const clearAll = () => {
    cancelRequest();
    clearBundle();
    setGEText('');
    setOriginalData(null);
    setStatusMsg('');
    setIsError(false);
    setActiveFile(null);
    setEditorSlot('ge');
  };

  const baseName = useMemo(() => {
    if (activeFile != null && activeFile.trim() !== '') {
      return activeFile.replace(/\.json$/i, '');
    }

    return 'ge-scene';
  }, [activeFile]);

  const previewSize = useMemo(() => {
    const data = originalData ?? convertedData;

    if (data == null) {
      return { width: 360, height: 360 };
    }

    return readPreviewSize(data);
  }, [originalData, convertedData]);

  const preservedDataSummary = useMemo(() => describeJsonText(preservedDataText), [preservedDataText]);
  const filteredFiles = fileList.filter(f => !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase()));

  return {
    GEText, originalData, convertedData, convertedStats, previewEnabled,
    setPreviewEnabled, statusMsg, isError, frameRate, activeFile,
    searchQuery, setSearchQuery, editorSlot, setEditorSlot, loadFileList,
    loadInputFile, loadLocalFile, convertInput, convertBundle, clearAll,
    baseName, previewSize, preservedDataSummary, filteredFiles, preservedDataText,
    fileListError, dslText, setGEText: updateGEText, setDslText: updateDSLText, setPreservedDataText: updatePreservedText,
    setFrameRate: updateFrameRate,
  };
}

function parseDslText(text: string): Composition {
  return JSON.parse(text) as Composition;
}

function describeJsonText(text: string): string {
  if (text.trim() === '') {
    return '尚未读取或生成。';
  }

  return `约 ${formatCount(text.length)} 字符，可在「保真数据」标签中查看或下载。`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function readPreviewSize(scene: Record<string, unknown>): { width: number; height: number } {
  const size = readGESceneMetadata(scene).previewSize;

  if (size == null) {
    return { width: 360, height: 360 };
  }
  const scale = Math.min(1, 460 / size.width, 420 / size.height);

  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}
