/** Non-fatal normalization or fidelity limitation reported at a conversion boundary. */
export interface ConversionDiagnostic {
  code: string;
  severity: 'info' | 'warning';
  action: 'normalized' | 'approximated' | 'dropped' | 'unsupported';
  /** JSON Path of the affected source or normalized value. */
  path: string;
  sourceId?: string;
  feature?: string;
  message: string;
}
