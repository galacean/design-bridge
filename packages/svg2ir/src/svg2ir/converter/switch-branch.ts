import type { Element } from '@svgdotjs/svg.js';

function isConditionallySupported (element: globalThis.Element): boolean {
  if ((element.getAttribute('requiredFeatures') ?? '').trim() !== '') { return false; }
  if ((element.getAttribute('requiredExtensions') ?? '').trim() !== '') { return false; }

  const rawLanguages = element.getAttribute('systemLanguage')?.trim();

  if (rawLanguages == null || rawLanguages === '') { return true; }
  const languages = [
    globalThis.navigator?.language,
    ...(globalThis.navigator?.languages ?? []),
  ]
    .filter((language): language is string => language != null && language !== '')
    .map(language => language.toLowerCase());

  return rawLanguages.split(',').some(rawLanguage => {
    const language = rawLanguage.trim().toLowerCase();

    return language !== '' && languages.some(current => current === language || current.startsWith(`${language}-`));
  });
}

export function getActiveSwitchChild (switchNode: globalThis.Element): globalThis.Element | null {
  return Array.from(switchNode.children).find(isConditionallySupported) ?? null;
}

export function isInInactiveSwitchBranch (element: Element): boolean {
  let current = element.node as globalThis.Element | null;

  while (current?.parentNode != null) {
    const parent = current.parentNode as globalThis.Element;

    if (parent.tagName?.toLowerCase() === 'switch') {
      let branch = current;

      while (branch.parentNode != null && branch.parentNode !== parent) {
        branch = branch.parentNode as globalThis.Element;
      }
      if (getActiveSwitchChild(parent) !== branch) { return true; }
    }
    if (parent.tagName?.toLowerCase() === 'svg') { break; }
    current = parent;
  }

  return false;
}
