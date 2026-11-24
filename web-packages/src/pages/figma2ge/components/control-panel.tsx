import type React from 'react';
import { Link } from 'react-router-dom';
import type { ConvertStatus } from '../types';

interface ControlPanelProps {
  dragOver: boolean;
  fileName: string | null;
  status: ConvertStatus;
  error: string | null;
  includeInvisibleNodes: boolean;
  compositionName: string;
  compositionDuration: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  setDragOver: (value: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setIncludeInvisibleNodes: (value: boolean) => void;
  setCompositionName: (value: string) => void;
  setCompositionDuration: (value: string) => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const {
    dragOver,
    fileName,
    status,
    error,
    includeInvisibleNodes,
    compositionName,
    compositionDuration,
    fileInputRef,
    setDragOver,
    onDrop,
    onPickFile,
    setIncludeInvisibleNodes,
    setCompositionName,
    setCompositionDuration,
  } = props;

  return (
    <div className="ui-card p-5">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        ← 返回首页
      </Link>
      <div className="flex items-center gap-3 mb-4">
        <div className="ui-nav-card-icon ui-nav-card-icon-cyan h-[40px] min-w-[40px] text-[16px]">✦</div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-emphasis)] tracking-tight">
            Figma to Galacean Effects
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">上传 JSON，快速验证转换与运行时风险</p>
        </div>
      </div>

      <div
        className="ui-dropzone mb-3"
        data-active={dragOver ? 'true' : 'false'}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="text-3xl mb-2 opacity-50 leading-none">🎨</div>
        <div className="text-[13px] font-medium text-[var(--color-text-primary)]">拖放或点击上传</div>
        <div className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
          支持 .json（Figma decoded）或 .fig 文件
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".json,.fig" className="hidden" onChange={onPickFile} />

      <div className="ui-card-compact space-y-2.5 px-3 py-3">
        <div className="ui-kicker">调试参数</div>
        <label className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-primary)]">
          <span>合成名</span>
          <input
            value={compositionName}
            onChange={e => setCompositionName(e.target.value)}
            className="ui-input w-[170px] px-2 text-[12px]"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-primary)]">
          <span>时长(s)</span>
          <input
            value={compositionDuration}
            onChange={e => setCompositionDuration(e.target.value)}
            className="ui-input w-[80px] px-2 text-[12px]"
          />
        </label>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-[var(--color-text-primary)]">
          <input
            type="checkbox"
            checked={includeInvisibleNodes}
            onChange={e => setIncludeInvisibleNodes(e.target.checked)}
          />
          <span>包含不可见节点</span>
        </label>
      </div>

      {fileName && (
        <div className="ui-card-compact mt-3 flex items-center gap-2 px-3 py-2">
          <span className="truncate text-[12px] font-medium text-[var(--color-text-emphasis)]">{fileName}</span>
          {status === 'done' ? <span className="text-[11px] text-[var(--cyan)]">✓ 成功</span> : null}
          {status === 'error' ? <span className="text-[11px] text-[var(--coral)]">✕ 失败</span> : null}
        </div>
      )}

      {error && (
        <div className="ui-callout ui-callout-danger mt-3 px-3 py-2 text-[12px] leading-relaxed text-[var(--color-text-danger)]">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
