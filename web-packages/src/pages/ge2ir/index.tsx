import { readGESceneMetadata } from '../../features/ge-preview/read-scene-metadata';
import { useInputFiles } from '../../features/local-inputs/use-input-files';
import { readInputText } from '../../features/local-inputs/input-api';
import { useInputRequest } from '../../features/local-inputs/use-input-request';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { convertGEToIR, convertIRToGE, type GEToIRPreservedData } from '@galacean/ge-ir';
import EffectsPlayer from '../../features/ge-preview/effects-player';
import WorkbenchHeader from '../../components/workbench-header';

type RoundTripMode = 'preserved-data' | 'normalized';

interface GEPreservationReport {
  layerCount: number;
  fieldCount: number;
  compositionBindingCount: number;
  hasSourceScene: boolean;
  restoredPools: Record<string, number>;
  normalizedShallowDiffs: string[];
  normalizedUnavailableReason?: string;
}

interface ConversionTiming {
  GEToIR: number;
  preservedDataIRToGE: number;
  normalizedIRToGE: number | null;
  selectedRoundTrip: number | null;
}

export default function GEToIR() {
  const { beginRequest, cancelRequest } = useInputRequest();
  const [inputJson, setInputJson] = useState('');
  const [originalData, setOriginalData] = useState<Record<string, unknown> | null>(null);
  const [roundTripData, setRoundTripData] = useState<Record<string, unknown> | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isError, setIsError] = useState(false);
  const [conversionTiming, setConversionTiming] = useState<ConversionTiming | null>(null);
  const [frameRate, setFrameRate] = useState(30);
  const [roundTripMode, setRoundTripMode] = useState<RoundTripMode>('preserved-data');
  const [shallowDiffSummary, setShallowDiffSummary] = useState<string[]>([]);
  const [preservationReport, setPreservationReport] = useState<GEPreservationReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { files: fileList, error: fileListError, refresh: loadFileList } = useInputFiles('ge');
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (fileListError != null) {
      setStatusMsg(fileListError);
      setIsError(true);
    }
  }, [fileListError]);

  const doConvert = useCallback(
    (jsonStr: string, mode: RoundTripMode = roundTripMode) => {
      cancelRequest();
      try {
        const sourceGE = JSON.parse(jsonStr) as Record<string, unknown>;

        setOriginalData(sourceGE);

        const GEToIRStart = performance.now();
        const { scene: irScene, preservedData } = convertGEToIR(sourceGE, {
          frameRate, resourceBaseUrl: window.location.href,
        });
        const GEToIR = performance.now() - GEToIRStart;

        const preservedDataStart = performance.now();
        const preservedDataResult = convertIRToGE(irScene, { preservedData });
        const preservedDataGE = preservedDataResult.scene as unknown as Record<string, unknown>;
        const preservedDataIRToGE = performance.now() - preservedDataStart;

        let normalizedGE: Record<string, unknown> | null = null;
        let normalizedIRToGE: number | null = null;
        let normalizedUnavailableReason: string | undefined;

        try {
          const normalizedStart = performance.now();
          const normalizedResult = convertIRToGE(irScene);

          normalizedGE = normalizedResult.scene as unknown as Record<string, unknown>;
          normalizedIRToGE = performance.now() - normalizedStart;
        } catch (error) {
          normalizedUnavailableReason = (error as Error).message;
        }

        const report = buildGEPreservationReport(
          preservedData,
          preservedDataGE,
          normalizedGE,
          normalizedUnavailableReason,
        );

        let roundTripGE = preservedDataGE;
        let selectedIRToGE = preservedDataIRToGE;

        if (mode === 'normalized') {
          if (normalizedGE == null || normalizedIRToGE == null) {
            setRoundTripData(null);
            setConversionTiming({ GEToIR, preservedDataIRToGE, normalizedIRToGE, selectedRoundTrip: null });
            setShallowDiffSummary([]);
            setPreservationReport(report);
            setStatusMsg(`标准 IR 导出不可用：${normalizedUnavailableReason ?? '无法生成 GE 场景'}`);
            setIsError(true);

            return;
          }
          roundTripGE = normalizedGE;
          selectedIRToGE = normalizedIRToGE;
        }
        const selectedRoundTrip = GEToIR + selectedIRToGE;

        setRoundTripData(roundTripGE);
        setConversionTiming({ GEToIR, preservedDataIRToGE, normalizedIRToGE, selectedRoundTrip });

        const diffs = computeShallowStructureDiff(sourceGE, roundTripGE);

        setShallowDiffSummary(diffs);
        setPreservationReport(report);
        setStatusMsg(
          `${mode === 'preserved-data' ? '保真往返' : '标准 IR 导出'} 完成 (${selectedRoundTrip.toFixed(1)}ms) — ${diffs.length === 0 ? '浅层结构一致' : `${diffs.length} 处浅层结构差异`}`,
        );
        setIsError(false);
      } catch (err) {
        setIsError(true);
        setStatusMsg((err as Error).message);
        setOriginalData(null);
        setRoundTripData(null);
        setConversionTiming(null);
        setShallowDiffSummary([]);
        setPreservationReport(null);
      }
    },
    [cancelRequest, frameRate, roundTripMode],
  );

  const loadFromFile = useCallback(
    async (file: File) => {
      const signal = beginRequest();

      setActiveFile(file.name);
      try {
        const content = await file.text();

        if (signal.aborted) {
          return;
        }

        setInputJson(content);
        doConvert(content);
      } catch (error) {
        if (!signal.aborted) {
          setIsError(true);
          setStatusMsg(`读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, doConvert],
  );

  const loadInputFile = useCallback(
    async (fileName: string) => {
      const signal = beginRequest();

      setActiveFile(fileName);
      try {
        const content = await readInputText('ge', fileName, signal);

        if (signal.aborted) {
          return;
        }

        setInputJson(content);
        doConvert(content);
      } catch (error) {
        if (!signal.aborted) {
          setIsError(true);
          setStatusMsg(`加载失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    [beginRequest, doConvert],
  );

  const clear = () => {
    cancelRequest();
    setInputJson('');
    setOriginalData(null);
    setRoundTripData(null);
    setStatusMsg('');
    setIsError(false);
    setConversionTiming(null);
    setShallowDiffSummary([]);
    setPreservationReport(null);
    setActiveFile(null);
  };

  const previewSize = useMemo(() => {
    const data = originalData ?? roundTripData;

    if (!data) {
      return { width: 400, height: 400 };
    }
    const size = readGESceneMetadata(data).previewSize;

    if (size != null) {
      const scale = Math.min(1, 480 / size.width);

      return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
    }

    return { width: 400, height: 400 };
  }, [originalData, roundTripData]);

  const poolCount = (field: string, data: Record<string, unknown> | null) => {
    if (!data) {
      return 0;
    }

    return ((data[field] as unknown[]) ?? []).length;
  };

  const filteredFiles = fileList.filter(f => !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell ge2ir-workbench">
        <WorkbenchHeader title="GE ↔ IR 验证" description="以原始 GE 为基准，手动对比 GE ↔ IR 保真往返或标准 IR 导出的渲染结果。" />

        <div
          className="ui-workspace"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];

            if (file?.name.endsWith('.json')) {
              void loadFromFile(file);
            }
          }}
        >
          {/* Sidebar */}
          <aside className="ui-soft-panel ui-file-sidebar">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-[13px] leading-[1.45] font-semibold text-[var(--color-text-emphasis)]">
              <span>GE 输入文件</span>
              <button onClick={() => { void loadFileList(); }} className="ui-btn ui-btn-icon" title="刷新列表">
                ↻
              </button>
            </div>
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索文件..."
                aria-label="搜索文件"
                className="ui-input w-full px-2.5 py-1.5 text-[12px] leading-[1.4]"
              />
            </div>
            <div className="flex-1 overflow-y-auto py-2 text-[13px] leading-[1.45]">
              {filteredFiles.length === 0 ? (
                <div className="px-4 py-3 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  暂无文件
                </div>
              ) : (
                filteredFiles.map(f => (
                  <button
                    key={f}
                    onClick={() => { void (loadInputFile(f)); }}
                    title={f}
                    aria-current={activeFile === f ? 'true' : undefined}
                    className="ui-soft-file w-full truncate px-3 py-2 text-left"
                  >
                    {f}
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* Main content */}
          <div className="ui-workspace-content">
            {/* Toolbar */}
            <div className="ui-card ui-workspace-wide space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="round-trip-fps" className="text-[13px] text-[var(--color-text-secondary)]">转换帧率</label>
                <input
                  type="number"
                  id="round-trip-fps"
                  value={frameRate}
                  onChange={e => {
                    cancelRequest();
                    setFrameRate(Math.max(1, Number(e.target.value) || 30));
                  }}
                  className="ui-input w-20 px-2 py-1 text-[12px] leading-[1.4]"
                  min={1}
                  max={120}
                />
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  fps（GE 中不存储帧率，需手动指定）
                </span>
                <div className="flex-1" />
                <button onClick={() => fileInputRef.current?.click()} className="ui-btn ui-btn-secondary">
                  选择文件
                </button>
                <button onClick={clear} className="ui-btn ui-btn-ghost">
                  清空
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  title="选择 JSON 文件"
                  aria-label="选择 JSON 文件"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];

                    if (file) {
                      void loadFromFile(file);
                    }
                    e.target.value = '';
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">验证模式</span>
                {(
                  [
                    ['preserved-data', '保真往返'],
                    ['normalized', '标准 IR 导出'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    aria-pressed={roundTripMode === mode}
                    type="button"
                    onClick={() => {
                      cancelRequest();
                      setRoundTripMode(mode);
                      if (inputJson.trim()) {
                        doConvert(inputJson.trim(), mode);
                      }
                    }}
                    className={roundTripMode === mode ? 'ui-btn ui-btn-primary' : 'ui-btn ui-btn-secondary'}
                  >
                    {label}
                  </button>
                ))}
                <span className="text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                  {roundTripMode === 'preserved-data'
                    ? 'GE → IR → GE，携带保真数据'
                    : 'GE → IR → GE，不携带保真数据，仅导出标准 IR 可表达的内容'}
                </span>
              </div>

              {statusMsg && (
                <div className={`text-[12px] leading-[1.4] ${isError ? 'text-[var(--coral)]' : 'text-[var(--cyan)]'}`}>
                  {statusMsg}
                </div>
              )}
            </div>

            <div className="ui-card ge-source-editor flex min-w-0 flex-col">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[14px] font-semibold text-[var(--color-text-emphasis)]">输入 GE</h3>
                  <p className="mt-1 text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                    修改 GE 后重新转换，同时更新基准 GE 与往返 GE。
                  </p>
                </div>
                <button onClick={() => doConvert(inputJson.trim())} disabled={inputJson.trim() === ''}
                  className="ui-btn ui-btn-primary shrink-0 whitespace-nowrap">
                  转换并对比
                </button>
              </div>
              <textarea
                aria-label="GE JSON"
                value={inputJson}
                onChange={event => { cancelRequest(); setInputJson(event.target.value); }}
                placeholder="选择文件、拖入文件或粘贴 GE JSON。修改后点击「转换并对比」。"
                className="ui-textarea h-[280px] w-full resize-y px-3 py-2 font-mono text-[12px] leading-[1.45]"
                spellCheck={false}
              />
            </div>

            {/* Side-by-side preview */}
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 max-[900px]:grid-cols-1">
              <div className="ui-card flex min-w-0 flex-col overflow-hidden">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">基准 GE</h4>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">原始 GE，作为往返对比基准</p>
                  </div>
                  <span className="ui-badge ui-badge-gold ui-badge-tag shrink-0 whitespace-nowrap">原始输入</span>
                </div>
                <div className="mt-auto flex min-w-0 flex-col items-center gap-2">
                  <EffectsPlayer
                    effectsData={originalData}
                    width={previewSize.width}
                    height={previewSize.height}
                    showInfo
                    fitContainer
                  />
                </div>
              </div>

              <div className="ui-card flex min-w-0 flex-col overflow-hidden">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">
                      往返 GE
                    </h4>
                    <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      {roundTripMode === 'preserved-data'
                        ? '基准 GE → IR → GE，携带保真数据'
                        : '基准 GE → IR → GE，不携带保真数据'}
                    </p>
                  </div>
                  <span className="ui-badge ui-badge-cyan ui-badge-tag shrink-0 whitespace-nowrap">
                    {roundTripMode === 'preserved-data' ? '保真往返' : '标准 IR 导出'}
                  </span>
                </div>
                <div className="mt-auto flex min-w-0 flex-col items-center gap-2">
                  <EffectsPlayer
                    effectsData={roundTripData}
                    width={previewSize.width}
                    height={previewSize.height}
                    showInfo
                    fitContainer
                  />
                </div>
              </div>
            </div>

            {originalData && (
              <details className="ui-workspace-wide space-y-3">
                <summary className="cursor-pointer py-2 text-[12px] text-[var(--workbench-muted)]">
                  转换统计与保真详情
                </summary>
                {/* Stats bar */}
                {originalData && (
                  <div className="ui-card-compact">
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[13px] leading-[1.45] text-[var(--color-text-secondary)]">
                      {activeFile && (
                        <span>
                          文件：
                          <strong className="text-[var(--color-text-primary)]">{activeFile}</strong>
                        </span>
                      )}
                      <span>
                        对象数:{' '}
                        <strong className="text-[var(--color-text-primary)]">{poolCount('items', originalData)}</strong> →{' '}
                        <strong className="text-[var(--color-text-primary)]">{poolCount('items', roundTripData)}</strong>
                      </span>
                      <span>
                        组件数:{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {poolCount('components', originalData)}
                        </strong>{' '}
                        →{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {poolCount('components', roundTripData)}
                        </strong>
                      </span>
                      <span>
                        图片数:{' '}
                        <strong className="text-[var(--color-text-primary)]">{poolCount('images', originalData)}</strong> →{' '}
                        <strong className="text-[var(--color-text-primary)]">{poolCount('images', roundTripData)}</strong>
                      </span>
                      <span>
                        预览尺寸:{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {previewSize.width}×{previewSize.height}
                        </strong>
                      </span>
                      {conversionTiming != null && (
                        <>
                          <span>
                            GE → IR:{' '}
                            <strong className="text-[var(--color-text-primary)]">
                              {conversionTiming.GEToIR.toFixed(1)}ms
                            </strong>
                          </span>
                          <span>
                            IR → GE（保真往返）:{' '}
                            <strong className="text-[var(--color-text-primary)]">
                              {conversionTiming.preservedDataIRToGE.toFixed(1)}ms
                            </strong>
                          </span>
                          <span>
                            IR → GE（标准 IR 导出）:{' '}
                            <strong className="text-[var(--color-text-primary)]">
                              {conversionTiming.normalizedIRToGE == null
                                ? '不可用'
                                : `${conversionTiming.normalizedIRToGE.toFixed(1)}ms`}
                            </strong>
                          </span>
                          <span>
                            当前模式总耗时:{' '}
                            <strong className="text-[var(--color-text-primary)]">
                              {conversionTiming.selectedRoundTrip == null
                                ? '不可用'
                                : `${conversionTiming.selectedRoundTrip.toFixed(1)}ms`}
                            </strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {preservationReport && (
                  <div className="ui-card-compact">
                    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-[12px] leading-[1.45] text-[var(--color-text-secondary)]">
                      <span>
                        保真图层数:{' '}
                        <strong className="text-[var(--color-text-primary)]">{preservationReport.layerCount}</strong>
                      </span>
                      <span>
                        保真字段数:{' '}
                        <strong className="text-[var(--color-text-primary)]">{preservationReport.fieldCount}</strong>
                      </span>
                      <span>
                        合成绑定数:{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {preservationReport.compositionBindingCount}
                        </strong>
                      </span>
                      <span>
                        原始场景快照:{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {preservationReport.hasSourceScene ? '已使用' : '未使用'}
                        </strong>
                      </span>
                      <span>
                        保真导出相对标准导出的对象池增量:{' '}
                        <strong className="text-[var(--color-text-primary)]">
                          {formatRestoredPools(preservationReport.restoredPools)}
                        </strong>
                      </span>
                      <span>
                        根合成: <strong className="text-[var(--cyan)]">由 IR 重新生成</strong>
                      </span>
                    </div>
                    {preservationReport.normalizedShallowDiffs.length > 0 && (
                      <div className="mt-2 border-t border-[var(--border)] pt-2 text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">
                        保真往返与标准 IR 导出的浅层结构差异：
                        {preservationReport.normalizedShallowDiffs.slice(0, 6).join('；')}
                      </div>
                    )}
                    {preservationReport.normalizedUnavailableReason != null && (
                      <div className="mt-2 border-t border-[var(--border)] pt-2 text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">
                        标准 IR 导出不可用：{preservationReport.normalizedUnavailableReason}
                      </div>
                    )}
                  </div>
                )}

              </details>
            )}

            {/* Diff summary */}
            {shallowDiffSummary.length > 0 && (
              <div className="ui-card ui-workspace-wide">
                <h4 className="mb-2 text-[14px] leading-[1.6] font-medium text-[var(--color-text-emphasis)]">
                  浅层结构差异
                </h4>
                <div className="max-h-[300px] overflow-y-auto text-[12px] leading-[1.6] font-mono text-[var(--color-text-secondary)]">
                  {shallowDiffSummary.map((line, i) => (
                    <div key={i} className="border-b border-[var(--border)] py-1 px-2">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function computeShallowStructureDiff(
  sourceGE: Record<string, unknown>,
  roundTripGE: Record<string, unknown>,
): string[] {
  const diffs: string[] = [];
  const pools = ['compositions', 'items', 'components', 'images', 'textures', 'miscs'] as const;

  for (const pool of pools) {
    const a = (sourceGE[pool] as unknown[] | undefined) ?? [];
    const b = (roundTripGE[pool] as unknown[] | undefined) ?? [];

    if (a.length !== b.length) {
      diffs.push(`${pool}: 数量不同 (${a.length} → ${b.length})`);
    }
  }

  const comp1 = (sourceGE['compositions'] as Array<Record<string, unknown>> | undefined)?.[0];
  const comp2 = (roundTripGE['compositions'] as Array<Record<string, unknown>> | undefined)?.[0];

  if (comp1 && comp2) {
    if (comp1['duration'] !== comp2['duration']) {
      diffs.push(`composition.duration: ${comp1['duration']} → ${comp2['duration']}`);
    }
    if (comp1['endBehavior'] !== comp2['endBehavior']) {
      diffs.push(`composition.endBehavior: ${comp1['endBehavior']} → ${comp2['endBehavior']}`);
    }
  }

  const items1 = (sourceGE['items'] as Array<Record<string, unknown>> | undefined) ?? [];
  const items2 = (roundTripGE['items'] as Array<Record<string, unknown>> | undefined) ?? [];

  const makeKey = (item: Record<string, unknown>) => `${item['name']}::${item['type']}`;
  const count1 = new Map<string, number>();
  const count2 = new Map<string, number>();

  for (const item of items1) {
    const k = makeKey(item);

    count1.set(k, (count1.get(k) ?? 0) + 1);
  }
  for (const item of items2) {
    const k = makeKey(item);

    count2.set(k, (count2.get(k) ?? 0) + 1);
  }

  for (const [key, c1] of count1) {
    const c2 = count2.get(key) ?? 0;

    if (c2 < c1) {
      diffs.push(`item ${key}: ${c1} → ${c2}`);
    }
  }

  for (const [key, c2] of count2) {
    const c1 = count1.get(key) ?? 0;

    if (c2 > c1) {
      diffs.push(`item ${key}: ${c1} → ${c2} (新增)`);
    }
  }

  return diffs;
}

function buildGEPreservationReport(
  preservedData: GEToIRPreservedData,
  preservedDataGE: Record<string, unknown>,
  normalizedGE: Record<string, unknown> | null,
  normalizedUnavailableReason?: string,
): GEPreservationReport {
  const layerData = Object.values(preservedData.compositionBindings).flatMap(
    binding => Object.values(binding.layerDataById),
  );
  const restoredPools: Record<string, number> = {};

  if (normalizedGE != null) {
    for (const pool of ['compositions', 'items', 'components', 'images', 'textures', 'miscs']) {
      const preservedCount = ((preservedDataGE[pool] as unknown[] | undefined) ?? []).length;
      const normalizedCount = ((normalizedGE[pool] as unknown[] | undefined) ?? []).length;
      const restored = preservedCount - normalizedCount;

      if (restored > 0) {
        restoredPools[pool] = restored;
      }
    }
  }

  return {
    layerCount: layerData.length,
    fieldCount: layerData.reduce((total, data) => total + Object.keys(data).length, 0),
    compositionBindingCount: Object.keys(preservedData.compositionBindings).length,
    hasSourceScene: preservedData.sourceScene != null,
    restoredPools,
    normalizedShallowDiffs: normalizedGE == null ? [] : computeShallowStructureDiff(preservedDataGE, normalizedGE),
    ...(normalizedUnavailableReason != null && { normalizedUnavailableReason }),
  };
}

function formatRestoredPools(pools: Record<string, number>): string {
  const entries = Object.entries(pools);

  return entries.length === 0 ? '0' : entries.map(([pool, count]) => `${pool} +${count}`).join(', ');
}
