import { v4 } from 'uuid';

/** Generate a 32-character hexadecimal UUID v4. */
export function createId(): string {
  return v4().replaceAll('-', '');
}
