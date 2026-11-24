import { describe, expect, it } from 'vitest';
import {
  declareSvgNamespaces,
  getSmilReplayTimes,
  namespaceSvgIdsForPlayback,
  parseSvgAnimationDuration,
  readSvgIntrinsicSize,
  relativeMatrix,
  type AffineMatrix,
} from './svg-renderer';

describe('readSvgIntrinsicSize', () => {
  it('reads the authored raster viewport without rewriting the SVG', () => {
    expect(readSvgIntrinsicSize(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="100" height="80"/></svg>',
    )).toEqual({ width: 100, height: 80 });
  });

  it('supports px lengths and ignores percentage dimensions', () => {
    expect(readSvgIntrinsicSize('<svg width="100px" height="80px" viewBox="10 20 30 40"></svg>'))
      .toEqual({ width: 100, height: 80 });
    expect(readSvgIntrinsicSize('<svg width="100%" height="100%"></svg>')).toBeUndefined();
  });
});

function multiply(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

describe('relativeMatrix', () => {
  it('removes viewBox/group CTM without duplicating the parent transform', () => {
    const parent = { a: 2, b: 0, c: 0, d: 3, e: 40, f: -20 };
    const local = { a: 0, b: 1, c: -1, d: 0, e: 12, f: 8 };
    const element = multiply(parent, local);

    const result = relativeMatrix(parent, element);

    for (const key of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
      expect(result[key]).toBeCloseTo(local[key], 12);
    }
  });
});

describe('parseSvgAnimationDuration', () => {
  it('includes set elements in the native SVG sampling window', () => {
    expect(parseSvgAnimationDuration(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect width="10" height="10">
          <set attributeName="fill" to="red" begin="5s" dur="2s" fill="freeze"/>
        </rect>
      </svg>
    `)).toBe(7);
  });

  it('keeps a finite window when repeatCount overflows the numeric range', () => {
    const huge = '1'.repeat(310);

    expect(parseSvgAnimationDuration(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect width="50" height="100">
          <animate attributeName="fill" from="#007f00" to="green" dur="10ms" repeatCount="${huge}"/>
        </rect>
      </svg>
    `)).toBeCloseTo(0.01, 6);
    expect(parseSvgAnimationDuration(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect width="50" height="100">
          <animate attributeName="fill" from="#007f00" to="green" dur="10ms" repeatCount="1e+309"/>
        </rect>
      </svg>
    `)).toBeCloseTo(0.01, 6);
  });

  it('still folds an indefinite repeatCount into one active cycle', () => {
    expect(parseSvgAnimationDuration(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <circle cx="5" cy="50" r="5">
          <animate attributeName="cy" dur="2.2s" repeatCount="indefinite"/>
        </circle>
      </svg>
    `)).toBeCloseTo(2.2, 6);
  });

  it('uses a finite repeatCount as written', () => {
    expect(parseSvgAnimationDuration(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect width="10" height="10"><set attributeName="x" to="74" begin="0s;1s" dur="4s"/></rect>
      </svg>
    `)).toBeCloseTo(4, 6);
  });
});

describe('declareSvgNamespaces', () => {
  it('injects the SVG namespace when a root svg omits xmlns', () => {
    const result = declareSvgNamespaces('<svg width="10" height="10"><rect/></svg>');

    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('<rect/>');
  });

  it('keeps an authored namespace declaration instead of duplicating it', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

    expect(declareSvgNamespaces(source)).toBe(source);
  });

  it('declares xlink only when the document references it', () => {
    const withXlink = declareSvgNamespaces('<svg><animate xlink:href="#a" attributeName="x"/></svg>');
    const withoutXlink = declareSvgNamespaces('<svg><animate href="#a" attributeName="x"/></svg>');

    expect(withXlink).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(withoutXlink).not.toContain('xmlns:xlink');
  });

  it('leaves a well-formed svg with both declarations untouched', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
      + '<animate xlink:href="#a" attributeName="x"/></svg>';

    expect(declareSvgNamespaces(source)).toBe(source);
  });

  it('returns non-svg markup unchanged so the HTML fallback can still parse it', () => {
    expect(declareSvgNamespaces('<html><body/></html>')).toBe('<html><body/></html>');
  });
});

describe('getSmilReplayTimes', () => {
  it('replays coarse seeks in bounded monotonic steps and lands exactly on the target', () => {
    const times = getSmilReplayTimes(0, 0.1, 1 / 30);

    expect(times).toHaveLength(3);
    expect(times.every((time, index) => index === 0 || time > times[index - 1])).toBe(true);
    expect(times.at(-1)).toBe(0.1);
    expect(times.every((time, index) => index === 0 || time - times[index - 1] <= 1 / 30 + 1e-9)).toBe(true);
  });

  it('uses a single exact seek when the target does not move forward', () => {
    expect(getSmilReplayTimes(1, 0.25)).toEqual([0.25]);
    expect(getSmilReplayTimes(1, 1)).toEqual([1]);
  });
});

describe('namespaceSvgIdsForPlayback', () => {
  it('preserves quoted paint references without treating matching hex colors as IDs', () => {
    const result = namespaceSvgIdsForPlayback(
      '<svg><defs><linearGradient id="abc"/></defs><rect fill="url(\'#abc\')" stroke="#abc"/></svg>',
      '__test_',
    );

    expect(result).toContain('fill="url(\'#__test_abc\')"');
    expect(result).toContain('stroke="#abc"');
  });

  it('rewrites syncbase, href and paint-server references together', () => {
    const result = namespaceSvgIdsForPlayback(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="paint"/>
          <path id="motionPath" d="M0 0L10 0"/>
        </defs>
        <circle id="dot" fill="url(#paint)">
          <animate id="pulse" attributeName="r" begin="0;next.end-0.2s" end="next.repeat(2)" dur="1s" values="1;2"/>
          <animate id="next" attributeName="r" begin="pulse.begin+0.1s" dur="1s" values="1;2"/>
          <animateMotion dur="1s"><mpath href="#motionPath"/></animateMotion>
        </circle>
      </svg>
    `, '__test_');

    expect(result).toContain('id="__test_paint"');
    expect(result).toContain('fill="url(#__test_paint)"');
    expect(result).toContain('begin="0;__test_next.end-0.2s"');
    expect(result).toContain('begin="__test_pulse.begin+0.1s"');
    expect(result).toContain('end="__test_next.repeat(2)"');
    expect(result).toContain('href="#__test_motionPath"');
  });
});
