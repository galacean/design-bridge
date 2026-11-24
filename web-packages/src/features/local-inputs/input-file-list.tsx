interface InputFileListProps {
  filteredFiles: string[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  activeFile: string | null;
  loadFileList: () => Promise<void>;
  loadInputFile: (filename: string) => Promise<void>;
}

export default function InputFileList({
  filteredFiles, searchQuery, setSearchQuery, activeFile, loadFileList, loadInputFile,
}: InputFileListProps) {
  return (
    <aside aria-label="GE 文件" className="ui-soft-panel flex min-h-0 min-w-0 flex-col">
      <div className="ui-soft-toolbar">
        <div className="flex items-baseline gap-2">
          <h2 className="font-semibold">GE 文件</h2>
          <span className="text-[12px] text-[var(--workbench-muted)]">{filteredFiles.length}</span>
        </div>
        <button
          onClick={() => { void loadFileList(); }} className="ui-btn-icon" aria-label="刷新文件列表"
        >
          ↻
        </button>
      </div>
      <div className="px-3 pb-3">
        <input
          aria-label="搜索 GE 文件"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="搜索文件…"
          className="ui-input w-full px-3 text-[12px]"
        />
      </div>
      <div className="min-h-0 max-h-[220px] flex-1 overflow-y-auto px-2 pb-3 min-[900px]:max-h-none">
        {filteredFiles.length === 0 ? (
          <p className="px-2 py-6 text-center text-[12px] text-[var(--workbench-muted)]">
            {searchQuery.trim() === '' ? '暂无文件，可导入本地 GE。' : '没有匹配的文件'}
          </p>
        ) : filteredFiles.map(file => (
          <button
            key={file}
            onClick={() => { void loadInputFile(file); }}
            aria-current={activeFile === file ? 'true' : undefined}
            title={file}
            className="ui-soft-file w-full truncate px-3 py-2 text-left text-[12px] leading-[1.5]"
          >
            {file}
          </button>
        ))}
      </div>
      <div
        className="border-t border-[var(--workbench-border)] px-4 py-3 text-[12px] text-[var(--workbench-muted)]"
      >
        支持拖入 GE JSON 文件
      </div>
    </aside>
  );
}
