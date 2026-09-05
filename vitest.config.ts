import { configDefaults, defineConfig } from "vitest/config";

// zexdoc/zexall together take ~15 minutes under vitest's sandboxing (vs. ~5 minutes
// run directly with `node`, per the timings recorded when they were added — see
// docs/architecture.md), so they're excluded from the default `npm test` run and
// live behind `npm run test:cpu-exerciser` instead. Run that explicitly before/
// after any change to packages/core/src/cpu/** — it's the gold-standard CPU
// correctness check and `npm test` alone won't catch a regression there.
const CPU_EXERCISER_PATTERN = "packages/core/src/cpu/zexdoc.test.ts";
const isCpuExerciser = process.argv.some((arg) => arg.includes("zexdoc"));

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...(isCpuExerciser ? [] : [CPU_EXERCISER_PATTERN])],
    environment: "node",
  },
});
