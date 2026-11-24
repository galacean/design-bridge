export function downloadJson(filename: string, content: string): void {
  if (content.trim() === '') {
    return;
  }

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadJsonValue(filename: string, value: unknown): void {
  downloadJson(filename, JSON.stringify(value, null, 2));
}
