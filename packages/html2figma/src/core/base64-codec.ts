const BASE64_CHUNK_SIZE = 0x8000;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_SIZE);

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function encodeBase64Text(value: string): string {
  return encodeBase64(new TextEncoder().encode(value));
}

export function decodeBase64Text(value: string): string {
  return new TextDecoder().decode(decodeBase64(value));
}
