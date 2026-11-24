import * as spec from '@galacean/effects-specification';
import { describe, expect, it } from 'vitest';
import { buildQuadGeometry } from '../../src/generator/build-quad-geometry';

describe('buildQuadGeometry', () => {
  it('should return fullscreen quad geometry', () => {
    const geometry = buildQuadGeometry('geo-1');

    expect(geometry.id).toBe('geo-1');
    expect(geometry.dataType).toBe(spec.DataType.Geometry);
    expect(geometry.vertexData.vertexCount).toBe(4);
    expect(geometry.vertexData.channels).toHaveLength(2);
    expect(geometry.subMeshes[0].indexCount).toBe(6);
    expect(typeof geometry.buffer).toBe('string');
    expect(geometry.buffer!.length).toBeGreaterThan(0);
  });
});
