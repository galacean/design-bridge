import '../../styles/editing-workbench.css';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import SceneComparison from '../../features/ge-preview/scene-comparison';
import InputFileList from '../../features/local-inputs/input-file-list';
import JsonEditor from '../../components/json-editor';
import { downloadJson } from '../../features/local-inputs/download-json';
import ThemeModeDropdown from '../../components/theme-mode-dropdown';
import { useDSLEditing } from './use-dsl-editing';

const bundleEditors = [
  { slot: 'ge', label: '源 GE', filename: 'source.ge.json', hint: '粘贴 GE JSON，或从文件列表选择场景。' },
  { slot: 'dsl', label: '可编辑 DSL', filename: 'dsl.json', hint: '生成或导入 DSL 后，在这里编辑场景内容。' },
  {
    slot: 'preservedData', label: '保真数据', filename: 'preserved-data.json',
    hint: '与 DSL 配对保存的数据。通常无需修改，也可以导入已有文件。',
  },
] as const;

export default function GE2DSLBundle() {
  const {
    GEText, originalData, convertedData, convertedStats, previewEnabled,
    setPreviewEnabled, statusMsg, isError, frameRate, activeFile,
    searchQuery, setSearchQuery, editorSlot, setEditorSlot, loadFileList,
    loadInputFile, loadLocalFile, convertInput, convertBundle, clearAll,
    baseName, previewSize, preservedDataSummary, filteredFiles, preservedDataText,
    fileListError, dslText, setGEText, setDslText, setPreservedDataText,
    setFrameRate,
  } = useDSLEditing();
  const GEFileRef = useRef<HTMLInputElement>(null);
  const dslFileRef = useRef<HTMLInputElement>(null);
  const preservedDataFileRef = useRef<HTMLInputElement>(null);
  const editor = bundleEditors.find(item => item.slot === editorSlot) ?? bundleEditors[0];
  const hasError = isError || fileListError != null;
  const editorText = editorSlot === 'ge' ? GEText : editorSlot === 'dsl' ? dslText : preservedDataText;

  return (
    <div className="ui-soft-workbench bundle-workbench relative z-[1] flex min-h-screen flex-col gap-4 p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/" className="ui-btn ui-btn-ghost no-underline">← 首页</Link>
          <div>
            <h1 className="text-[20px] font-semibold leading-[1.35] text-[var(--color-text-emphasis)]">DSL 编辑</h1>
            <p className="mt-1 text-[12px] text-[var(--workbench-muted)]">拆分场景、编辑 DSL，再合成为 GE</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => GEFileRef.current?.click()} className="ui-btn ui-btn-secondary">导入 GE</button>
          <button onClick={clearAll} className="ui-btn ui-btn-ghost">清空</button>
          <ThemeModeDropdown />
        </div>
      </header>

      <main
        className="bundle-workbench-grid grid min-h-0 flex-1 gap-3"
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];

          if (file?.name.endsWith('.json')) {
            void loadLocalFile('ge', file);
          }
        }}
      >
        <InputFileList
          filteredFiles={filteredFiles} searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          activeFile={activeFile} loadFileList={loadFileList} loadInputFile={loadInputFile}
        />

        <section aria-label="场景编辑" className="ui-soft-panel flex min-h-0 min-w-0 flex-col">
          <div className="ui-soft-toolbar">
            <h2 className="font-semibold">场景编辑</h2>
            <span className="max-w-[200px] truncate text-[12px] text-[var(--workbench-muted)]" title={activeFile ?? ''}>
              {activeFile ?? '未选择文件'}
            </span>
          </div>
          <JsonEditor
            tabs={bundleEditors} slot={editorSlot} onSelect={setEditorSlot} value={editorText}
            footerLabel={editorSlot === 'preservedData' ? '与 DSL 配对使用' : 'JSON'}
            onChange={value => {
              if (editorSlot === 'ge') {
                setGEText(value);
              } else if (editorSlot === 'dsl') {
                setDslText(value);
              } else {
                setPreservedDataText(value);
              }
            }}
            onImport={() => {
              const input = editorSlot === 'ge' ? GEFileRef
                : editorSlot === 'dsl' ? dslFileRef : preservedDataFileRef;

              input.current?.click();
            }}
            onDownload={() => downloadJson(`${baseName}.${editor.filename}`, editorText)}
          />
          <div className="space-y-3 border-t border-[var(--workbench-border)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <label className="flex items-center gap-2 text-[var(--workbench-muted)]">
                导入帧率
                <input
                  type="number"
                  value={frameRate}
                  onChange={event => setFrameRate(Math.max(1, Number(event.target.value) || 30))}
                  min={1}
                  max={120}
                  className="ui-input w-16 px-2 text-[12px]"
                />
                fps
              </label>
              <span className="text-[var(--workbench-muted)]">
                {preservedDataText.trim() === '' ? '保真数据待载入' : '保真数据已载入'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={convertInput} disabled={GEText.trim() === ''} className="ui-btn ui-btn-secondary flex-1">
                生成 DSL
              </button>
              <button
                onClick={convertBundle}
                disabled={dslText.trim() === '' || preservedDataText.trim() === ''}
                className="ui-btn ui-btn-primary flex-1"
              >
                应用并预览
              </button>
            </div>
          </div>
        </section>

        <SceneComparison
          originalData={originalData} convertedData={convertedData} convertedStats={convertedStats}
          previewEnabled={previewEnabled} setPreviewEnabled={setPreviewEnabled} previewSize={previewSize}
          baseName={baseName} preservedDataSummary={preservedDataSummary}
          resultHint="应用 DSL 后查看结果" preservationHint="交付可编辑场景时，请同时保存 DSL 与保真数据。"
        />
      </main>

      <div
        role={hasError ? 'alert' : 'status'}
        aria-live="polite"
        className="flex shrink-0 items-start gap-2 px-1 text-[12px] leading-[1.5]"
      >
        <span aria-hidden="true" className={hasError ? 'text-[var(--coral)]' : 'text-[var(--workbench-accent)]'}>●</span>
        <span className={`min-w-0 break-words ${hasError ? 'text-[var(--coral)]' : 'text-[var(--workbench-muted)]'}`}>
          {fileListError ?? (statusMsg || '从文件列表选择 GE，或导入本地文件开始编辑。')}
        </span>
      </div>
      {([
        { slot: 'ge', ref: GEFileRef, label: '读取 GE JSON' },
        { slot: 'dsl', ref: dslFileRef, label: '读取 dsl.json' },
        { slot: 'preservedData', ref: preservedDataFileRef, label: '读取 preserved-data.json' },
      ] as const).map(({ slot, ref, label }) => (
        <input
          key={slot}
          ref={ref}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label={label}
          onChange={event => {
            const file = event.target.files?.[0];

            if (file != null) {
              void loadLocalFile(slot, file);
            }
            event.target.value = '';
          }}
        />
      ))}
    </div>
  );
}
