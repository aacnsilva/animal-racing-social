import { ApiError } from './http.ts';

export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string | null): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(values)) return values;
  } catch {
    throw new ApiError(422, 'VALIDATION_FAILED', 'cursor: invalid');
  }
  throw new ApiError(422, 'VALIDATION_FAILED', 'cursor: invalid');
}

export function pageLimit(query: URLSearchParams, fallback = 20): number {
  const raw = query.get('limit');
  if (raw === null) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new ApiError(422, 'VALIDATION_FAILED', 'limit: must be a positive integer');
  return Math.min(value, 100);
}

export function page<T>(rows: T[], limit: number, cursorOf: (row: T) => (string | number)[]): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(cursorOf(items[items.length - 1]!)) : null };
}
