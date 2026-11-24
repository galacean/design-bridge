import { describe, expect, it } from 'vitest';
import {
  createHTMLSceneDocument,
  HTML_SCENE_DOCUMENT_VERSION,
  isHTMLSceneDocument,
} from '../../src/model/html-scene-document';
import { makeSceneNode } from '../helpers/scene-factories';

describe('HTMLSceneDocument', () => {
  it('creates and validates a versioned scene document', () => {
    const document = createHTMLSceneDocument(makeSceneNode(), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium', engineVersion: '140' },
    });

    expect(document.version).toBe(HTML_SCENE_DOCUMENT_VERSION);
    expect(document.diagnostics).toEqual([]);
    expect(isHTMLSceneDocument(document)).toBe(true);
  });

  it('rejects unknown versions and invalid viewport dimensions', () => {
    const document = createHTMLSceneDocument(makeSceneNode(), {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'playwright', engine: 'chromium' },
    });

    expect(isHTMLSceneDocument({ ...document, version: 2 })).toBe(false);
    expect(isHTMLSceneDocument({ ...document, viewport: { width: 0, height: 844 } })).toBe(false);
  });

  it('reports missing visible images with stable paths and preserves caller diagnostics', () => {
    const root = makeSceneNode({ children: [
      makeSceneNode({ type: 'image', name: 'Missing photo' }),
      makeSceneNode({ name: 'Missing background', styles: { backgroundImage: 'url("missing.png")' } }),
      makeSceneNode({ type: 'image', image: 'data:image/png;base64,AAAA' }),
      makeSceneNode({ type: 'image', width: 0, height: 0 }),
      makeSceneNode({ styles: { display: 'none' }, children: [makeSceneNode({ type: 'image' })] }),
      makeSceneNode({ styles: { backgroundImage: 'linear-gradient(red, blue)' } }),
    ] });
    const supplied = [{ severity: 'info' as const, code: 'CALLER_NOTE', message: 'Caller note' }];
    const document = createHTMLSceneDocument(root, {
      viewport: { width: 390, height: 844 },
      runtime: { kind: 'browser', engine: 'chromium' },
      diagnostics: supplied,
    });

    expect(document.diagnostics).toMatchObject([
      { code: 'CALLER_NOTE' },
      { severity: 'warning', code: 'IMAGE_CAPTURE_MISSING', nodePath: 'root.children[0]' },
      { severity: 'warning', code: 'BACKGROUND_IMAGE_CAPTURE_MISSING', nodePath: 'root.children[1]' },
    ]);
    expect(document.diagnostics).toHaveLength(3);
    expect(supplied).toHaveLength(1);
    expect(root.children[0].image).toBeNull();
  });
});
