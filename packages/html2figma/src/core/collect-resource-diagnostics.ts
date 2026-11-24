import type { ConversionDiagnostic } from '../model/html-scene-document';
import type { SceneNode } from '../types';

export function collectResourceDiagnostics(root: SceneNode): ConversionDiagnostic[] {
  const diagnostics: ConversionDiagnostic[] = [];
  const visit = (node: SceneNode, nodePath: string): void => {
    if (node.ir.opacity === 0 || node.styles.display === 'none' || node.styles.opacity === '0') {
      return;
    }
    if (node.type === 'image' && node.text !== undefined && node.text !== null && node.text.trim() !== '') {
      diagnostics.push({
        severity: 'warning', code: 'TEXT_RASTERIZED', nodePath,
        message: `Text was captured as an image for visual fidelity: "${node.name}". This layer is not editable text.`,
      });
    }
    if (node.width > 0 && node.height > 0) {
      if (node.type === 'image' && (node.image === undefined || node.image === null || node.image === '')) {
        diagnostics.push({
          severity: 'warning', code: 'IMAGE_CAPTURE_MISSING', nodePath,
          message: `Image pixels were not captured for "${node.name}". Check resource loading and canvas access.`,
        });
      }
      if (/url\s*\(/i.test(node.styles.backgroundImage ?? '') &&
        (node.backgroundImage === undefined || node.backgroundImage === null || node.backgroundImage === '')) {
        diagnostics.push({
          severity: 'warning', code: 'BACKGROUND_IMAGE_CAPTURE_MISSING', nodePath,
          message: `Background image pixels were not captured for "${node.name}". Check resource loading and canvas access.`,
        });
      }
    }
    node.children.forEach((child, index) => visit(child, `${nodePath}.children[${index}]`));
  };

  visit(root, 'root');

  return diagnostics;
}
