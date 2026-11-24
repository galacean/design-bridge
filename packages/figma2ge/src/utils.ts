export type AnyRecord = Record<string, unknown>;

export function asRecord(value: unknown): AnyRecord | undefined {
  return value !== null && typeof value === 'object' ? (value as AnyRecord) : undefined;
}
