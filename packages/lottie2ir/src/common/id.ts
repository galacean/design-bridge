import { v4 } from 'uuid';

/** Creates a 32-character hexadecimal UUID v4. */
export function createId(): string {
  return v4().replaceAll('-', '');
}
