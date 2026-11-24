import { useCallback, useMemo, useRef, useState } from 'react';
import { applyIREdits, prepareIREditing, restoreIREditing } from './convert-ir-editing';

import { useInputFiles } from '../../features/local-inputs/use-input-files';
import { readInputText } from '../../features/local-inputs/input-api';
import { readGESceneMetadata } from '../../features/ge-preview/read-scene-metadata';

type BundleSlot = 'ge' | 'ir' | 'preservedData';

export function useIREditing() {
  const [GEText, setGEText] = useState('');
  const [session, setSession] = useState<ReturnType<typeof prepareIREditing> | null>(null);
  const [diagnostics, setDiagnostics] = useState<ReturnType<typeof prepareIREditing>['diagnostics']>([]);
  const loadGeneration = useRef(0);
  const [irText, setIrText] = useState('');
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

  const clearEditing = useCallback(() => {
    setSession(null);
    setIrText('');
    setPreservedDataText('');
    setOriginalData(null);
    setDiagnostics([]);
    resetConvertedResult();
  }, [resetConvertedResult]);

  const setSourceText = (text: string) => {
    loadGeneration.current++;
    setGEText(text);
    clearEditing();
    setStatusMsg('源 GE 已更新，请重新生成 IR。');
    setIsError(false);
  };

  const loadInputFile = async (fileName: string) => {
    const generation = ++loadGeneration.current;

    clearEditing();
    setGEText('');
    setActiveFile(fileName);
    setEditorSlot('ge');
    setIsError(false);
    setStatusMsg(`正在加载 ${fileName}…`);
    try {
      const content = await readInputText('ge', fileName);

      if (generation !== loadGeneration.current) {
        return;
      }
      setGEText(content);
      setStatusMsg(`已加载 ${fileName}，点击「生成 IR」开始编辑。`);
    } catch (err) {
      if (generation === loadGeneration.current) {
        setIsError(true);
        setStatusMsg(`加载失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const loadLocalFile = async (slot: BundleSlot, file: File) => {
    const generation = ++loadGeneration.current;

    try {
      const content = await file.text();

      if (generation !== loadGeneration.current) {
        return;
      }
      if (slot === 'ge') {
        clearEditing();
        setGEText(content);
        setActiveFile(file.name);
      } else if (slot === 'ir') {
        setIrText(content);
        resetConvertedResult();
      } else {
        const restored = restoreIREditing(content);

        setSession(restored);
        setGEText(JSON.stringify(restored.source, null, 2));
        setIrText(JSON.stringify(restored.baselineScene, null, 2));
        setPreservedDataText(JSON.stringify(restored, null, 2));
        setOriginalData(restored.source);
        setDiagnostics(restored.diagnostics);
        setFrameRate(restored.baselineScene.compositions.find(
          composition => composition.id === restored.baselineScene.entryCompositionId,
        )?.frameRate ?? 30);
        setActiveFile(file.name.replace(/\.preserved-data\.json$/i, ''));
        resetConvertedResult();
      }
      setEditorSlot(slot);
      setStatusMsg(slot === 'preservedData'
        ? '已恢复原始 IR 与保真数据，请导入修改后的 IR 或切换到「可编辑 IR」继续编辑。'
        : `已读取 ${file.name}`);
      setIsError(false);
    } catch (err) {
      if (generation === loadGeneration.current) {
        setIsError(true);
        setStatusMsg(`导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const convertInput = () => {
    loadGeneration.current++;
    try {
      const startedAt = performance.now();
      const prepared = prepareIREditing(GEText, frameRate, window.location.href);

      setSession(prepared);
      setIrText(JSON.stringify(prepared.baselineScene, null, 2));
      setPreservedDataText(JSON.stringify(prepared, null, 2));
      setOriginalData(prepared.source);
      setDiagnostics(prepared.diagnostics);
      setEditorSlot('ir');
      resetConvertedResult();
      setStatusMsg(`已生成 IR 与保真数据 (${(performance.now() - startedAt).toFixed(1)}ms)`);
      setIsError(false);
    } catch (err) {
      setIsError(true);
      setStatusMsg(`GE → IR 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const convertBundle = () => {
    if (session == null) {
      return;
    }
    try {
      const startedAt = performance.now();
      const result = applyIREdits(irText, session);

      setConvertedData(result.scene);
      setConvertedStats(readGESceneMetadata(result.scene));
      setDiagnostics([...session.diagnostics, ...result.diagnostics]);
      setPreviewEnabled(true);
      setStatusMsg(`已应用 IR 修改并生成 GE (${(performance.now() - startedAt).toFixed(1)}ms)`);
      setIsError(false);
    } catch (err) {
      setIsError(true);
      setStatusMsg(`IR → GE 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const clearAll = () => {
    loadGeneration.current++;
    clearEditing();
    setGEText('');
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
  const setIRText = (text: string) => {
    loadGeneration.current++;
    setIrText(text);
    resetConvertedResult();
    setIsError(false);
    setStatusMsg('IR 已修改，点击「应用并预览」查看结果。');
    setDiagnostics(session?.diagnostics ?? []);
  };

  const updateFrameRate = (value: number) => {
    loadGeneration.current++;
    setFrameRate(value);
    clearEditing();
    setEditorSlot('ge');
    setStatusMsg('导入帧率已更新，请重新生成 IR。');
  };

  return {
    GEText, originalData, convertedData, convertedStats, previewEnabled,
    setPreviewEnabled, statusMsg, isError, frameRate, activeFile,
    searchQuery, setSearchQuery, editorSlot, setEditorSlot, loadFileList,
    loadInputFile, loadLocalFile, convertInput, convertBundle, clearAll,
    baseName, previewSize, preservedDataSummary, filteredFiles, preservedDataText,
    fileListError, irText, session, diagnostics, setSourceText,
    setIRText, updateFrameRate,
  };
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
