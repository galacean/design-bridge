import type { ConversionDiagnostic } from '@galacean/animation-ir/adapter';

type LottieDiagnosticCode =
  | 'unsupported-layer-type' | 'unsupported-shape-type' | 'unsupported-shape-feature'
  | 'unsupported-mask' | 'unsupported-track-matte' | 'missing-font' | 'missing-image-asset'
  | 'missing-text-data' | 'invalid-stretch-ratio' | 'separated-position-fallback'
  | 'animated-anchor-fallback' | 'animated-gradient-fallback'
  | 'duplicate-layer-index' | 'unsupported-text-glyphs';

interface CreateLottieDiagnosticOptions {
  code: LottieDiagnosticCode;
  message: string;
  layerInd?: number;
  featureKinds?: string[];
}

function resolveDiagnosticAction(code: LottieDiagnosticCode): ConversionDiagnostic['action'] {
  switch (code) {
    case 'invalid-stretch-ratio':
    case 'separated-position-fallback':
    case 'animated-anchor-fallback':
    case 'animated-gradient-fallback':
    case 'duplicate-layer-index':
    case 'unsupported-text-glyphs':
    case 'missing-font':
      return 'approximated';
    case 'missing-image-asset':
    case 'unsupported-mask':
    case 'unsupported-track-matte':
    case 'unsupported-shape-feature':
    case 'unsupported-shape-type':
    case 'missing-text-data':
      return 'dropped';
    case 'unsupported-layer-type':
      return 'unsupported';
  }
}

/** Creates a source-scoped warning for a normalized, approximated, or dropped Lottie feature. */
export function createLottieDiagnostic(options: CreateLottieDiagnosticOptions): ConversionDiagnostic {
  return {
    code: `LOTTIE_${options.code.replaceAll('-', '_').toUpperCase()}`,
    severity: 'warning',
    action: resolveDiagnosticAction(options.code),
    path: '$.layers',
    ...(options.layerInd != null && { sourceId: String(options.layerInd) }),
    feature: options.featureKinds?.join(',') ?? options.code,
    message: options.message,
  };
}
