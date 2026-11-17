// Flat-config typescript-eslint, type-aware, in the family's shape (Pomade, pomade-kit): no preset
// wholesale — hand-picked rules for silent bug classes (floating and misused promises, unused
// bindings, duplicate imports), the React hooks rules for the UI, and Playwright's missing-await
// family for the e2e specs. No Prettier. Each glob is checked against exactly one tsconfig.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import playwright from "eslint-plugin-playwright";

const tsconfigRootDir = import.meta.dirname;

const baseHygieneRules = {
  "no-var": "error",
  "prefer-const": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
};

const typeAwareRules = {
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/no-unnecessary-condition": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
  ],
  "@typescript-eslint/no-explicit-any": "error",
};

function typeAware(project, extra = {}) {
  return {
    languageOptions: { parser: tseslint.parser, parserOptions: { project: [project], tsconfigRootDir } },
    plugins: { "@typescript-eslint": tseslint.plugin, ...extra.plugins },
    rules: { ...baseHygieneRules, ...typeAwareRules, ...extra.rules },
  };
}

const UI_FILES = ["src/ui/**/*.{ts,tsx}", "harness/shell/shell.ts"];
const UI_TESTS = ["src/ui/**/*.test.ts"];

export default tseslint.config(
  { ignores: ["dist/**", "prototypes/**", "test-results/**", "playwright-report/**", "e2e/artifacts/**", "**/*.d.ts"] },
  tseslint.configs.base,
  { name: "pomade-agents/config", files: ["eslint.config.mjs"], rules: baseHygieneRules },
  {
    name: "pomade-agents/ui",
    files: UI_FILES,
    ignores: UI_TESTS,
    ...typeAware("tsconfig.ui.json", {
      plugins: { "react-hooks": reactHooks },
      rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
    }),
  },
  {
    name: "pomade-agents/node",
    files: ["src/backend/**/*.ts", "src/shared/**/*.ts", ...UI_TESTS, "harness/**/*.ts", "scripts/**/*.ts", "vite.config.ts", "vite.backend.config.ts", "vitest.config.ts"],
    ignores: ["harness/shell/shell.ts"],
    ...typeAware("tsconfig.node.json"),
  },
  {
    name: "pomade-agents/e2e",
    files: ["e2e/**/*.ts", "playwright.config.ts", "playwright.pomade.config.ts"],
    ...typeAware("tsconfig.e2e.json", { plugins: { playwright }, rules: playwright.configs["flat/recommended"].rules }),
  },
);
