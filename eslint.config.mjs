import js from "@eslint/js";
import react from "eslint-plugin-react";
import hooks from "eslint-plugin-react-hooks";

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".next-demo/**",
      ".next-cloud/**",
      ".venv-cloud/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "reports/**",
      "public/pdf/**",
      ".local-data/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: Object.fromEntries(
        [
          "window",
          "document",
          "URL",
          "URLSearchParams",
          "Blob",
          "FileReader",
          "fetch",
          "Response",
          "Headers",
          "AbortSignal",
          "Buffer",
          "crypto",
          "process",
          "console",
          "setTimeout",
          "clearTimeout",
          "structuredClone",
        ].map((name) => [name, "readonly"]),
      ),
    },
    plugins: { react, "react-hooks": hooks },
    rules: {
      ...js.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
