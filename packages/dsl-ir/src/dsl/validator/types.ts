export type DSLSeverity = 'ERROR' | 'WARNING';

export interface DSLLintIssue {
  severity: DSLSeverity;
  code: string;
  message: string;
  path: string;
  layerId: string | null;
}

export interface DSLLintReport {
  ok: boolean;
  hasErrors: boolean;
  counts: { ERROR: number; WARNING: number };
  issues: DSLLintIssue[];
}

/** Blocking error or recoverable warning; path locates the field and layerId is null for document-level issues. */
export interface DSLValidationIssue {
  code: string;
  label: string;
  message: string;
  path: string;
  layerId: string | null;
}

/** Validation report; warnings may require conversion fallbacks but only errors cause result to be fail. */
export interface DSLValidationResult {
  result: 'pass' | 'fail';
  summary: string;
  errors: DSLValidationIssue[];
  warnings: DSLValidationIssue[];
}
