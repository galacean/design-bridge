import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';
import type { IRBezierPath, IRColor, IRLayer, IRShape } from '@galacean/animation-ir';

interface StaticValue<T> { type: 'static'; value: T }

interface ShapeLayerView {
  content: { shapes: IRShape[] };
  transform: {
    position?: StaticValue<[number, number, number]>;
    scale?: StaticValue<[number, number, number]>;
    opacity?: StaticValue<number>;
  };
  masks?: Array<{ path: IRBezierPath }>;
}

function getShapeLayers(svg: string): ShapeLayerView[] {
  return convertSVGToIR(svg).ir.compositions[0].layers
    .filter((layer: IRLayer) => layer.type === 'shape') as unknown as ShapeLayerView[];
}

function getSolidColor(layer: ShapeLayerView): IRColor {
  const paint = layer.content.shapes[0].fills[0];

  if (paint?.type !== 'solid') {
    throw new Error('Expected a solid fill.');
  }

  return paint.color;
}

describe('SVG semantics regressions', () => {
  it('keeps element and group opacity on the layer instead of multiplying paint alpha twice', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <g opacity="0.5"><rect width="20" height="20" fill="#ff0000" opacity="0.5"/></g>
      </svg>
    `);

    expect(layer.transform.opacity?.value).toBeCloseTo(0.25, 6);
    expect(getSolidColor(layer)[3]).toBe(1);
  });

  it('keeps fill-opacity on paint while element opacity remains on the layer', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="20" height="20" fill="#ff0000" fill-opacity="0.4" opacity="0.5"/>
      </svg>
    `);

    expect(layer.transform.opacity?.value).toBeCloseTo(0.5, 6);
    expect(getSolidColor(layer)[3]).toBeCloseTo(0.4, 6);
  });

  it('does not multiply use opacity into both paint and layer opacity', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs><rect id="box" width="20" height="20" fill="#ff0000"/></defs>
        <use href="#box" opacity="0.5"/>
      </svg>
    `);

    expect(layer.transform.opacity?.value).toBeCloseTo(0.5, 6);
    expect(getSolidColor(layer)[3]).toBe(1);
  });

  it('preserves referenced shape opacity on a use instance without baking it into paint', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs><rect id="box" width="20" height="20" fill="#ff0000" opacity="0.4"/></defs>
        <use href="#box" opacity="0.5"/>
      </svg>
    `);

    expect(layer.transform.opacity?.value).toBeCloseTo(0.2, 6);
    expect(getSolidColor(layer)[3]).toBe(1);
  });

  it('multiplies a direct shape opacity animation by a static ancestor opacity', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <g opacity="0.4">
          <rect width="20" height="20" fill="#ff0000" opacity="0.6">
            <animate attributeName="opacity" values="0;0.5" dur="1s" fill="freeze"/>
          </rect>
        </g>
      </svg>
    `);
    const opacity = layer.transform.opacity as unknown as { type: 'keyframed'; keyframes: Array<{ value: number }> };

    expect(opacity.type).toBe('keyframed');
    expect(opacity.keyframes[0].value).toBeCloseTo(0, 6);
    expect(opacity.keyframes.at(-1)?.value).toBeCloseTo(0.2, 6);
    expect(getSolidColor(layer)[3]).toBe(1);
  });

  it('resolves percentage geometry against the SVG user viewport without non-finite values', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <rect x="10%" y="20%" width="50%" height="40%" fill="red"/>
      </svg>
    `);
    const shape = layer.content.shapes[0] as IRShape & { width: number; height: number };

    expect(shape.width).toBe(100);
    expect(shape.height).toBe(40);
    expect(layer.transform.position?.value).toEqual([70, 40, 0]);
    expect(JSON.stringify(layer)).not.toContain('null');
  });

  it('applies default xMidYMid meet alignment for a non-matching viewBox ratio', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100">
        <rect width="100" height="100" fill="red"/>
      </svg>
    `);

    expect(layer.transform.position?.value).toEqual([100, 50, 0]);
    expect(layer.transform.scale?.value).toEqual([1, 1, 1]);
  });

  it('applies non-zero viewBox origins and preserveAspectRatio none', () => {
    const [originLayer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="10 20 100 100">
        <rect x="10" y="20" width="10" height="10" fill="red"/>
      </svg>
    `);
    const [noneLayer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect width="100" height="100" fill="red"/>
      </svg>
    `);

    expect(originLayer.transform.position?.value).toEqual([5, 5, 0]);
    expect(noneLayer.transform.position?.value).toEqual([100, 50, 0]);
    expect(noneLayer.transform.scale?.value).toEqual([2, 1, 1]);
  });

  it('reads inline presentation styles and legal CSS color forms', () => {
    const layers = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="120" height="20">
        <rect x="0" width="20" height="20" style="fill:#ff0000"/>
        <g color="#00ff00"><rect x="20" width="20" height="20" fill="currentColor"/></g>
        <rect x="40" width="20" height="20" fill="#0000ff80"/>
        <rect x="60" width="20" height="20" fill="hsl(240 100% 50%)"/>
        <rect x="80" width="20" height="20" fill="rebeccapurple"/>
      </svg>
    `);

    expect(getSolidColor(layers[0])).toEqual([1, 0, 0, 1]);
    expect(getSolidColor(layers[1])).toEqual([0, 1, 0, 1]);
    expect(getSolidColor(layers[2])).toEqual([0, 0, 1, 128 / 255]);
    expect(getSolidColor(layers[3])).toEqual([0, 0, 1, 1]);
    expect(getSolidColor(layers[4])).toEqual([102 / 255, 51 / 255, 153 / 255, 1]);
  });

  it('preserves cubic handles in clip paths', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <clipPath id="clip"><path d="M10 50 C10 10 90 10 90 50 C90 90 10 90 10 50 Z"/></clipPath>
        </defs>
        <rect width="100" height="100" fill="red" clip-path="url(#clip)"/>
      </svg>
    `);

    expect(layer.masks?.[0]?.path.outTangents.some(tangent => tangent.x !== 0 || tangent.y !== 0)).toBe(true);
    expect(layer.masks?.[0]?.path.inTangents.some(tangent => tangent.x !== 0 || tangent.y !== 0)).toBe(true);
  });

  it('merges separate clip shapes with zero-area bridges instead of a direct diagonal edge', () => {
    const [layer] = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <clipPath id="clip">
            <rect x="0" y="0" width="20" height="20"/>
            <rect x="80" y="80" width="20" height="20"/>
          </clipPath>
        </defs>
        <rect width="100" height="100" fill="red" clip-path="url(#clip)"/>
      </svg>
    `);

    expect(layer.masks?.[0]?.path.points).toHaveLength(10);
  });

  it('expands each renderable child of a referenced symbol', () => {
    const layers = getShapeLayers(`
      <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <defs>
          <symbol id="badge">
            <rect id="background" width="20" height="10" fill="red"/>
            <circle id="dot" cx="10" cy="5" r="2" fill="white"/>
          </symbol>
        </defs>
        <use id="badge-instance" href="#badge" x="30" y="40"/>
      </svg>
    `);

    expect(layers).toHaveLength(2);
    expect(layers.map(layer => layer.transform.position?.value)).toEqual([
      [40, 45, 0],
      [40, 45, 0],
    ]);
  });
});
