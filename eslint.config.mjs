import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

export default defineConfig([
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
				...globals.node,
			},
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [
      js.configs.recommended,
    ],
    rules: {
      "semi": ["error", "always"],
      "prefer-const": "error",
      "no-unused-vars": "error",
      "no-console": "error",
    },
  },
  {
    ignores: ["node_modules/"],
  },
]);
