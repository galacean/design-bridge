import { spec } from '@galacean/effects';
import { describe, expect, it } from 'vitest';
import { convertFigmaToEffects, extractKiwiIR } from '@galacean/figma2ge';
import { expectBlobOnlyImageUrls, expectNoErrorIssues } from './helpers/assertions';
import { decodedMessage } from './helpers/fig-fixture';
import { findFirstNode } from './helpers/tree-search';

describe('decoded message (string enums)', () => {
  const decoded = decodedMessage;

  it('extracts nodes from message.nodeChanges with string type enums', () => {
    const { nodes } = extractKiwiIR(decoded);

    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes[0].kind).toBe('frame');
    expect(nodes[0].width).toBeGreaterThan(0);
  });

  it('parses fills with string paint type', () => {
    const { nodes } = extractKiwiIR(decoded);
    const body = nodes[0];

    expect(body.fills).toBeDefined();
    expect(body.fills![0].type).toBe('solid');
    expect(body.fills![0].color).toBeDefined();
    expect(body.fillColor).toBeDefined();
  });

  it('extracts text nodes with string-enum text properties', () => {
    const { nodes } = extractKiwiIR(decoded);
    const textNode = findFirstNode(nodes[0], node => node.kind === 'text');

    expect(textNode).toBeDefined();
    expect(textNode!.text).toBeDefined();
    expect(textNode!.textFontFamily).toBeDefined();

    if (textNode!.textAlignHorizontal !== undefined) {
      expect(textNode!.textAlignHorizontal).toBe('LEFT');
    }
  });

  it('extracts auto-layout from string enum stackMode', () => {
    const { nodes } = extractKiwiIR(decoded);
    const withAutoLayout = findFirstNode(nodes[0], node => node.autoLayout !== undefined);

    expect(withAutoLayout).toBeDefined();
    expect(withAutoLayout!.autoLayout).toBeDefined();
    expect(['VERTICAL', 'HORIZONTAL']).toContain(withAutoLayout!.autoLayout!.direction);
  });

  it('parses effects with string effect type', () => {
    const { nodes } = extractKiwiIR(decoded);
    const withEffects = findFirstNode(nodes[0], node => Boolean(node.effects?.length));

    expect(withEffects).toBeDefined();
    expect(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']).toContain(withEffects!.effects![0].type);
  });

  it('parses image fills with hash as numeric-keyed object', () => {
    const { nodes } = extractKiwiIR(decoded);
    const withImage = findFirstNode(nodes[0], node => Boolean(node.imageRef));

    expect(withImage).toBeDefined();
    expect(withImage!.imageRef).toMatch(/^[0-9a-f]+$/);
  });

  it('extracts blobs from decoded message', () => {
    const { blobs } = extractKiwiIR(decoded);

    expect(blobs.length).toBeGreaterThan(0);
    const hasImageBlob = blobs.some(
      b => b.length >= 2 && ((b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8)),
    );

    expect(hasImageBlob).toBe(true);
  });

  it('extracts dataBlobIndex from image fills', () => {
    const { nodes } = extractKiwiIR(decoded);
    const withImage = findFirstNode(nodes[0], node => node.imageBlobIndex !== undefined);

    expect(withImage).toBeDefined();
    expect(typeof withImage!.imageBlobIndex).toBe('number');
  });

  it('produces a valid GE scene with blob URLs (not figma protocol)', () => {
    const result = convertFigmaToEffects(decoded);

    expect(result.scene.version).toBe(spec.JSONSceneVersion['3_7']);
    expect(result.scene.items.length).toBeGreaterThan(0);
    expect(result.scene.components.length).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);

    expectBlobOnlyImageUrls(result.scene.images);
    expectNoErrorIssues(result.issues);
  });
});
