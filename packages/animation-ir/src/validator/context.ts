import type {
  IRValidationErrorCode, IRValidationIssue, IRValidationWarning, IRValidationWarningCode,
} from './contract.js';

export class ValidationContext {
  readonly errors: IRValidationIssue[] = [];
  readonly warnings: IRValidationWarning[] = [];

  error(code: IRValidationErrorCode, path: string, message: string, layerId?: string): void {
    this.errors.push({ code, path, message, ...(layerId != null && { layerId }) });
  }

  warning(code: IRValidationWarningCode, path: string, message: string, layerId?: string): void {
    this.warnings.push({ code, path, message, ...(layerId != null && { layerId }) });
  }
}
