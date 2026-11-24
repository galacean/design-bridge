import '../../styles/editing-workbench.css';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import SceneComparison from '../../features/ge-preview/scene-comparison';
import InputFileList from '../../features/local-inputs/input-file-list';
import JsonEditor from '../../components/json-editor';
import { downloadJson } from '../../features/local-inputs/download-json';
import ThemeModeDropdown from '../../components/theme-mode-dropdown';
import { useIREditing } from './use-ir-editing';

const bundleEditors = [
  { slot: 'ge', label: '源 GE', filename: 'source.ge.json', hint: '粘贴 GE JSON，或从文件列表选择场景。' },
  { slot: 'ir', label: '可编辑 IR', filename: 'ir.json', hint: '生成或导入 IR 后，在这里编辑场景内容。' },
  {
    slot: 'preservedData', label: '保真数据', filename: 'preserved-data.json',
    hint: '保真数据自动维护，包含源 GE 与原始 IR。恢复编辑时先导入此文件，再导入修改后的 IR。',
  },
] as const;

export default function IREditingPage() {
  const {
    GEText, originalData, convertedData, convertedStats, previewEnabled,
    setPreviewEnabled, statusMsg, isError, frameRate, activeFile,
    searchQuery, setSearchQuery, editorSlot, setEditorSlot, loadFileList,
    loadInputFile, loadLocalFile, convertInput, convertBundle, clearAll,
    baseName, previewSize, preservedDataSummary, filteredFiles, preservedDataText,
    fileListError, irText, session, diagnostics, setSourceText,
    setIRText, updateFrameRate,
  } = useIREditing();
  const GEFileRef = useRef<HTMLInputElement>(null);
  const irFileRef = useRef<HTMLInputElement>(null);
  const preservedDataFileRef = useRef<HTMLInputElement>(null);
  const editor = bundleEditors.find(item => item.slot === editorSlot) ?? bundleEditors[0];
  const hasError = isError || fileListError != null;
  const editorText = editorSlot === 'ge' ? GEText : editorSlot === 'ir' ? irText : preservedDataText;

  return (
    <div className="ui-soft-workbench bundle-workbench relative z-[1] flex min-h-screen flex-col gap-4 p-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 px-1">
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/" className="ui-btn ui-btn-ghost no-underline">← 首页</Link>
          <div>
            <h1 className="text-[20px] font-semibold leading-[1.35] text-[var(--color-text-emphasis)]">IR 编辑</h1>
            <p className="mt-1 text-[12px] text-[var(--workbench-muted)]">拆分场景、编辑 IR，再合成为 GE</p>
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
            readOnly={editorSlot === 'preservedData'}
            footerLabel={editorSlot === 'preservedData' ? '只读 · 与 IR 配对使用' : 'JSON'}
            onChange={value => {
              if (editorSlot === 'ge') {
                setSourceText(value);
              } else if (editorSlot === 'ir') {
                setIRText(value);
              }
            }}
            onImport={() => {
              const input = editorSlot === 'ge' ? GEFileRef
                : editorSlot === 'ir' ? irFileRef : preservedDataFileRef;

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
                  onChange={event => {
                    updateFrameRate(Number(event.target.value));
                  }}
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
                生成 IR
              </button>
              <button
                onClick={convertBundle}
                disabled={irText.trim() === '' || session == null}
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
          resultHint="应用 IR 后查看结果" preservationHint="请同时保存 IR 与保真数据。恢复时先导入保真数据，再导入修改后的 IR。"
        />
      </main>

      {diagnostics.length > 0 && (
        <details className="ui-soft-panel shrink-0 px-4 py-3 text-[12px]">
          <summary className="cursor-pointer">转换诊断（{diagnostics.length}）</summary>
          <ul className="mt-2 max-h-48 space-y-2 overflow-auto">
            {diagnostics.map((diagnostic, index) => (
              <li key={index} className="break-words">
                {diagnostic.severity} · {diagnostic.message}
                <span className="text-[var(--workbench-muted)]"> {diagnostic.path}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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
        { slot: 'ir', ref: irFileRef, label: '读取 ir.json' },
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
