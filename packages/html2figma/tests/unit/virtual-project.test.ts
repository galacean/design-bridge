import { describe, expect, it } from 'vitest';
import {
  createVirtualProject,
  inferMimeType,
  normalizeProjectPath,
  readVirtualProjectText,
  resolveProjectPath,
} from '../../src/model/virtual-project';

describe('VirtualProject', () => {
  it('normalizes files and resolves relative resource paths', () => {
    const project = createVirtualProject(
      [
        { path: 'pages/index.html', bytes: new TextEncoder().encode('<main />'), mimeType: '' },
        { path: 'assets/icon.svg', bytes: Uint8Array.from([1, 2]), mimeType: 'image/svg+xml' },
      ],
      'pages/index.html',
    );

    expect(readVirtualProjectText(project, 'pages/index.html')).toBe('<main />');
    expect(resolveProjectPath('pages/index.html', '../assets/icon.svg?version=1')).toBe('assets/icon.svg');
    expect(resolveProjectPath('pages/index.html', 'https://example.com/icon.svg')).toBeNull();
    expect(inferMimeType('font.woff2')).toBe('font/woff2');
  });

  it('rejects paths that escape the project root', () => {
    expect(() => normalizeProjectPath('../secret.txt')).toThrow('escapes its root');
    expect(() =>
      createVirtualProject(
        [{ path: 'index.html', bytes: new Uint8Array(), mimeType: 'text/html' }],
        'missing.html',
      ),
    ).toThrow('entry file not found');
  });
});
