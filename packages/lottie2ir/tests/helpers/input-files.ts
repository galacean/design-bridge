import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lottieFixtures from '../fixtures/lotties.json';

type LottieFixtureData = {
  lotties?: string[];
};

export const TEST_INPUT_LIMITS = {
  convert: 5,
  runtimeCompat: 20,
  coverage: 30,
  snapshot: 12,
} as const;

const LOCAL_INPUT_DIR_ENV = 'LOTTIE2IR_TEST_INPUT_DIR';
const DEFAULT_INPUT_DIR = fileURLToPath(new URL('../fixtures', import.meta.url));

export function isUsingLocalInputDir(): boolean {
  return getLocalInputDir() != null;
}

export function hasInputSources(): boolean {
  return listInputJsonFiles(1).length > 0;
}

export function listInputJsonFiles(limit: number, sort = true): string[] {
  const localInputDir = getLocalInputDir();

  if (localInputDir != null) {
    const localFiles = listLocalJsonFiles(localInputDir);

    if (sort) {
      localFiles.sort();
    }

    return localFiles.slice(0, limit);
  }

  const parsed = lottieFixtures as LottieFixtureData;
  const names = (parsed.lotties ?? []).filter(name => typeof name === 'string' && name.length > 0);

  if (sort) {
    names.sort();
  }

  return names.slice(0, limit).map(name => path.resolve(DEFAULT_INPUT_DIR, name));
}

const contentCache = new Map<string, string>();

export function readInputJson(fileName: string): string {
  const cached = contentCache.get(fileName);

  if (cached !== undefined) {
    return cached;
  }

  const content = readFileSync(fileName, 'utf8');

  contentCache.set(fileName, content);

  return content;
}

function getLocalInputDir(): string | undefined {
  const dir = process.env[LOCAL_INPUT_DIR_ENV];

  if (dir == null || dir.trim() === '') {
    return undefined;
  }

  return path.resolve(dir);
}

function listLocalJsonFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listLocalJsonFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      files.push(fullPath);
    }
  }

  return files;
}
