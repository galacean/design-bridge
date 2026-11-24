import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import WorkbenchHeader from '../../components/workbench-header';

type CheckIssue = {
  code: string;
  label: string;
  message: string;
  path: string;
  layerId: string | null;
};
type CheckResult = {
  result: 'pass' | 'fail';
  summary: string;
  errors: CheckIssue[];
  warnings: CheckIssue[];
};
type CheckedFile = {
  file: string;
  size: number;
  modifiedAt: string | null;
  elapsedMs: number;
  check: CheckResult;
};
type ScanSummary = {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  warnings: number;
  elapsedMs: number;
};
type ScanResponse = {
  manifest: string;
  detector: string;
  detectorRevision: string | null;
  detectorSha256: string;
  runtimeVersion: string;
  summary: ScanSummary;
  files: CheckedFile[];
  error?: string;
};
type IssueFilter = 'all' | 'error' | 'warning';
type SummaryCardProps = {
  label: string;
  value: number | string;
  tone?: 'default' | 'pass' | 'warning' | 'fail';
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string | null): string {
  if (iso == null) {
    return '—';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

function fileStatus(file: CheckedFile): 'pass' | 'warning' | 'fail' {
  if (file.check.result === 'fail') {
    return 'fail';
  }

  return file.check.warnings.length > 0 ? 'warning' : 'pass';
}

function statusLabel(status: ReturnType<typeof fileStatus>): string {
  if (status === 'fail') {
    return 'FAIL';
  }
  if (status === 'warning') {
    return 'WARN';
  }

  return 'PASS';
}

function statusBadgeClass(status: ReturnType<typeof fileStatus>): string {
  if (status === 'fail') {
    return 'ui-badge-danger';
  }
  if (status === 'warning') {
    return 'ui-badge-gold';
  }

  return 'ui-badge-cyan';
}

function SummaryCard({ label, value, tone = 'default' }: SummaryCardProps) {
  const toneClass =
    tone === 'pass'
      ? 'text-[var(--cyan)]'
      : tone === 'warning'
        ? 'text-[var(--gold)]'
        : tone === 'fail'
          ? 'text-[var(--coral)]'
          : 'text-[var(--color-text-emphasis)]';

  return (
    <div className="ui-card-compact min-w-0">
      <div className="ui-kicker mb-2">{label}</div>
      <div className={`text-[26px] font-semibold leading-none ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function DSLValidator() {
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const requestIdRef = useRef(0);

  const runCheck = useCallback(async () => {
    const requestId = requestIdRef.current + 1;

    requestIdRef.current = requestId;
    setLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch('/api/dsl-validator/check');
      const data = (await response.json()) as ScanResponse;

      if (!response.ok || data.error) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      if (requestId !== requestIdRef.current) {
        return;
      }

      setScan(data);
      setSelectedFile(current => {
        if (current && data.files.some(file => file.file === current)) {
          return current;
        }

        return data.files.find(file => file.check.result === 'fail')?.file ?? data.files[0]?.file ?? null;
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setErrorMessage(error instanceof Error ? error.message : String(error));
      setScan(null);
      setSelectedFile(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const visibleFiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const files = scan?.files ?? [];

    if (!query) {
      return files;
    }

    return files.filter(file => {
      if (file.file.toLowerCase().includes(query)) {
        return true;
      }

      return [...file.check.errors, ...file.check.warnings].some(
        issue =>
          issue.code.toLowerCase().includes(query) ||
          issue.label.toLowerCase().includes(query) ||
          issue.message.toLowerCase().includes(query) ||
          issue.path.toLowerCase().includes(query) ||
          issue.layerId?.toLowerCase().includes(query),
      );
    });
  }, [scan, searchQuery]);

  const activeFile = scan?.files.find(file => file.file === selectedFile) ?? null;
  const visibleIssues = useMemo(() => {
    if (!activeFile) {
      return [];
    }
    if (issueFilter === 'error') {
      return activeFile.check.errors.map(issue => ({ ...issue, severity: 'ERROR' as const }));
    }
    if (issueFilter === 'warning') {
      return activeFile.check.warnings.map(issue => ({ ...issue, severity: 'WARNING' as const }));
    }

    return [
      ...activeFile.check.errors.map(issue => ({ ...issue, severity: 'ERROR' as const })),
      ...activeFile.check.warnings.map(issue => ({ ...issue, severity: 'WARNING' as const })),
    ];
  }, [activeFile, issueFilter]);

  return (
    <div className="ui-soft-workbench min-h-screen">
      <div className="ui-page-shell dsl-validator-workbench">
        <WorkbenchHeader title="DSL 格式校验" description="批量检查 DSL 文件，定位结构错误与语义警告。" />

        <section className="mb-4">
          <div className="ui-card-compact flex flex-wrap items-end gap-3">
            <label className="min-w-[240px] flex-1">
              <span className="mb-1 block text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                筛选文件或问题
              </span>
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="文件名、检查码、字段路径、layer id..."
                className="ui-input w-full px-3 text-[12px] leading-[1.4]"
              />
            </label>

            <button
              type="button"
              onClick={() => { void runCheck(); }}
              disabled={loading}
              className="ui-btn ui-btn-primary max-[768px]:min-h-10"
            >
              {loading ? '检测中…' : '重新检测'}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
            仅错误（ERROR）导致校验失败；警告（WARNING）保留供检查，不影响通过。
          </p>
        </section>

        <div role="status" aria-live="polite" className="mb-4 min-h-5 text-[12px] leading-[1.4]">
          {loading && <span className="text-[var(--cyan)]">正在调用 validateDSL 读取 URL 清单…</span>}
          {!loading && errorMessage && <span className="text-[var(--coral)]">检测失败：{errorMessage}</span>}
          {!loading && !errorMessage && scan && (
            <span className="text-[var(--color-text-secondary)]">
              完成于 {scan.summary.elapsedMs.toFixed(1)}ms，共扫描 {scan.summary.total} 个 JSON 文件。
            </span>
          )}
        </div>

        <details className="mb-3">
          <summary className="cursor-pointer py-2 text-[12px] text-[var(--workbench-muted)]">输入清单与版本信息</summary>
          <div className="ui-callout ui-callout-violet">
            <div
              className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12px] leading-[1.45]
                max-[768px]:grid-cols-1 max-[768px]:gap-y-1"
            >
              <span className="text-[var(--color-text-secondary)]">输入清单</span>
              <code className="break-all font-mono text-[var(--color-text-emphasis)]">
                {scan?.manifest ?? 'web-packages/tests/fixtures/dsl/urls.txt'}
              </code>
              <span className="text-[var(--color-text-secondary)]">检测器</span>
              <code className="break-all font-mono text-[var(--color-text-emphasis)]">
                {scan?.detector ?? '@galacean/dsl-ir/validateDSL'}
              </code>
              <span className="text-[var(--color-text-secondary)]">检测器版本</span>
              <code className="break-all font-mono text-[var(--color-text-emphasis)]">
                {scan?.detectorRevision ?? 'unknown'}
              </code>
              <span className="text-[var(--color-text-secondary)]">SHA-256 / Runtime</span>
              <code className="break-all font-mono text-[var(--color-text-emphasis)]">
                {scan ? `${scan.detectorSha256} / ${scan.runtimeVersion}` : 'loading'}
              </code>
            </div>
          </div>
        </details>

        {scan && (
          <>
            <section className="mb-4 grid grid-cols-5 gap-3 max-[900px]:grid-cols-3 max-[560px]:grid-cols-2">
              <SummaryCard label="TOTAL" value={scan.summary.total} />
              <SummaryCard label="PASS" value={scan.summary.passed} tone="pass" />
              <SummaryCard label="FAIL" value={scan.summary.failed} tone="fail" />
              <SummaryCard label="ERRORS" value={scan.summary.errors} tone="fail" />
              <SummaryCard label="WARNINGS" value={scan.summary.warnings} tone="warning" />
            </section>

            <section
              className="ui-soft-panel ui-validator-results grid grid-cols-[280px_minmax(0,1fr)] max-[900px]:grid-cols-1"
            >
              <aside
                className="flex min-h-0 flex-col border-r border-[var(--border)] bg-[var(--s2)]
                  max-[900px]:max-h-[320px] max-[900px]:border-b max-[900px]:border-r-0"
              >
                <div className="border-b border-[var(--border)] px-4 py-3">
                  <h2 className="text-[14px] leading-[1.4] text-[var(--color-text-emphasis)]">文件结果</h2>
                  <p className="mt-1 text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
                    显示 {visibleFiles.length} / {scan.files.length}
                  </p>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {visibleFiles.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                      没有匹配的文件
                    </p>
                  ) : (
                    visibleFiles.map(file => {
                      const status = fileStatus(file);
                      const active = file.file === selectedFile;

                      return (
                        <button
                          key={file.file}
                          aria-current={active ? 'true' : undefined}
                          type="button"
                          onClick={() => setSelectedFile(file.file)}
                          className={`w-full border-b border-[var(--border)] px-4 py-3 text-left
                          transition-colors duration-200 ${active ? 'bg-[var(--cyan-dim)]' : 'hover:bg-[var(--s3)]'}`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <span
                              className={`min-w-0 break-all text-[12px] leading-[1.4] ${
                                active ? 'text-[var(--cyan)]' : 'text-[var(--color-text-emphasis)]'
                              }`}
                            >
                              {file.file}
                            </span>
                            <span className={`ui-badge ui-badge-tag shrink-0 ${statusBadgeClass(status)}`}>
                              {statusLabel(status)}
                            </span>
                          </div>
                          <div
                            className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[1.3]
                            text-[var(--color-text-secondary)]"
                          >
                            <span>{formatBytes(file.size)}</span>
                            <span className="text-[var(--coral)]">{file.check.errors.length} errors</span>
                            <span className="text-[var(--gold)]">{file.check.warnings.length} warnings</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              <div className="min-h-0 min-w-0 overflow-y-auto p-4">
                {!activeFile ? (
                  <div
                    className="flex min-h-[360px] items-center justify-center text-[13px] leading-[1.45]
                      text-[var(--color-text-secondary)]"
                  >
                    选择一个文件查看检测详情
                  </div>
                ) : (
                  <>
                    <div className="mb-4 border-b border-[var(--border)] pb-4">
                      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="break-all text-[18px] leading-[1.35] text-[var(--color-text-emphasis)]">
                            {activeFile.file}
                          </h2>
                          <p className="mt-1 text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
                            {formatBytes(activeFile.size)} · 修改于 {formatTime(activeFile.modifiedAt)} · 检测{' '}
                            {activeFile.elapsedMs.toFixed(1)}ms
                          </p>
                        </div>
                        <span className={`ui-badge ui-badge-compact ${statusBadgeClass(fileStatus(activeFile))}`}>
                          {activeFile.check.result.toUpperCase()}
                        </span>
                      </div>
                      <p className="font-mono text-[12px] leading-[1.4] text-[var(--color-text-secondary)]">
                        {activeFile.check.summary}
                      </p>
                    </div>

                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-[14px] leading-[1.4] text-[var(--color-text-emphasis)]">问题明细</h3>
                        <p className="mt-1 text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
                          字段路径来自原始 DSL，可按 code 接入外部修复流程。
                        </p>
                      </div>
                      <label>
                        <span className="mb-1 block text-[11px] leading-[1.35] text-[var(--color-text-secondary)]">
                          严重级别
                        </span>
                        <select
                          value={issueFilter}
                          onChange={event => setIssueFilter(event.target.value as IssueFilter)}
                          className="ui-select min-w-[120px] px-2 text-[12px] leading-[1.4]"
                        >
                          <option value="all">全部</option>
                          <option value="error">ERROR</option>
                          <option value="warning">WARNING</option>
                        </select>
                      </label>
                    </div>

                    {visibleIssues.length === 0 ? (
                      <div className="ui-callout ui-callout-cyan text-[13px] leading-[1.45] text-[var(--cyan)]">
                        {activeFile.check.errors.length + activeFile.check.warnings.length === 0
                          ? '该文件未发现格式问题。'
                          : '当前严重级别下没有问题。'}
                      </div>
                    ) : (
                      <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                        {visibleIssues.map((issue, index) => (
                          <article
                            key={`${issue.severity}-${issue.code}-${issue.path}-${index}`}
                            className="ui-card-compact"
                          >
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <span
                                className={`ui-badge ui-badge-tag ${
                                  issue.severity === 'ERROR' ? 'ui-badge-danger' : 'ui-badge-gold'
                                }`}
                              >
                                {issue.severity}
                              </span>
                              <code className="font-mono text-[12px] font-semibold text-[var(--color-text-emphasis)]">
                                {issue.code}
                              </code>
                              <span className="text-[12px] leading-[1.4] text-[var(--color-text-primary)]">
                                {issue.label}
                              </span>
                            </div>
                            <p className="mb-3 text-[12px] leading-[1.55] text-[var(--color-text-primary)]">
                              {issue.message}
                            </p>
                            <div className="ui-code ui-code-compact space-y-1 text-[11px] leading-[1.45]">
                              <div className="break-all">
                                <span className="text-[var(--color-text-secondary)]">path: </span>
                                {issue.path || '(root)'}
                              </div>
                              <div className="break-all">
                                <span className="text-[var(--color-text-secondary)]">layerId: </span>
                                {issue.layerId ?? 'null'}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
