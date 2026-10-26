/**
 * TanStack server functions POST to /_serverFn/* — static dist/ hosts return 405.
 * Browser builds should use client-side implementations first; never assume a result shape.
 */

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** True when serverFn routes are not available (flattened dist, Plex static, etc.). */
export function staticSpaHost(): boolean {
  return isBrowser();
}

export function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export async function callServerFnFirst<T>(
  client: () => Promise<T>,
  server: () => Promise<T>,
  empty: T,
): Promise<T> {
  if (staticSpaHost()) {
    try {
      return await client();
    } catch {
      try {
        const res = await server();
        return res ?? empty;
      } catch {
        return empty;
      }
    }
  }
  try {
    const res = await server();
    if (res != null) return res;
  } catch {
    /* dev SSR / local server may still run client */
  }
  try {
    return await client();
  } catch {
    return empty;
  }
}
