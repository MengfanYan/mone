import js from "@eslint/js";
import hooks from "eslint-plugin-react-hooks";

const jsxPlugin = {
  rules: {
    "jsx-uses-react": {
      create(context) {
        return {
          JSXOpeningElement(node) {
            context.sourceCode.markVariableAsUsed("React", node);
          },
          JSXFragment(node) {
            context.sourceCode.markVariableAsUsed("React", node);
          },
        };
      },
    },
    "jsx-uses-vars": {
      create(context) {
        return {
          JSXOpeningElement(node) {
            let name;
            if (node.name.namespace) return;
            if (node.name.name) {
              name = node.name.name;
              if (/^[a-z]/.test(name)) return;
            } else if (node.name.object) {
              let parent = node.name.object;
              while (parent.object) parent = parent.object;
              name = parent.name;
            } else {
              return;
            }
            context.sourceCode.markVariableAsUsed(name, node);
          },
        };
      },
    },
  },
};

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
    plugins: { jsx: jsxPlugin, "react-hooks": hooks },
    rules: {
      ...js.configs.recommended.rules,
      ...hooks.configs.recommended.rules,
      "jsx/jsx-uses-react": "error",
      "jsx/jsx-uses-vars": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
