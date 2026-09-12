import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const distDirectory = new URL("../dist/", import.meta.url);
const assetDirectory = new URL("assets/", distDirectory);
const files = await readdir(assetDirectory);
const sizes = new Map(await Promise.all(files.map(async (file) => [file, (await stat(join(assetDirectory.pathname, file))).size])));

const sumMatching = (pattern) => [...sizes].reduce((total, [file, size]) => pattern.test(file) ? total + size : total, 0);
const initialJavaScript = [...sizes].find(([file]) => /^index-.*\.js$/.test(file))?.[1] ?? 0;
const totalJavaScript = sumMatching(/\.js$/);
const totalStyles = sumMatching(/\.css$/);
const totalFonts = sumMatching(/\.(?:woff2?|ttf|otf)$/);
const totalAssets = [...sizes.values()].reduce((total, size) => total + size, 0);

const budgets = [
  ["초기 JavaScript", initialJavaScript, 260 * 1024],
  ["전체 JavaScript", totalJavaScript, 300 * 1024],
  ["전체 CSS", totalStyles, 50 * 1024],
  ["전체 웹폰트", totalFonts, 4 * 1024 * 1024],
  ["전체 정적 자산", totalAssets, 4.5 * 1024 * 1024],
];

const failures = budgets.filter(([, size, limit]) => size > limit);
for (const [label, size, limit] of budgets) {
  console.log(`${label}: ${(size / 1024).toFixed(1)} KiB / ${(limit / 1024).toFixed(1)} KiB`);
}

if (failures.length > 0) {
  const labels = failures.map(([label]) => label).join(", ");
  throw new Error(`빌드 크기 예산 초과: ${labels}`);
}
