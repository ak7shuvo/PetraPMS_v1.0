import js from "@eslint/js";
import tseslint from "typescript-eslint";
// Stub plugins so existing "eslint-disable next/react-hooks" comments resolve without pulling in those plugins.
const noop = { meta: {}, create: () => ({}) };
const stubs = { plugins: { "@next/next": { rules: { "no-img-element": noop } }, "react-hooks": { rules: { "exhaustive-deps": noop } } } };
export default tseslint.config(stubs,
  { ignores: ["**/.next/**", "**/node_modules/**", "dist/**", "**/*.generated.ts", "apps/desktop/stage/**", "apps/web/public/sw.js", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-assignment": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  { files: ["**/*.cjs", "**/*.mjs", "scripts/**"], languageOptions: { globals: { process: "readonly", console: "readonly", __dirname: "readonly", require: "readonly", module: "readonly", fetch: "readonly", URL: "readonly", setTimeout: "readonly", Buffer: "readonly" } } },
);
