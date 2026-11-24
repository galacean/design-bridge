import { useRef } from 'react';

interface JsonEditorProps<Slot extends string> {
  tabs: ReadonlyArray<{ slot: Slot; label: string; filename: string; hint: string }>;
  slot: Slot;
  onSelect: (slot: Slot) => void;
  value: string;
  onChange: (value: string) => void;
  onImport: () => void;
  onDownload: () => void;
  readOnly?: boolean;
  footerLabel: string;
}

export default function JsonEditor<Slot extends string>({
  tabs, slot, onSelect, value, onChange, onImport, onDownload, readOnly = false, footerLabel,
}: JsonEditorProps<Slot>) {
  const editorTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const editor = tabs.find(item => item.slot === slot) ?? tabs[0];

  return (
    <>
      <div role="tablist" aria-label="编辑文件" className="ui-soft-tabs mx-4 flex shrink-0 gap-1 p-1">
        {tabs.map((item, index) => (
          <button
            key={item.slot}
            ref={node => { editorTabRefs.current[index] = node; }}
            id={`bundle-tab-${item.slot}`}
            role="tab"
            aria-selected={slot === item.slot}
            aria-controls="bundle-editor-panel"
            tabIndex={slot === item.slot ? 0 : -1}
            onClick={() => onSelect(item.slot)}
            onKeyDown={event => {
              let nextIndex = index;

              if (event.key === 'ArrowRight') {
                nextIndex = (index + 1) % tabs.length;
              } else if (event.key === 'ArrowLeft') {
                nextIndex = (index + tabs.length - 1) % tabs.length;
              } else if (event.key === 'Home') {
                nextIndex = 0;
              } else if (event.key === 'End') {
                nextIndex = tabs.length - 1;
              } else {
                return;
              }
              event.preventDefault();
              onSelect(tabs[nextIndex].slot);
              editorTabRefs.current[nextIndex]?.focus();
            }}
            className="min-w-0 flex-1 whitespace-nowrap px-2 py-2 text-[12px]"
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        id="bundle-editor-panel"
        role="tabpanel"
        aria-labelledby={`bundle-tab-${slot}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="font-mono text-[12px] text-[var(--workbench-muted)]">{editor.filename}</span>
          <div className="flex gap-2">
            <button
              onClick={onImport}
              className="ui-btn ui-btn-ghost ui-btn-sm"
            >
              导入
            </button>
            <button
              onClick={onDownload}
              disabled={value.trim() === ''}
              className="ui-btn ui-btn-ghost ui-btn-sm"
            >
              下载
            </button>
          </div>
        </div>
        <textarea
          aria-label={editor.label}
          value={value}
          readOnly={readOnly}
          onChange={event => onChange(event.target.value)}
          placeholder={editor.hint}
          spellCheck={false}
          className="ui-textarea mx-4 min-h-[300px] flex-1 resize-none px-3 py-3 font-mono
            text-[12px] leading-[1.7] min-[900px]:min-h-0"
        />
        <div
          className="flex shrink-0 items-center justify-between px-4 py-2 text-[11px] text-[var(--workbench-muted)]"
        >
          <span>{footerLabel}</span>
          <span>{formatCount(value.length)} 字符</span>
        </div>
      </div>
    </>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}
