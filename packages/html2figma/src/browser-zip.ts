import JSZip from 'jszip';
import { createVirtualProject, findDefaultEntryPath, inferMimeType } from './model/virtual-project';
import type { VirtualProject, VirtualProjectFile } from './model/virtual-project';

/** Entry selection and resource limits for importing a ZIP as a virtual project. */
export interface VirtualProjectZipOptions {
  /** Entry HTML path. Defaults to root index.html/index.htm, then nested index, then the first HTML file. */
  entryPath?: string;
  /** Maximum compressed archive size in bytes. Defaults to 50 MiB. */
  maxArchiveBytes?: number;
  /** Maximum file count after excluding directories and macOS metadata. Defaults to 2,000. */
  maxFiles?: number;
  /** Maximum total decoded file bytes, checked after each file is decompressed. Defaults to 200 MiB. */
  maxUncompressedBytes?: number;
}

const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILES = 2_000;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

/**
 * Imports HTML and resource files from a ZIP archive into a virtual project.
 *
 * @param input - ZIP file or archive bytes.
 * @param options - Entry path and compressed size, file count, and decoded size limits.
 * @returns A project with normalized paths; directories and macOS metadata are omitted.
 * @throws If the ZIP is invalid, a limit is exceeded, a path escapes the root, or the HTML entry is unavailable.
 */
export async function createVirtualProjectFromZip(
  input: Blob | ArrayBuffer | Uint8Array,
  options: VirtualProjectZipOptions = {},
): Promise<VirtualProject> {
  const archiveBytes = await toUint8Array(input);
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;

  if (archiveBytes.byteLength > maxArchiveBytes) {
    throw new Error(`ZIP archive exceeds the ${maxArchiveBytes} byte compressed size limit.`);
  }

  const zip = await JSZip.loadAsync(archiveBytes);
  const entries = Object.values(zip.files).filter(entry => !entry.dir && !isMetadataPath(entry.name));
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  if (entries.length > maxFiles) {
    throw new Error(`ZIP archive contains ${entries.length} files, exceeding the ${maxFiles} file limit.`);
  }

  const files: VirtualProjectFile[] = [];
  const maxUncompressedBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  let uncompressedBytes = 0;

  for (const entry of entries) {
    const bytes = await entry.async('uint8array');

    uncompressedBytes += bytes.byteLength;
    if (uncompressedBytes > maxUncompressedBytes) {
      throw new Error(`ZIP contents exceed the ${maxUncompressedBytes} byte uncompressed size limit.`);
    }

    files.push({
      path: entry.name,
      bytes,
      mimeType: inferMimeType(entry.name),
    });
  }

  return createVirtualProject(files, options.entryPath ?? findDefaultEntryPath(files));
}

async function toUint8Array(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }

  return new Uint8Array(await input.arrayBuffer());
}

function isMetadataPath(filePath: string): boolean {
  return /(?:^|\/)__MACOSX(?:\/|$)/i.test(filePath) || /(?:^|\/)\.DS_Store$/i.test(filePath);
}
