import reylo from "reylo/esbuild";
import { mkdir } from "node:fs/promises";
const result = await Bun.build({
  entrypoints: ["src/server.ts"], target: "bun", plugins: [reylo()],
  outdir: "dist", sourcemap: "external",
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
// Bundled import.meta.url lives in dist, so ../public and ../db still resolve
// from the repository. Shipping the dist folder alone is not supported.
await mkdir("dist", { recursive: true });
for (const output of result.outputs) console.log(`Built ${output.path} (${output.size} bytes)`);
