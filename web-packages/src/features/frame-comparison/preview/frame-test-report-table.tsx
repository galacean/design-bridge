import { isFramePass } from '../core/frame-comparison-config';
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

interface FrameTestReportTableProps {
  results: FrameResult[];
  selectedFrame: number;
  setSelectedFrame: (index: number) => void;
}

export function FrameTestReportTable(props: FrameTestReportTableProps) {
  const { results, selectedFrame, setSelectedFrame } = props;
  const showEdgeIoU = results.some(result => result.format !== 'svg');
  const showLocalDiffDensity = results.some(result => result.format === 'svg');
  const metricHeaderClass = 'text-left py-2 px-2 text-[var(--workbench-muted)] font-medium' +
    (showLocalDiffDensity ? ' whitespace-nowrap' : '');

  return (
    <div className={showLocalDiffDensity ? 'border-t border-[var(--workbench-border)] pt-4'
      : 'bg-[var(--workbench-surface)] rounded-2xl border border-[var(--workbench-border)] p-5'}>
      <h2 className="text-sm font-semibold text-[var(--color-text-emphasis)] mb-3">
        {showLocalDiffDensity ? '逐帧结果' : '测试报告'}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--workbench-border)]">
              <th className="text-left py-2 px-2 text-[var(--workbench-muted)] font-medium">帧</th>
              <th className="text-left py-2 px-2 text-[var(--workbench-muted)] font-medium">时间</th>
              <th title={showLocalDiffDensity ? '全图多尺度结构相似度，越高越相似' : undefined}
                className={metricHeaderClass}>
                {showLocalDiffDensity ? '全图相似度' : '全图'}
              </th>
              <th title={showLocalDiffDensity ? '裁去四周约 10% 后计算相似度，区域过小时使用全图' : undefined}
                className={metricHeaderClass}>
                {showLocalDiffDensity ? '中心相似度' : '核心 ROI'}
              </th>
              <th title={showLocalDiffDensity ? '模糊后计算的全图相似度，越高越相似' : undefined}
                className={metricHeaderClass}>
                {showLocalDiffDensity ? '模糊相似度' : '模糊后'}
              </th>
              {showEdgeIoU && <th className="text-left py-2 px-2 text-[var(--workbench-muted)] font-medium">轮廓 IoU</th>}
              <th title={showLocalDiffDensity ? '颜色或透明度差异超过阈值的像素占比' : undefined}
                className={metricHeaderClass}>
                {showLocalDiffDensity ? '像素差异率' : '像素差异'}
              </th>
              {showLocalDiffDensity && <th title="局部窗口中排除抗锯齿后的最大差异占比"
                className="text-left py-2 px-2 text-[var(--workbench-muted)] font-medium whitespace-nowrap">
                最大局部差异率
              </th>}
              <th className="text-left py-2 px-2 text-[var(--workbench-muted)] font-medium">结果</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => {
              const label = getOverallResult(result);
              const edgeIoU = getEdgeIoU(result);
              const localDiffDensity = getLocalDiffDensity(result);

              return (
                <tr
                  key={index}
                  aria-current={showLocalDiffDensity && selectedFrame === index ? 'true' : undefined}
                  onClick={() => setSelectedFrame(index)}
                  tabIndex={showLocalDiffDensity ? 0 : undefined}
                  onKeyDown={showLocalDiffDensity ? event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedFrame(index);
                    }
                  } : undefined}
                  className={`border-b border-[var(--s1)] cursor-pointer transition-colors ${
                    selectedFrame === index ? 'bg-[var(--workbench-accent-dim)]' : 'hover:bg-[var(--s1)]'
                  }`}
                >
                  <td className="py-1.5 px-2 text-[var(--workbench-muted)]">{index + 1}</td>
                  <td className="py-1.5 px-2 text-[var(--color-text-emphasis)]">{result.time.toFixed(2)}s</td>
                  <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgeFullSsim(result.fullSsim)]}`}>
                    {formatScore(result.fullSsim)}
                  </td>
                  <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgeCoreRoiSsim(result.coreRoiSsim)]}`}>
                    {formatScore(result.coreRoiSsim)}
                  </td>
                  <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgeBlurredSsim(result.blurredSsim)]}`}>
                    {formatScore(result.blurredSsim)}
                  </td>
                  {showEdgeIoU && <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgeEdgeIoU(edgeIoU)]}`}>
                    {formatScore(edgeIoU)}
                  </td>}
                  <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgePixelDiffRatio(result.pixelDiffRatio)]}`}>
                    {formatPercent(result.pixelDiffRatio)}
                  </td>
                  {showLocalDiffDensity && <td className={`py-1.5 px-2 font-mono ${LEVEL_COLOR[judgeLocalDiffDensity(localDiffDensity)]}`}>
                    {formatPercent(localDiffDensity)}
                  </td>}
                  <td className={`py-1.5 px-2 ${label.color}`}>{label.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--workbench-border)] text-xs text-[var(--workbench-muted)]">
        {(() => {
          const minFull = Math.min(...results.map(result => result.fullSsim));
          const minCore = Math.min(...results.map(result => result.coreRoiSsim));
          const minBlurred = Math.min(...results.map(result => result.blurredSsim));
          const edges = results.map(getEdgeIoU).filter((value): value is number => value != null);
          const minEdgeIoU = edges.length > 0 ? Math.min(...edges) : undefined;
          const localDiffs = results.map(getLocalDiffDensity).filter((value): value is number => value != null);
          const maxLocalDiff = localDiffs.length > 0 ? Math.max(...localDiffs) : undefined;
          const maxPixelDiff = Math.max(...results.map(result => result.pixelDiffRatio));
          const passCount = results.filter(result => isFramePass(result)).length;
          const skipCount = results.filter(result => result.comparisonState === 'source-static').length;
          const failCount = results.length - passCount - skipCount;

          return (
            <div className="flex gap-6 flex-wrap">
              <span>
                {showLocalDiffDensity ? '最低全图相似度:' : '最低全图:'}{' '}
                <strong className={LEVEL_COLOR[judgeFullSsim(minFull)]}>{formatScore(minFull)}</strong>
              </span>
              <span>
                {showLocalDiffDensity ? '最低中心相似度:' : '最低核心 ROI:'}{' '}
                <strong className={LEVEL_COLOR[judgeCoreRoiSsim(minCore)]}>{formatScore(minCore)}</strong>
              </span>
              <span>
                {showLocalDiffDensity ? '最低模糊相似度:' : '最低模糊后:'}{' '}
                <strong className={LEVEL_COLOR[judgeBlurredSsim(minBlurred)]}>{formatScore(minBlurred)}</strong>
              </span>
              {showEdgeIoU && <span>
                最低轮廓 IoU:{' '}
                <strong className={LEVEL_COLOR[judgeEdgeIoU(minEdgeIoU)]}>{formatScore(minEdgeIoU)}</strong>
              </span>}
              <span>
                {showLocalDiffDensity ? '最大像素差异率:' : '最大像素差异:'}{' '}
                <strong className={LEVEL_COLOR[judgePixelDiffRatio(maxPixelDiff)]}>
                  {formatPercent(maxPixelDiff)}
                </strong>
              </span>
              {showLocalDiffDensity && <span>
                最大局部差异率:{' '}
                <strong className={LEVEL_COLOR[judgeLocalDiffDensity(maxLocalDiff)]}>{formatPercent(maxLocalDiff)}</strong>
              </span>}
              <span>
                PASS:{' '}
                <strong className="text-[var(--cyan)]">
                  {passCount}/{results.length}
                </strong>
              </span>
              {skipCount > 0 && <span>SKIP: {skipCount}/{results.length}</span>}
              {failCount > 0 && (
                <span>
                  FAIL:{' '}
                  <strong className="text-[var(--coral)]">
                    {failCount}/{results.length}
                  </strong>
                </span>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
