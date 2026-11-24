import { describe, expect, it } from 'vitest';
import type { ECSCollector, GeneratedComponentData } from '../../../src/ir2ge/types';
import { applyGEMaskRemap } from '../../../src/ir2ge/post-process/ge-mask-remap';

function createCollector(components: Array<Record<string, unknown>>): ECSCollector {
  return {
    images: [],
    fonts: [],
    components: components as GeneratedComponentData[],
    items: [],
    textures: [],
    miscs: [],
  };
}

describe('applyGEMaskRemap', () => {
  it('remaps fan-in references while preserving source and target flags', () => {
    const sourceMask = { isMask: true, alphaMaskEnabled: true };
    const firstTargetMask = {
      isMask: false,
      references: [{ mask: { id: 'source-old' }, inverted: true }],
    };
    const secondTargetMask = {
      isMask: false,
      references: [{ mask: { id: 'source-old' }, inverted: false }],
    };
    const collector = createCollector([
      { id: 'source-new', mask: sourceMask },
      { id: 'target-a', mask: firstTargetMask },
      { id: 'target-b', mask: secondTargetMask },
    ]);

    applyGEMaskRemap(collector, { 'source-old': 'source-new' });

    expect(sourceMask).toEqual({ isMask: true, alphaMaskEnabled: true });
    expect(firstTargetMask).toEqual({
      isMask: false,
      references: [{ mask: { id: 'source-new' }, inverted: true }],
    });
    expect(secondTargetMask).toEqual({
      isMask: false,
      references: [{ mask: { id: 'source-new' }, inverted: false }],
    });
  });

  it('removes a target mask when its source ID cannot be resolved', () => {
    const target = {
      id: 'target',
      mask: {
        isMask: false,
        references: [{ mask: { id: 'missing-source' }, inverted: true }],
      },
    };
    const collector = createCollector([target]);

    applyGEMaskRemap(collector, {});

    expect(target).not.toHaveProperty('mask');
  });

  it('removes an obsolete singular target mask contract', () => {
    const target = {
      id: 'target',
      mask: { isMask: false, reference: { id: 'source-current' }, inverted: true },
    };
    const collector = createCollector([
      { id: 'source-current', mask: { isMask: true } },
      target,
    ]);

    applyGEMaskRemap(collector, {});

    expect(target).not.toHaveProperty('mask');
  });

  it('keeps a mask reference that already targets a generated component', () => {
    const source = { id: 'source-current', mask: { isMask: true, alphaMaskEnabled: false } };
    const target = {
      id: 'target',
      mask: {
        isMask: false,
        references: [{ mask: { id: 'source-current' }, inverted: false }],
      },
    };
    const collector = createCollector([source, target]);

    applyGEMaskRemap(collector, {});

    expect(target.mask).toEqual({
      isMask: false,
      references: [{ mask: { id: 'source-current' }, inverted: false }],
    });
  });

  it('remaps every multi-mask reference', () => {
    const target = {
      id: 'target',
      mask: {
        isMask: false,
        references: [
          { mask: { id: 'source-a-old' }, inverted: false },
          { mask: { id: 'source-b-old' }, inverted: true },
        ],
      },
    };
    const collector = createCollector([
      { id: 'source-a-new', mask: { isMask: true } },
      { id: 'source-b-new', mask: { isMask: true } },
      target,
    ]);

    applyGEMaskRemap(collector, {
      'source-a-old': 'source-a-new',
      'source-b-old': 'source-b-new',
    });

    expect(target.mask).toEqual({
      isMask: false,
      references: [
        { mask: { id: 'source-a-new' }, inverted: false },
        { mask: { id: 'source-b-new' }, inverted: true },
      ],
    });
  });
});
