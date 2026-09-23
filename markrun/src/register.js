import { plugin } from "bun";

// Preloaded by bunfig.toml. The .mr source is read by runFile, not parsed as TypeScript.
const runtime = new URL("./index.ts", import.meta.url).href;

await plugin({
  name: "markrun",
  setup(build) {
    build.onLoad({ filter: /\.mr$/ }, ({ path }) => ({
      loader: "js",
      contents: [
        `import { runFile } from ${JSON.stringify(runtime)};`,
        `const document = await runFile(${JSON.stringify(path)});`,
        "export default document;",
      ].join("\n"),
    }));
  },
});
