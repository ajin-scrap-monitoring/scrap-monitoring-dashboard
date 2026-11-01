import { appendFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const distDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../dist/", import.meta.url));
const assetDirectory = join(distDirectory, "assets");
const files = await readdir(assetDirectory);
const sizes = new Map(await Promise.all(files.map(async (file) => [file, (await stat(join(assetDirectory, file))).size])));

const sumMatching = (pattern) => [...sizes].reduce((total, [file, size]) => pattern.test(file) ? total + size : total, 0);
const initialJavaScript = [...sizes].find(([file]) => /^index-.*\.js$/.test(file))?.[1] ?? 0;
const totalJavaScript = sumMatching(/\.js$/);
const totalStyles = sumMatching(/\.css$/);
const totalFonts = sumMatching(/\.(?:woff2?|ttf|otf)$/);
const totalAssets = [...sizes.values()].reduce((total, size) => total + size, 0);

const budgets = [
  ["초기 JavaScript", initialJavaScript, 340 * 1024, "KiB"],
  ["전체 JavaScript", totalJavaScript, 975 * 1024, "KiB"],
  ["전체 CSS", totalStyles, 65 * 1024, "KiB"],
  ["전체 웹폰트", totalFonts, Math.round(4.9 * 1024 * 1024), "MiB"],
  ["전체 정적 자산", totalAssets, Math.round(6.4 * 1024 * 1024), "MiB"],
];

for (const [label, size, limit, unit] of budgets) {
  if (unit === "MiB") {
    console.log(`${label}: ${(size / (1024 * 1024)).toFixed(2)} MiB / ${(limit / (1024 * 1024)).toFixed(1)} MiB`);
  } else {
    console.log(`${label}: ${(size / 1024).toFixed(1)} KiB / ${(limit / 1024).toFixed(1)} KiB`);
  }
}

const exceeded = budgets.filter(([, size, limit]) => size > limit);
if (exceeded.length > 0) {
  const labels = exceeded.map(([label]) => label).join(", ");
  const warningMessage = `빌드 크기가 기준을 초과했습니다: ${labels}`;
  if (process.env.GITHUB_ACTIONS === "true") {
    console.log(`::warning title=빌드 크기 기준 초과::${warningMessage}`);
  } else {
    console.warn(`경고: ${warningMessage}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const tableHeader = "### 빌드 크기 점검 결과\n\n| 항목 | 크기 | 기준 | 상태 |\n| --- | --- | --- | --- |\n";
    const tableRows = budgets.map(([label, size, limit, unit]) => {
      const sizeStr = unit === "MiB" ? `${(size / (1024 * 1024)).toFixed(2)} MiB` : `${(size / 1024).toFixed(1)} KiB`;
      const limitStr = unit === "MiB" ? `${(limit / (1024 * 1024)).toFixed(1)} MiB` : `${(limit / 1024).toFixed(1)} KiB`;
      const status = size > limit ? "기준 초과 (경고)" : "정상";
      return `| ${label} | ${sizeStr} | ${limitStr} | ${status} |`;
    }).join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${tableHeader}${tableRows}\n`, "utf8");
  }
}
