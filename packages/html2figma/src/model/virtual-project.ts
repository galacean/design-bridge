/** A file in an in-memory HTML project. */
export interface VirtualProjectFile {
  /** Project-relative file path; normalized to forward slashes by `createVirtualProject`. */
  path: string;
  /** Raw file contents. */
  bytes: Uint8Array;
  /** Resource MIME type; an empty value is inferred from the path during project creation. */
  mimeType: string;
}

/** Entry HTML and resource bytes shared by the Node.js and browser extraction adapters. */
export interface VirtualProject {
  /** Normalized project-relative path of the entry HTML file. */
  entryPath: string;
  /** Files keyed by normalized project-relative path. */
  files: ReadonlyMap<string, VirtualProjectFile>;
}

/**
 * Creates an in-memory project with normalized paths and copied file bytes.
 *
 * @param files - Project files; later entries replace earlier files with the same normalized path.
 * @param entryPath - Path of an existing entry file.
 * @returns A virtual project ready for extraction in Node.js or a browser.
 * @throws If a path is empty, escapes the project root, or the entry file is missing.
 */
export function createVirtualProject(files: Iterable<VirtualProjectFile>, entryPath: string): VirtualProject {
  const normalizedFiles = new Map<string, VirtualProjectFile>();

  for (const file of files) {
    const normalizedPath = normalizeProjectPath(file.path);

    normalizedFiles.set(normalizedPath, {
      path: normalizedPath,
      bytes: new Uint8Array(file.bytes),
      mimeType: file.mimeType || inferMimeType(normalizedPath),
    });
  }

  const normalizedEntryPath = normalizeProjectPath(entryPath);

  if (!normalizedFiles.has(normalizedEntryPath)) {
    throw new Error(`Virtual project entry file not found: ${normalizedEntryPath}`);
  }

  return { entryPath: normalizedEntryPath, files: normalizedFiles };
}

export function normalizeProjectPath(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length === 0) {
        throw new Error(`Virtual project path escapes its root: ${value}`);
      }
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  if (normalized.length === 0) {
    throw new Error(`Virtual project path is empty: ${value}`);
  }

  return normalized.join('/');
}

export function resolveProjectPath(ownerPath: string, reference: string): string | null {
  const trimmed = reference.trim();

  if (trimmed === '' || trimmed.startsWith('#') || /^(?:[a-z]+:|\/\/)/i.test(trimmed)) {
    return null;
  }

  const pathOnly = trimmed.split(/[?#]/, 1)[0];
  const ownerSegments = normalizeProjectPath(ownerPath).split('/');

  ownerSegments.pop();

  const referencePath = pathOnly.startsWith('/') ? pathOnly.slice(1) : [...ownerSegments, pathOnly].join('/');

  return normalizeProjectPath(referencePath);
}

export function inferMimeType(filePath: string): string {
  const extension = filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  const mimeTypes: Record<string, string> = {
    css: 'text/css',
    gif: 'image/gif',
    html: 'text/html',
    htm: 'text/html',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };

  return mimeTypes[extension] ?? 'application/octet-stream';
}

export function readVirtualProjectText(project: VirtualProject, filePath: string): string {
  const normalizedPath = normalizeProjectPath(filePath);
  const file = project.files.get(normalizedPath);

  if (file === undefined) {
    throw new Error(`Virtual project file not found: ${normalizedPath}`);
  }

  return new TextDecoder().decode(file.bytes);
}

export function findDefaultEntryPath(files: Iterable<Pick<VirtualProjectFile, 'path'>>): string {
  const candidates = Array.from(files);
  const rootIndex = candidates.find(file => /^index\.html?$/i.test(normalizeProjectPath(file.path)));
  const nestedIndex = candidates.find(file => /(?:^|\/)index\.html?$/i.test(normalizeProjectPath(file.path)));
  const firstHTML = candidates.find(file => /\.html?$/i.test(normalizeProjectPath(file.path)));
  const entry = rootIndex ?? nestedIndex ?? firstHTML;

  if (entry === undefined) {
    throw new Error('Virtual project files do not contain an HTML entry.');
  }

  return entry.path;
}
