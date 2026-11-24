import { useState } from 'react';
import type { FrameResult } from '../core/types';
import {
  LEVEL_COLOR,
  formatPercent,
  formatScore,
  getEdgeIoU,
  getLocalDiffDensity,
  getOverallResult,
  judgeBlurredSsim,
  judgeCoreRoiSsim,
  judgeEdgeIoU,
  judgeFullSsim,
  judgePixelDiffRatio,
  judgeLocalDiffDensity,
} from './frame-metrics';

export type FramePreviewBackground = 'black' | 'white' | 'grid';

const backgrounds: Array<{ id: FramePreviewBackground; label: string; value: string }> = [
  { id: 'black', label: '黑色背景', value: '#000' },
  { id: 'white', label: '白色背景', value: '#fff' },
  {
    id: 'grid', label: '棋盘格背景',
    value: 'conic-gradient(#d8dce3 25%, #f4f5f7 0 50%, #d8dce3 0 75%, #f4f5f7 0) 0 0 / 16px 16px',
  },
];

export function getFramePreviewBackground(background: FramePreviewBackground): string {
  return backgrounds.find(item => item.id === background)?.value ?? '#000';
}

export function FramePreviewBackgroundControls({ value, onChange, label = '预览背景' }: {
  value: FramePreviewBackground; onChange: (value: FramePreviewBackground) => void; label?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 text-xs text-[var(--workbench-muted)]">
      <span>预览背景</span>
      <div role="group" aria-label={label} className="flex items-center gap-2">
        {backgrounds.map(item => <button
          key={item.id} type="button" aria-label={item.label} aria-pressed={value === item.id}
          title={`${item.label}，仅影响显示`} onClick={() => onChange(item.id)}
          className="h-7 w-7 border border-[var(--workbench-border)] max-sm:h-10 max-sm:w-10"
          style={{
            background: item.value,
            boxShadow: value === item.id ? '0 0 0 2px var(--workbench-accent)' : undefined,
          }}
        />)}
      </div>
    </div>
  );
}

interface FrameTestPreviewProps {
  currentResult: FrameResult;
  selectedFrame: number;
  setSelectedFrame: (index: number) => void;
  results: FrameResult[];
  labels?: [string, string];
  background?: FramePreviewBackground;
  onBackgroundChange?: (value: FramePreviewBackground) => void;
}

export function FrameTestPreview(props: FrameTestPreviewProps) {
  const { currentResult, selectedFrame, setSelectedFrame, results, labels = ['Lottie 原始', 'GE 转换'] } = props;
  const [localBackground, setLocalBackground] = useState<FramePreviewBackground>('black');
  const background = props.background ?? localBackground;
  const selectedBackground = getFramePreviewBackground(background);
  const isSvg = currentResult.format === 'svg';
  const edgeIoU = getEdgeIoU(currentResult);
  const localDiffDensity = getLocalDiffDensity(currentResult);
  const images = [
    { src: currentResult.lottieDataUrl, label: labels[0], badge: 'ui-badge-gold',
      alt: !isSvg && props.labels == null ? 'Lottie frame' : `${labels[0]} frame` },
    { src: currentResult.effectsDataUrl, label: labels[1], badge: 'ui-badge-cyan',
      alt: !isSvg && props.labels == null ? 'GE frame' : `${labels[1]} frame` },
    { src: currentResult.diffDataUrl, label: '差异热力图', badge: 'ui-badge-danger', alt: 'Diff map' },
  ];

  return (
    <div className="space-y-4">
      {isSvg && <FramePreviewBackgroundControls value={background} onChange={value => {
        setLocalBackground(value);
        props.onBackgroundChange?.(value);
      }} />}
      {isSvg ? <div className="grid grid-cols-3 items-start gap-2">
        {images.map(image => <div key={image.alt} className="flex min-w-0 justify-center text-center">
          <div className={`ui-badge ${image.badge}`}>{image.label}</div>
        </div>)}
        {images.map((image, index) => <div key={image.alt} className="flex min-w-0 justify-center">
          <div
            className="flex w-full max-w-[300px] justify-center overflow-hidden rounded-lg border border-[var(--workbench-border)]"
            style={{ background: index === 2 && background === 'black' ? 'var(--preview-bg)' : selectedBackground }}
          >
            <img src={image.src} alt={image.alt} className="block h-auto w-auto" style={{ maxWidth: '100%', maxHeight: 300 }} />
          </div>
        </div>)}
      </div> : <div className="flex gap-4 justify-center flex-wrap">
        {images.map((image, index) => <div key={image.alt} className="flex flex-col items-center gap-2">
          <div className={`ui-badge ${image.badge}`}>{image.label}</div>
          <div className={`border border-[var(--workbench-border)] rounded-xl overflow-hidden ${
            index === 2 ? 'bg-[var(--preview-bg)]' : 'bg-black'
          }`}>
            <img src={image.src} alt={image.alt} className="block" style={{ maxWidth: 300, maxHeight: 300 }} />
          </div>
        </div>)}
      </div>}

      <div className="text-center text-sm text-[var(--workbench-muted)] space-y-1">
        <div>
          帧 {selectedFrame + 1}/{results.length} · t={currentResult.time.toFixed(2)}s ·{' '}
          <span className={`font-semibold ${getOverallResult(currentResult).color}`}>
            {getOverallResult(currentResult).text}
          </span>
        </div>
        {isSvg ? <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs tabular-nums text-[var(--workbench-muted)]">
          <div className="flex max-w-full shrink-0 flex-wrap justify-center gap-x-3 gap-y-1">
            <span className="whitespace-nowrap" title="全图多尺度结构相似度，越高越相似">
              全图相似度:{' '}
              <span className={LEVEL_COLOR[judgeFullSsim(currentResult.fullSsim)]}>
                {formatScore(currentResult.fullSsim)}
              </span>
            </span>
            <span className="whitespace-nowrap" title="裁去四周约 10% 后计算相似度，区域过小时使用全图">
              中心相似度:{' '}
              <span className={LEVEL_COLOR[judgeCoreRoiSsim(currentResult.coreRoiSsim)]}>
                {formatScore(currentResult.coreRoiSsim)}
              </span>
            </span>
            <span className="whitespace-nowrap" title="模糊后计算的全图相似度，越高越相似">
              模糊相似度:{' '}
              <span className={LEVEL_COLOR[judgeBlurredSsim(currentResult.blurredSsim)]}>
                {formatScore(currentResult.blurredSsim)}
              </span>
            </span>
          </div>
          <div className="flex max-w-full shrink-0 flex-wrap justify-center gap-x-3 gap-y-1">
            <span className="whitespace-nowrap" title="局部窗口中排除抗锯齿后的最大差异占比">
              最大局部差异率:{' '}
              <span className={`inline-block min-w-[4.2em] text-left ${LEVEL_COLOR[judgeLocalDiffDensity(localDiffDensity)]}`}>
                {formatPercent(localDiffDensity)}
              </span>
            </span>
            <span className="whitespace-nowrap" title="颜色或透明度差异超过阈值的像素占比">
              像素差异率:{' '}
              <span className={`inline-block min-w-[4.2em] text-left ${LEVEL_COLOR[judgePixelDiffRatio(currentResult.pixelDiffRatio)]}`}>
                {formatPercent(currentResult.pixelDiffRatio)}
              </span>
            </span>
          </div>
        </div> : <div className="text-xs text-[var(--workbench-muted)]">
          全图:{' '}
          <span className={LEVEL_COLOR[judgeFullSsim(currentResult.fullSsim)]}>
            {formatScore(currentResult.fullSsim)}
          </span>
          {' · 核心 ROI: '}
          <span className={LEVEL_COLOR[judgeCoreRoiSsim(currentResult.coreRoiSsim)]}>
            {formatScore(currentResult.coreRoiSsim)}
          </span>
          {' · 模糊后: '}
          <span className={LEVEL_COLOR[judgeBlurredSsim(currentResult.blurredSsim)]}>
            {formatScore(currentResult.blurredSsim)}
          </span>
          {' · 轮廓 IoU: '}
          <span className={LEVEL_COLOR[judgeEdgeIoU(edgeIoU)]}>{formatScore(edgeIoU)}</span>
          {' · 像素差异: '}
          <span className={LEVEL_COLOR[judgePixelDiffRatio(currentResult.pixelDiffRatio)]}>
            {formatPercent(currentResult.pixelDiffRatio)}
          </span>
        </div>}
        {currentResult.comparisonState != null && currentResult.comparisonState !== 'comparable' &&
          currentResult.comparisonMessage != null && <p>{currentResult.comparisonMessage}</p>}
      </div>

      <div className="flex items-center gap-3 px-4">
        <span className="text-xs text-[var(--workbench-muted)] w-12 text-right">0.00s</span>
        {isSvg && <button type="button" className="ui-btn ui-btn-icon" aria-label="上一帧" title="上一帧"
          disabled={selectedFrame === 0} onClick={() => setSelectedFrame(selectedFrame - 1)}>‹</button>}
        <input
          type="range"
          aria-label={isSvg ? '选择对比帧' : undefined}
          min={0}
          max={results.length - 1}
          value={selectedFrame}
          onChange={e => setSelectedFrame(Number(e.target.value))}
          title="时间轴"
          className="flex-1 h-2 accent-[var(--workbench-accent)] cursor-pointer"
        />
        {isSvg && <button type="button" className="ui-btn ui-btn-icon" aria-label="下一帧" title="下一帧"
          disabled={selectedFrame >= results.length - 1} onClick={() => setSelectedFrame(selectedFrame + 1)}>›</button>}
        <span className="text-xs text-[var(--workbench-muted)] w-12">
          {results.length > 0 ? `${results[results.length - 1].time.toFixed(2)}s` : ''}
        </span>
      </div>
    </div>
  );
}
