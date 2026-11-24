import type { OutputMode } from '../types';

interface OutputPanelProps {
  output: string;
  outputMode: OutputMode;
  copied: boolean;
  setMode: (mode: OutputMode) => void;
  copyOutput: () => Promise<void>;
  downloadOutput: () => void;
}

export default function OutputPanel(props: OutputPanelProps) {
  const { output, outputMode, copied, setMode, copyOutput, downloadOutput } = props;

  return (
    <div className="ui-card-compact p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="ui-kicker">输出 JSON</span>
          <button
            onClick={() => setMode('scene')}
            className={`ui-btn ui-btn-xs ${outputMode === 'scene' ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
          >
            仅 scene
          </button>
          <button
            onClick={() => setMode('full')}
            className={`ui-btn ui-btn-xs ${outputMode === 'full' ? 'ui-btn-primary' : 'ui-btn-ghost'}`}
          >
            完整结果
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => { void copyOutput(); }} className="ui-btn ui-btn-xs ui-btn-ghost">
            {copied ? '✓ 已复制' : '复制'}
          </button>
          <button onClick={downloadOutput} className="ui-btn ui-btn-xs ui-btn-secondary">
            下载
          </button>
        </div>
      </div>
      <pre className="ui-code max-h-[560px] text-[12px] leading-relaxed text-[var(--color-text-primary)]">{output}</pre>
    </div>
  );
}
