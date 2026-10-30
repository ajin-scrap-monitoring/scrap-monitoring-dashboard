type HeaderPopoversModule = typeof import("./HeaderPopovers");

let headerPopoversPromise: Promise<HeaderPopoversModule> | null = null;
let importPopoversModule: () => Promise<HeaderPopoversModule> = () => import("./HeaderPopovers");

export const loadHeaderPopovers = () => {
  headerPopoversPromise ??= importPopoversModule().catch((error: unknown) => {
    headerPopoversPromise = null;
    throw error;
  });
  return headerPopoversPromise;
};

export const setHeaderPopoversLoaderForTest = (loader: (() => Promise<HeaderPopoversModule>) | null) => {
  importPopoversModule = loader ?? (() => import("./HeaderPopovers"));
  headerPopoversPromise = null;
};
