import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const typeCheckedRules = [
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
];

export default defineConfig([
  globalIgnores(["coverage", "dist", "playwright-report", "test-results"]),
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      typeCheckedRules,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["*.config.ts", "e2e/**/*.ts"],
    extends: [typeCheckedRules],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
