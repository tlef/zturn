// tsc emits only TypeScript output; static pages are copied into out/ here.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
	["src/adapters/web/page", "out/adapters/web/page"],
	["src/adapters/slack/page", "out/adapters/slack/page"],
];

for (const [from, to] of pages) {
	mkdirSync(join(projectRoot, to), { recursive: true });
	cpSync(join(projectRoot, from), join(projectRoot, to), { recursive: true });
}
