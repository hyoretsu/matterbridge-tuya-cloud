import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";

export default tseslint.config(
  { ignores: [".github/", "dist/", "node_modules/", ".sdk/", ".cache/", "tools/", "**/*.test.ts"] },
  { files: ["src/**/*.ts"], extends: [eslint.configs.recommended, ...tseslint.configs.recommended], rules: { "no-console": "error" } },
  prettier,
);
