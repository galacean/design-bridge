import { describe, expect, it } from 'vitest';
import { DataType, type EndBehavior } from '@galacean/effects-specification';

import { normalizeHierarchyActivationIntervals } from '../../../src/ir2ge/post-process/normalize-activation-intervals';
import type { GeneratedMiscData } from '../../../src/ir2ge/types';

const roundNumber = (value: number, precision: number): number => {
  const factor = 10 ** precision;

  return Math.round(value * factor) / factor;
};

interface MiniItem {
  id: string;
  delay: number;
  duration: number;
  parentId?: string;
}

interface MiniClip {
  start: number;
  duration: number;
  endBehavior?: EndBehavior;
}

function makeItem(id: string, delay: number, duration: number, parentId?: string): MiniItem {
  return parentId != null ? { id, delay, duration, parentId } : { id, delay, duration };
}

/**
 * Build the misc shape `normalizeHierarchyActivationIntervals` expects:
 * one ObjectBindingTrack per generated item, each pointing at child track
 * dicts (ActivationTrack / TransformTrack / SpriteColorTrack). Returns the
 * misc array along with the item binding list.
 */
function buildMiscFor(bindings: Array<{ itemId: string; clipStart: number; clipDuration: number }>): {
  miscs: GeneratedMiscData[];
  itemBindings: Array<{ itemId: string; objectBindingTrackId: string }>;
} {
  const miscs: GeneratedMiscData[] = [];
  const itemBindings: Array<{ itemId: string; objectBindingTrackId: string }> = [];

  for (const binding of bindings) {
    const activationTrackId = `act_${binding.itemId}`;
    const transformTrackId = `xf_${binding.itemId}`;
    const spriteColorTrackId = `col_${binding.itemId}`;
    const objectBindingTrackId = `obt_${binding.itemId}`;

    miscs.push(
      {
        id: activationTrackId,
        dataType: DataType.ActivationTrack,
        clips: [{ start: binding.clipStart, duration: binding.clipDuration } as MiniClip],
      },
      {
        id: transformTrackId,
        dataType: DataType.TransformTrack,
        clips: [{ start: binding.clipStart, duration: binding.clipDuration } as MiniClip],
      },
      {
        id: spriteColorTrackId,
        dataType: DataType.SpriteColorTrack,
        clips: [{ start: binding.clipStart, duration: binding.clipDuration } as MiniClip],
      },
      {
        id: objectBindingTrackId,
        dataType: DataType.ObjectBindingTrack,
        children: [{ id: activationTrackId }, { id: transformTrackId }, { id: spriteColorTrackId }],
      },
    );
    itemBindings.push({ itemId: binding.itemId, objectBindingTrackId });
  }

  return { miscs, itemBindings };
}

describe('normalizeHierarchyActivationIntervals', () => {
  it('no-ops when every child starts after its parent', () => {
    const items: MiniItem[] = [makeItem('parent', 0, 10), makeItem('child', 2, 5, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 0, clipDuration: 10 },
      { itemId: 'child', clipStart: 2, clipDuration: 5 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      roundNumber,
    });

    expect(items[1].delay).toBe(2);
    expect(items[1].duration).toBe(5);
    const childActivationClip = (miscs.find(misc => misc['id'] === 'act_child')!['clips'] as MiniClip[])[0];

    expect(childActivationClip.start).toBe(2);
    expect(childActivationClip.duration).toBe(5);
  });

  it('clamps a precomp child to the parent window when child starts earlier', () => {
    // Precomp child = entire (delay+duration) fits inside parent duration.
    // parent: delay=2 duration=8 → parent end at t=10
    // child: delay=0 duration=10 → before normalize, child reaches t=10 (== parent end)
    // After normalize: child.delay → 2 (parent's delay), child.duration shrinks to fit
    const items: MiniItem[] = [makeItem('parent', 2, 8), makeItem('child', 0, 8, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 2, clipDuration: 8 },
      { itemId: 'child', clipStart: 0, clipDuration: 8 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      roundNumber,
    });

    expect(items[1].delay).toBe(2);
    // precomp child: newDuration = min(originalDuration, parentDuration - originalDelay)
    // = min(8, 8 - 0) = 8 → unchanged
    expect(items[1].duration).toBe(8);
  });

  it('trims an unmarked generated child to drop the invisible head', () => {
    // Internal generated children remain contained by their implementation parent.
    const items: MiniItem[] = [
      makeItem('parent', 5, 5), // parent visible 5..10
      makeItem('child', 0, 20, 'parent'), // child wants 0..20
    ];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 5, clipDuration: 5 },
      { itemId: 'child', clipStart: 0, clipDuration: 20 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      roundNumber,
    });

    expect(items[1].delay).toBe(5);
    // timeDiff = 5 - 0 = 5; newDuration = 20 - 5 = 15
    expect(items[1].duration).toBe(15);
  });

  it('extends a Transform Parent activation without changing the child interval', () => {
    // child starts at t=1, parent starts at t=4 → transform parent must
    // advance back to t=1 so the child can render from its own start time.
    // Activation clip moves; child stays put.
    const items: MiniItem[] = [makeItem('parent', 4, 10), makeItem('child', 1, 3, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 4, clipDuration: 10 },
      { itemId: 'child', clipStart: 1, clipDuration: 3 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      transformParentChildItemIds: new Set(['child']),
      roundNumber,
    });

    // parent advanced back by 3 (=4-1), duration extended by 3
    expect(items[0].delay).toBe(1);
    expect(items[0].duration).toBe(13);
    const parentActivationClip = (miscs.find(misc => misc['id'] === 'act_parent')!['clips'] as MiniClip[])[0];

    expect(parentActivationClip.start).toBe(1);
    expect(parentActivationClip.duration).toBe(13);

    // child unchanged
    expect(items[1].delay).toBe(1);
    expect(items[1].duration).toBe(3);
  });

  it('only touches ActivationTrack when advancing parent (TransformTrack untouched)', () => {
    const items: MiniItem[] = [makeItem('parent', 4, 10), makeItem('child', 1, 3, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 4, clipDuration: 10 },
      { itemId: 'child', clipStart: 1, clipDuration: 3 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      transformParentChildItemIds: new Set(['child']),
      roundNumber,
    });

    // TransformTrack clip should NOT be touched by the parent-advance phase
    const parentTransformClip = (miscs.find(misc => misc['id'] === 'xf_parent')!['clips'] as MiniClip[])[0];

    expect(parentTransformClip.start).toBe(4);
    expect(parentTransformClip.duration).toBe(10);
  });

  it('extends every ancestor across a nested Transform Parent chain', () => {
    const items: MiniItem[] = [
      makeItem('root', 8, 2),
      makeItem('parent', 4, 2, 'root'),
      makeItem('child', 1, 2, 'parent'),
    ];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'root', clipStart: 8, clipDuration: 2 },
      { itemId: 'parent', clipStart: 4, clipDuration: 2 },
      { itemId: 'child', clipStart: 1, clipDuration: 2 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      transformParentChildItemIds: new Set(['parent', 'child']),
      roundNumber,
    });

    expect(items).toEqual([
      makeItem('root', 1, 9),
      makeItem('parent', 1, 5, 'root'),
      makeItem('child', 1, 2, 'parent'),
    ]);
  });

  it('rounds delay/duration to 4 decimals via the injected roundNumber', () => {
    const items: MiniItem[] = [makeItem('parent', 0.123456, 10), makeItem('child', 0, 5, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 0.123456, clipDuration: 10 },
      { itemId: 'child', clipStart: 0, clipDuration: 5 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      roundNumber,
    });

    expect(items[1].delay).toBe(0.1235);
  });

  it('clamps zero/negative duration to epsilon', () => {
    // Parent-link child with delay+duration > parentDuration → isPrecompChild=false,
    // so timeDiff = effectiveDelay - originalDelay = 10, newDuration = 3 - 10 = -7,
    // which gets clamped to 0.0001.
    const items: MiniItem[] = [makeItem('parent', 10, 2), makeItem('child', 0, 3, 'parent')];
    const { miscs, itemBindings } = buildMiscFor([
      { itemId: 'parent', clipStart: 10, clipDuration: 2 },
      { itemId: 'child', clipStart: 0, clipDuration: 3 },
    ]);

    normalizeHierarchyActivationIntervals({
      items,
      miscs,
      itemBindings,
      roundNumber,
    });

    expect(items[1].duration).toBe(0.0001);
  });
});
