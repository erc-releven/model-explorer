import config from "@acdh-oeaw/eslint-config";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "eslint.config.*",
      "postcss.config.cjs",
      "tailwind.config.cjs",
      "vite.config.ts",
    ],
  },
  ...config,
];
