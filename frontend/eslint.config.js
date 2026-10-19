// ESLint 9 flat config. Phase 1: 기존 거대 파일의 위반은 "warn"으로 두고, 구조 개편 단계에서 error로 올린다.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { importX } from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage", "playwright-report", "test-results", "public", "src/api/schema.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser }
    },
    plugins: {
      "react-hooks": reactHooks,
      "import-x": importX
    },
    settings: {
      "import-x/extensions": [".ts", ".tsx", ".js", ".jsx"],
      "import-x/parsers": { "@typescript-eslint/parser": [".ts", ".tsx"] },
      "import-x/resolver-next": [createTypeScriptImportResolver({ project: "./tsconfig.json" })]
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "import-x/no-cycle": "error",
      "import-x/no-duplicates": "warn",
      // 기존 코드 위반: 구조 개편(Phase 4) 전까지 warn
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn"
    }
  },
  {
    files: ["*.config.{js,ts}", "e2e/**/*.ts", "scripts/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node } }
  }
);
