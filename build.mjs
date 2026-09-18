import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";

const root = dirname(fileURLToPath(import.meta.url));

await buildPlugin(import.meta.url, {
  name: "infinite-canvas-node-pack",
  publicDir: join(root, "preview")
});
