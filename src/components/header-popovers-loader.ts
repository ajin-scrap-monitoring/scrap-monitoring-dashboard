export function createModuleLoader<T>(importer: () => Promise<T>): () => Promise<T> {
  let cachedPromise: Promise<T> | null = null;
  return () => {
    cachedPromise ??= importer().catch((error: unknown) => {
      cachedPromise = null;
      throw error;
    });
    return cachedPromise;
  };
}

export const loadHeaderPopovers = createModuleLoader(() => import("./HeaderPopovers"));
