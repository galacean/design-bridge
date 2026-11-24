import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import EffectsRenderPanel from '../src/pages/lottie2ge/components/effects-render-panel';
import EffectsPlayer from '../src/features/ge-preview/effects-player';

const hooks = vi.hoisted(() => {
  const cells: unknown[] = [];
  let cursor = 0;

  return {
    useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void] {
      const index = cursor++;

      if (!(index in cells)) {
        cells[index] = initial;
      }

      return [cells[index] as T, value => {
        cells[index] = typeof value === 'function'
          ? (value as (previous: T) => T)(cells[index] as T) : value;
      }];
    },
    render() { cursor = 0; },
    reset() { cells.length = 0; cursor = 0; },
  };
});

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: hooks.useState,
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useRef: <T>(current: T) => ({ current }),
  useEffect: () => undefined,
}));
vi.mock('../src/features/ge-preview/effects-player', () => ({ default: () => null }));
vi.mock('../src/features/local-inputs/use-input-request', () => ({
  useInputRequest: () => ({ beginRequest: () => new AbortController().signal, cancelRequest: vi.fn() }),
}));

function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<Record<string, unknown>>(child)) {
      return [];
    }

    return [child, ...elements(child.props.children as ReactNode)];
  });
}

function render() {
  hooks.render();

  return elements(EffectsRenderPanel());
}

function button(label: string) {
  const element = render().find(item => item.type === 'button' && item.props.children === label);

  expect(element, label).toBeDefined();

  return element!;
}

function click(label: string) {
  (button(label).props.onClick as () => void)();
}

function edit(value: string) {
  const editor = render().find(item => item.type === 'textarea');

  expect(editor).toBeDefined();
  (editor!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
}

beforeEach(() => hooks.reset());

describe('GE render panel source editor', () => {
  it('unmounts source text during preview and preserves it for editing without reloading the scene', () => {
    const source = JSON.stringify({ version: '3.6', compositions: [], items: [] });

    edit(source);
    click('渲染预览');
    expect(render().some(item => item.type === 'textarea')).toBe(false);
    const scene = render().find(item => item.type === EffectsPlayer)!.props.effectsData;

    expect(scene).toEqual(JSON.parse(source));
    click('编辑 JSON');
    const editor = render().find(item => item.type === 'textarea')!;

    expect(editor.props.value).toBe(source);
    expect(editor.props.spellCheck).toBe(false);
    expect(editor.props.wrap).toBe('off');
    expect(render().find(item => item.type === EffectsPlayer)!.props.effectsData).toBe(scene);
    edit('{invalid');
    click('渲染预览');
    expect(render().find(item => item.type === 'textarea')!.props.value).toBe('{invalid');
    expect(render().find(item => item.type === EffectsPlayer)!.props.effectsData).toBe(scene);
    click('清空');
    expect(render().find(item => item.type === 'textarea')!.props.value).toBe('');
    expect(render().find(item => item.type === EffectsPlayer)!.props.effectsData).toBeNull();
  });

  it('collapses imported JSON and restores the exact file content when editing', async () => {
    const source = '{ "version": "3.6", "items": [] }';
    const input = render().find(item => item.type === 'input' && item.props.type === 'file')!;
    const event = { target: { files: [{ name: 'scene.json', text: async () => source }], value: 'scene.json' } };

    (input.props.onChange as (event: unknown) => void)(event);
    await Promise.resolve();
    expect(render().some(item => item.type === 'textarea')).toBe(false);
    expect(render().find(item => item.type === EffectsPlayer)!.props.effectsData).toEqual(JSON.parse(source));
    click('编辑 JSON');
    expect(render().find(item => item.type === 'textarea')!.props.value).toBe(source);
  });
});
