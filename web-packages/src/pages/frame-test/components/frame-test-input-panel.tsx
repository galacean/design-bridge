import type { RefObject } from 'react';
import type { TestStatus } from '../hooks/use-frame-comparison-session';

interface FrameTestInputPanelProps {
  urlInput: string;
  setUrlInput: (value: string) => void;
  isRunning: boolean;
  loadFromUrl: () => Promise<void>;
  clear: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFromFile: (file: File) => Promise<void>;
  status: TestStatus;
  statusMsg: string;
}

export function FrameTestInputPanel(props: FrameTestInputPanelProps) {
  const { urlInput, setUrlInput, isRunning, loadFromUrl, clear, fileInputRef, loadFromFile, status, statusMsg } = props;

  return (
    <div className="ui-card space-y-3">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { void loadFromUrl(); } }}
          placeholder="输入 Lottie JSON 的 URL 地址..."
          aria-label="Lottie JSON URL"
          disabled={isRunning}
          className="ui-input min-w-0 flex-1 px-3 text-[13px]"
        />
        <button
          onClick={() => { void loadFromUrl(); }}
          disabled={!urlInput.trim() || isRunning}
          className="ui-btn ui-btn-primary"
        >
          从 URL 加载
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isRunning}
          className="ui-btn ui-btn-secondary"
        >
          选择文件
        </button>
        <button
          onClick={clear}
          className="ui-btn ui-btn-ghost"
        >
          清空
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          title="选择 Lottie JSON 文件"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];

            if (file) {
              void loadFromFile(file);
            }
            e.target.value = '';
          }}
        />
        {statusMsg && (
          <span
            role={status === 'error' ? 'alert' : 'status'}
            className={`text-xs ml-2 ${
              status === 'error' ? 'text-[var(--coral)]' : status === 'done' ? 'text-[var(--cyan)]' : 'text-[var(--workbench-muted)]'
            }`}
          >
            {statusMsg}
          </span>
        )}
      </div>
    </div>
  );
}
