import type { SVGCaseType } from '../../features/svg-test-inputs/case-api';
import type { SVGFrameResult } from '../../features/frame-comparison/core/types';

export interface SVGCaseResult {
  name: string;
  pool: string;
  tag: string;
  noteSnapshot: string;
  pass: boolean;
  skipped: boolean;
  error?: string;
  framePassCount: number;
  frameTotal: number;
  comparisonState?: SVGFrameResult['comparisonState'];
  comparisonMessage?: string;
  fullSsim?: number;
  coreRoiSsim?: number;
  blurredSsim?: number;
  pixelDiffRatio?: number;
  localDiffDensity?: number;
  worstFrameTime?: number;
  svgDataUrl?: string;
  effectsDataUrl?: string;
  diffDataUrl?: string;
}

export interface SVGRegressionReport {
  runId: string;
  status: 'running' | 'completed' | 'stopped';
  plannedTotal: number;
  type: SVGCaseType;
  total: number;
  passCount: number;
  failCount: number;
  skipCount: number;
  completedAt?: string;
  results: SVGCaseResult[];
}

const REPORT_CHANGED = 'svg-regression-report-changed';

type ReportWindow = Window & {
  __batchReport?: SVGRegressionReport;
  __svgRegressionSnapshot?: SVGRegressionReport;
};

export function readSVGReport(): SVGRegressionReport | undefined {
  return (window as ReportWindow).__svgRegressionSnapshot;
}

export function publishSVGReport(report: SVGRegressionReport): void {
  const target = window as ReportWindow;

  target.__svgRegressionSnapshot = report;
  // Legacy batch scripts wait for a terminal report before exporting.
  if (report.status !== 'running') { target.__batchReport = report; }
  window.dispatchEvent(new Event(REPORT_CHANGED));
}

export function clearSVGReport(): void {
  const target = window as ReportWindow;

  delete target.__svgRegressionSnapshot;
  delete target.__batchReport;
  window.dispatchEvent(new Event(REPORT_CHANGED));
}

export function subscribeSVGReports(listener: (report: SVGRegressionReport | undefined) => void): () => void {
  const changed = () => listener(readSVGReport());

  window.addEventListener(REPORT_CHANGED, changed);

  return () => window.removeEventListener(REPORT_CHANGED, changed);
}
