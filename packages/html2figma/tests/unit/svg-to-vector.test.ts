import { describe, it, expect } from 'vitest';
import { parseSvgPath, svgPathToVectorNetwork, encodeVectorNetworkBlob } from '@galacean/html2figma';

describe('SVG Path Parsing', () => {
  it('should parse simple M/L path', () => {
    const subpaths = parseSvgPath('M 0 0 L 10 10 L 20 0 Z');

    expect(subpaths.length).toBe(1);
    const cmds = subpaths[0];

    expect(cmds.length).toBe(4);
    expect(cmds[0].type).toBe('M');
    expect(cmds[1].type).toBe('L');
    expect(cmds[3].type).toBe('Z');
  });

  it('should parse relative commands', () => {
    const subpaths = parseSvgPath('m 5 5 l 10 10');

    expect(subpaths.length).toBe(1);
    const cmds = subpaths[0];

    expect(cmds.length).toBe(2);
    expect(cmds[0].type).toBe('M');
    expect(cmds[1].type).toBe('L');
  });

  it('should parse cubic bezier', () => {
    const subpaths = parseSvgPath('M 0 0 C 10 20 30 40 50 60');

    expect(subpaths.length).toBe(1);
    const cmds = subpaths[0];

    expect(cmds.length).toBe(2);
    expect(cmds[1].type).toBe('C');
    expect(cmds[1].x1).toBe(10);
    expect(cmds[1].y1).toBe(20);
    expect(cmds[1].x2).toBe(30);
    expect(cmds[1].y2).toBe(40);
    expect(cmds[1].x).toBe(50);
    expect(cmds[1].y).toBe(60);
  });

  it('should handle empty path', () => {
    const subpaths = parseSvgPath('');

    expect(subpaths.length).toBe(0);
  });
});

describe('SVG to VectorNetwork', () => {
  it('should convert simple triangle to vector network', () => {
    const subpaths = parseSvgPath('M 0 0 L 10 10 L 20 0 Z');
    const network = svgPathToVectorNetwork(subpaths);

    expect(network.vertices.length).toBeGreaterThan(0);
    expect(network.segments.length).toBeGreaterThan(0);
  });

  it('should produce valid blob from vector network', () => {
    const subpaths = parseSvgPath('M 0 0 L 10 10 L 20 0 Z');
    const network = svgPathToVectorNetwork(subpaths);
    const blob = encodeVectorNetworkBlob(network.vertices, network.segments, network.loops);

    expect(blob.byteLength).toBeGreaterThan(0);
  });
});
