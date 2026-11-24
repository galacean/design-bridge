const inputRoutes = {
  ge: '/api/ge2ir',
  dsl: '/api/dsl2ge',
  lottie: '/api/lottie2ge',
};

export type InputFormat = keyof typeof inputRoutes;

export async function listInputFiles(format: InputFormat, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${inputRoutes[format]}/list-input`, { signal });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const value: unknown = await response.json();

  if (value == null || typeof value !== 'object' || !('files' in value) || !Array.isArray(value.files) ||
    !value.files.every((file: unknown) => typeof file === 'string' && /^https?:\/\//i.test(file) && URL.canParse(file))) {
    throw new TypeError('文件列表格式无效。');
  }

  return value.files;
}

export async function readInputTextFromUrl(url: string, signal?: AbortSignal, errorPrefix = ''): Promise<string> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`${errorPrefix}HTTP ${response.status}`);
  }

  return response.text();
}

export async function readInputText(format: InputFormat, filename: string, signal?: AbortSignal): Promise<string> {
  if (!/^https?:\/\//i.test(filename) || !URL.canParse(filename)) {
    throw new Error(`${format} 输入必须是 HTTP(S) URL。`);
  }

  return readInputTextFromUrl(filename, signal);
}
