import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // DIP boundary (modular-DDD refactor, see modules/README.md): the
  // runtime-agnostic core must not import a framework/runtime or a DB SDK — that
  // is what keeps the app portable off Workers and each module extractable.
  // Framework/SDK calls belong in an infrastructure adapter. Scoped to the pure
  // layers; adapters and the interface layer are deliberately excluded.
  {
    files: [
      "modules/**/domain/**/*.{ts,tsx}",
      "modules/**/application/**/*.{ts,tsx}",
      "lib/kernel/result.ts",
      "lib/kernel/events.ts",
      "lib/kernel/ports.ts",
      "lib/kernel/index.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "Domain/application must stay runtime-agnostic — import kernel ports, not Next. Put framework calls in an infrastructure adapter.",
            },
            {
              group: ["@supabase/*", "@/lib/supabase/*"],
              message:
                "No direct DB/SDK access in domain/application — depend on a Repository port and implement it in infrastructure.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
