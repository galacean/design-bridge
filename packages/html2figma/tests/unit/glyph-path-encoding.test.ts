import { describe, expect, it } from 'vitest';
import type * as fontkit from 'fontkit';
import { encodeGlyphCommandsBlob } from '../../src/core/glyph-path-encoding';

describe('glyph path wire encoding', () => {
  it.each(['curveTo', 'bezierCurveTo'])('encodes %s with the cubic opcode and six coordinates', command => {
    const path = { commands: [
      { command: 'moveTo', args: [0, 0] },
      { command, args: [100, 200, 300, 400, 500, 600] },
      { command: 'lineTo', args: [700, 800] },
      { command: 'closePath', args: [] },
    ] } as unknown as fontkit.Path;
    const blob = encodeGlyphCommandsBlob(path, 1000);
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);

    expect(blob[10]).toBe(4);
    expect(Array.from({ length: 6 }, (_, index) => view.getFloat32(11 + index * 4, true)))
      .toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(Math.fround));
    expect(blob[35]).toBe(2);
    expect(view.getFloat32(36, true)).toBe(Math.fround(0.7));
    expect(view.getFloat32(40, true)).toBe(Math.fround(0.8));
  });
});
