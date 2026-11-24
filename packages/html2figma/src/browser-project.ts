import { encodeBase64 } from './core/base64-codec';
import { extractSceneDocumentFromHTML } from './browser-runtime';
import type { BrowserExtractSceneOptions } from './browser-runtime';
import type { ConversionDiagnostic, HTMLSceneDocument } from './model/html-scene-document';
import {
  createVirtualProject,
  findDefaultEntryPath,
  inferMimeType,
  readVirtualProjectText,
  resolveProjectPath,
} from './model/virtual-project';
import type { VirtualProject, VirtualProjectFile } from './model/virtual-project';

/**
 * Reads browser-selected files into a virtual HTML project.
 *
 * @param files - Files from a file or directory picker; uses `webkitRelativePath` when present, otherwise `name`.
 * @param entryPath - Entry HTML path. When omitted, prefers a root index, then a nested index, then any HTML file.
 * @returns A virtual project containing copied file bytes and normalized paths.
 */
export async function createVirtualProjectFromFiles(
  files: Iterable<File>,
  entryPath?: string,
): Promise<VirtualProject> {
  const projectFiles: VirtualProjectFile[] = [];

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;

    projectFiles.push({
      path: relativePath,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || inferMimeType(relativePath),
    });
  }

  return createVirtualProject(projectFiles, entryPath ?? findDefaultEntryPath(projectFiles));
}

/**
 * Inlines a virtual project's local resources and extracts its entry HTML in a browser iframe.
 *
 * @param project - Entry HTML and its resources.
 * @param options - Iframe rendering policies and limits. Timeout applies to extraction after resource inlining.
 * @returns A scene document with extraction and missing-resource diagnostics.
 */
export async function extractSceneDocumentFromProject(
  project: VirtualProject,
  options: BrowserExtractSceneOptions = {},
): Promise<HTMLSceneDocument> {
  const materialized = await materializeVirtualProjectHTML(project);
  const document = await extractSceneDocumentFromHTML(materialized.html, options);

  document.diagnostics.push(...materialized.diagnostics);

  return document;
}

/** Inlined entry HTML and diagnostics produced while resolving virtual project resources. */
export interface MaterializedVirtualProject {
  /** HTML with supported local stylesheets and resource references embedded. */
  html: string;
  /** Missing-resource observations; unresolved references remain in the HTML. */
  diagnostics: ConversionDiagnostic[];
}

/**
 * Embeds supported local stylesheets, images, fonts, and script references into the entry HTML.
 *
 * @param project - Virtual project to resolve in the browser using `DOMParser`.
 * @returns Inlined HTML and missing-resource diagnostics. External URLs remain unchanged.
 */
export async function materializeVirtualProjectHTML(project: VirtualProject): Promise<MaterializedVirtualProject> {
  const diagnostics: ConversionDiagnostic[] = [];
  const parser = new DOMParser();
  const source = readVirtualProjectText(project, project.entryPath);
  const document = parser.parseFromString(source, 'text/html');
  const dataURLCache = new Map<string, string>();
  const reportMissing = (ownerPath: string, reference: string) => {
    diagnostics.push({
      severity: 'warning',
      code: 'RESOURCE_NOT_FOUND',
      message: `Resource "${reference}" referenced by "${ownerPath}" was not found in the virtual project.`,
    });
  };

  for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))) {
    const reference = link.getAttribute('href') ?? '';
    const resolvedPath = resolveProjectPath(project.entryPath, reference);

    if (resolvedPath === null) {
      continue;
    }
    if (!project.files.has(resolvedPath)) {
      reportMissing(project.entryPath, reference);
      continue;
    }

    const style = document.createElement('style');

    style.textContent = await rewriteCSSResources(
      readVirtualProjectText(project, resolvedPath),
      resolvedPath,
      project,
      dataURLCache,
      reportMissing,
    );
    link.replaceWith(style);
  }

  for (const style of Array.from(document.querySelectorAll('style'))) {
    style.textContent = await rewriteCSSResources(
      style.textContent ?? '',
      project.entryPath,
      project,
      dataURLCache,
      reportMissing,
    );
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[style]'))) {
    const cssText = element.getAttribute('style') ?? '';

    element.setAttribute(
      'style',
      await rewriteCSSResources(cssText, project.entryPath, project, dataURLCache, reportMissing),
    );
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[src], [poster]'))) {
    for (const attribute of ['src', 'poster']) {
      await rewriteElementURL(element, attribute, project.entryPath, project, dataURLCache, reportMissing);
    }
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[srcset]'))) {
    const srcset = element.getAttribute('srcset') ?? '';
    const rewritten: string[] = [];

    for (const candidate of srcset.split(',')) {
      const [reference, ...descriptor] = candidate.trim().split(/\s+/);

      rewritten.push(
        `${resolveResourceDataURL(project.entryPath, reference, project, dataURLCache, reportMissing)} ${descriptor.join(' ')}`.trim(),
      );
    }

    element.setAttribute('srcset', rewritten.join(', '));
  }

  document.querySelectorAll('base').forEach(element => element.remove());

  return {
    html: `<!doctype html>\n${document.documentElement.outerHTML}`,
    diagnostics,
  };
}

async function rewriteElementURL(
  element: HTMLElement,
  attribute: string,
  ownerPath: string,
  project: VirtualProject,
  cache: Map<string, string>,
  reportMissing: (ownerPath: string, reference: string) => void,
): Promise<void> {
  const reference = element.getAttribute(attribute);

  if (reference === null) {
    return;
  }

  element.setAttribute(attribute, resolveResourceDataURL(ownerPath, reference, project, cache, reportMissing));
}

async function rewriteCSSResources(
  cssText: string,
  ownerPath: string,
  project: VirtualProject,
  cache: Map<string, string>,
  reportMissing: (ownerPath: string, reference: string) => void,
): Promise<string> {
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let result = '';
  let offset = 0;

  for (const match of cssText.matchAll(pattern)) {
    const index = match.index;

    result += cssText.slice(offset, index);
    result += `url("${resolveResourceDataURL(ownerPath, match[2], project, cache, reportMissing)}")`;
    offset = index + match[0].length;
  }

  return result + cssText.slice(offset);
}

function resolveResourceDataURL(
  ownerPath: string,
  reference: string,
  project: VirtualProject,
  cache: Map<string, string>,
  reportMissing: (ownerPath: string, reference: string) => void,
): string {
  const resolvedPath = resolveProjectPath(ownerPath, reference);

  if (resolvedPath === null) {
    return reference;
  }

  const cached = cache.get(resolvedPath);

  if (cached !== undefined) {
    return cached;
  }

  const file = project.files.get(resolvedPath);

  if (file === undefined) {
    reportMissing(ownerPath, reference);

    return reference;
  }

  const dataURL = `data:${file.mimeType};base64,${encodeBase64(file.bytes)}`;

  cache.set(resolvedPath, dataURL);

  return dataURL;
}
