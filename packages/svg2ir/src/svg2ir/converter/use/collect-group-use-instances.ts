import type EditableSVG from '../../../parse-svg/svg-parser';
import type { Element } from '@svgdotjs/svg.js';
import type { IRShape } from '@galacean/animation-ir';
import { readPresentationAttribute } from '../../../parse-svg/read-presentation-attribute';
import { readSVGOwnOpacity } from '../../read-attributes';
import { IDENTITY, multiply, parseTransform, type SVGMatrix } from '../../matrix';
import { parseShapeElement } from '../shape/parse-shape-element';
import { getActiveSwitchChild } from '../switch-branch';
import { readUseTarget, readUseTranslate } from './expand-use';

export interface GroupUseInstance {
  kind: 'shape' | 'text' | 'image';
  source: Element;
  target: Element;
  shape?: IRShape;
  matrix: SVGMatrix;
  name: string;
  ancestorStopNode: globalThis.Element | null;
  opacity: number;
  visible: boolean;
}

function readOwnOpacity (node: globalThis.Element): number {
  const raw = readPresentationAttribute(node, 'opacity');
  const value = raw == null || raw.trim() === '' ? 1 : Number(raw);

  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function isOwnVisible (node: globalThis.Element): boolean {
  const display = readPresentationAttribute(node, 'display')?.trim().toLowerCase();
  const visibility = readPresentationAttribute(node, 'visibility')?.trim().toLowerCase();

  return display !== 'none' && visibility !== 'hidden' && visibility !== 'collapse';
}

function collectGroupElement (
  es: EditableSVG,
  element: Element,
  idShapes: ReadonlyMap<string, IRShape>,
  idEls: ReadonlyMap<string, Element>,
  rootStopNode: globalThis.Element | null,
  parentMatrix: SVGMatrix,
  parentOpacity: number,
  parentVisible: boolean,
): GroupUseInstance[] {
  const node = element.node;

  if (node == null) { return []; }
  const tag = node.tagName.toLowerCase();
  const ownMatrix = multiply(parentMatrix, parseTransform(node.getAttribute('transform') ?? ''));
  const ownOpacity = parentOpacity * readOwnOpacity(node);
  const ownVisible = parentVisible && isOwnVisible(node);

  if (tag === 'g' || tag === 'a') {
    return collectGroupChildren(
      es,
      element,
      idShapes,
      idEls,
      rootStopNode,
      parentMatrix,
      parentOpacity,
      parentVisible,
    );
  }
  if (tag === 'switch') {
    const activeChild = getActiveSwitchChild(node);
    const activeElement = activeChild == null
      ? undefined
      : element.find('*').find(candidate => candidate.node === activeChild);

    return activeElement == null
      ? []
      : collectGroupElement(es, activeElement, idShapes, idEls, rootStopNode, ownMatrix, ownOpacity, ownVisible);
  }
  const shape = parseShapeElement(es, element, tag);

  if (shape != null) {
    return [{
      kind: 'shape',
      source: element,
      target: element,
      shape,
      matrix: ownMatrix,
      name: String(node.getAttribute('id') ?? tag),
      ancestorStopNode: rootStopNode,
      opacity: ownOpacity,
      visible: ownVisible,
    }];
  }
  if (tag === 'text' || tag === 'image') {
    return [{
      kind: tag,
      source: element,
      target: element,
      matrix: ownMatrix,
      name: String(node.getAttribute('id') ?? tag),
      ancestorStopNode: rootStopNode,
      opacity: ownOpacity,
      visible: ownVisible,
    }];
  }
  if (tag !== 'use') { return []; }
  const targetId = readUseTarget(es, element);
  const target = targetId == null ? undefined : idEls.get(targetId);
  const targetShape = targetId == null ? undefined : idShapes.get(targetId);

  if (target == null || targetShape == null) { return []; }
  const { x, y } = readUseTranslate(es, element);
  const useMatrix = multiply(ownMatrix, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  const targetMatrix = parseTransform(target.node?.getAttribute('transform') ?? '');

  return [{
    kind: 'shape',
    source: element,
    target,
    shape: targetShape,
    matrix: multiply(useMatrix, targetMatrix),
    name: String(node.getAttribute('id') ?? targetId),
    ancestorStopNode: null,
    opacity: ownOpacity * readSVGOwnOpacity(target),
    visible: ownVisible && isOwnVisible(target.node),
  }];
}

function collectGroupChildren (
  es: EditableSVG,
  container: Element,
  idShapes: ReadonlyMap<string, IRShape>,
  idEls: ReadonlyMap<string, Element>,
  rootStopNode: globalThis.Element | null,
  parentMatrix: SVGMatrix,
  parentOpacity: number,
  parentVisible: boolean,
): GroupUseInstance[] {
  const node = container.node;

  if (node == null) { return []; }
  const ownMatrix = multiply(parentMatrix, parseTransform(node.getAttribute('transform') ?? ''));
  const ownOpacity = parentOpacity * readOwnOpacity(node);
  const ownVisible = parentVisible && isOwnVisible(node);
  const instances: GroupUseInstance[] = [];

  for (const child of container.find('*')) {
    if (child.node?.parentNode !== node) { continue; }
    instances.push(...collectGroupElement(
      es,
      child,
      idShapes,
      idEls,
      rootStopNode,
      ownMatrix,
      ownOpacity,
      ownVisible,
    ));
  }

  return instances;
}

export function collectGroupUseInstances (
  es: EditableSVG,
  groupEl: Element,
  idShapes: ReadonlyMap<string, IRShape>,
  idEls: ReadonlyMap<string, Element>,
): GroupUseInstance[] {
  const rootStopNode = groupEl.node?.parentNode as globalThis.Element | null;

  return collectGroupChildren(es, groupEl, idShapes, idEls, rootStopNode, IDENTITY, 1, true);
}
