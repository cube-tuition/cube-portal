import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      // Nothing in this codebase legitimately uses bitwise operators, and a
      // stray one is exactly how the Aug 14 student-workbook crash happened:
      // "| 'collab'" fell out of a comment onto live code, coerced a hook's
      // return array to 0, and destructuring 0 threw on every student render.
      // Valid JS, so only a lint rule can catch it at commit time.
      "no-bitwise": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
