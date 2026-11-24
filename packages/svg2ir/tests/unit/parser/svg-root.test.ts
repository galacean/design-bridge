import { describe, expect, it } from 'vitest';
import { convertSVGToIR } from '@galacean/svg2ir';

const source = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">'
  + '<svg x="10" width="50" height="50"><rect id="nested" width="40" height="40"/></svg>'
  + '<rect id="after" x="100" width="20" height="20"/></svg>';

describe('SVG document root parsing', () => {
  it.each([
    ['', ''],
    ['<!-- <svg width="1" height="1"><rect id="decoy"/></svg> -->', ''],
    ['', '<!-- </svg> -->'],
    ['<?xml version="1.0"?><!DOCTYPE svg>', ''],
  ])('parses the complete root despite surrounding XML syntax (%s / %s)', (prefix, suffix) => {
    const result = convertSVGToIR(prefix + source + suffix);
    const composition = result.ir.compositions[0];

    expect([composition.width, composition.height]).toEqual([200, 100]);
    expect(composition.layers.map(layer => layer.name)).toEqual(['nested', 'after']);
  });
});
