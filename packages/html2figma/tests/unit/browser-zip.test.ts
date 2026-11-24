import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createVirtualProjectFromZip } from '../../src/browser-zip';
import { readVirtualProjectText } from '../../src/model/virtual-project';

async function createZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();

  for (const [filePath, contents] of Object.entries(files)) {
    zip.file(filePath, contents);
  }

  return zip.generateAsync({ type: 'uint8array' });
}

describe('createVirtualProjectFromZip', () => {
  it('extracts files and selects the root index as the entry', async () => {
    const bytes = await createZip({
      'nested/page.html': '<main>Nested</main>',
      'index.html': '<main>Root</main>',
      'styles/main.css': 'main { display: flex; }',
      '__MACOSX/._index.html': 'metadata',
    });

    const project = await createVirtualProjectFromZip(bytes);

    expect(project.entryPath).toBe('index.html');
    expect(project.files.has('__MACOSX/._index.html')).toBe(false);
    expect(readVirtualProjectText(project, 'index.html')).toBe('<main>Root</main>');
    expect(project.files.get('styles/main.css')?.mimeType).toBe('text/css');
  });

  it('enforces file count and uncompressed size limits', async () => {
    const bytes = await createZip({ 'index.html': '1234', 'extra.txt': '5678' });

    await expect(createVirtualProjectFromZip(bytes, { maxFiles: 1 })).rejects.toThrow('file limit');
    await expect(createVirtualProjectFromZip(bytes, { maxUncompressedBytes: 6 })).rejects.toThrow(
      'uncompressed size limit',
    );
  });
});
