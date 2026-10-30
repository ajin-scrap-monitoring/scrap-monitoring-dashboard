import { describe, expect, it, vi } from "vitest";

import { createModuleLoader } from "./header-popovers-loader";

describe("createModuleLoader", () => {
  it("동시 호출 시 같은 promise를 반환한다", () => {
    let resolvePromise!: (value: string) => void;
    const importer = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const loader = createModuleLoader(importer);

    const first = loader();
    const second = loader();

    expect(first).toBe(second);
    expect(importer).toHaveBeenCalledTimes(1);

    resolvePromise("module");
  });

  it("실패하면 다음 호출에서 importer를 다시 부른다", async () => {
    let callCount = 0;
    const importer = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return Promise.reject(new Error("load failed"));
      }
      return Promise.resolve("recovered");
    });
    const loader = createModuleLoader(importer);

    await expect(loader()).rejects.toThrow("load failed");
    expect(importer).toHaveBeenCalledTimes(1);

    const result = await loader();
    expect(result).toBe("recovered");
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("성공 후에는 importer를 다시 부르지 않는다", async () => {
    const importer = vi.fn(() => Promise.resolve("ready"));
    const loader = createModuleLoader(importer);

    const first = await loader();
    const second = await loader();

    expect(first).toBe("ready");
    expect(second).toBe("ready");
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
