/**
 * Deep clone for plain-JSON values (GameState is JSON-serializable by design).
 * Avoids depending on DOM/Node typings so the engine stays environment-free.
 */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
