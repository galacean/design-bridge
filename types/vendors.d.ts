declare module '*.css' {}

declare module 'kiwi-schema' {
  export function decodeBinarySchema(data: Uint8Array): unknown;
  export function compileSchema(schema: unknown): {
    encodeMessage(msg: unknown): Uint8Array;
    decodeMessage(data: Uint8Array): unknown;
  };
  export function encodeBinarySchema(schema: unknown): Uint8Array;
}

declare module 'fig-kiwi' {
  export function decode(data: Uint8Array): unknown;
  export function encode(data: unknown): Uint8Array;
}
