import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context } from "koa";
import type Router from "@koa/router";

// The page lives beside this module's parent in both src/ and out/; the
// build copies it into out/ alongside the compiled code.
const PAGE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"adapters",
	"web",
	"page",
	"index.html",
);

// Serves the browser client. It is a static page that talks to the same
// API as every other adapter, so it needs no controller.
export class ApiWeb {
	private readonly page: string;

	constructor() {
		this.page = readFileSync(PAGE_PATH, "utf8");
	}

	public registerRoutes(router: Router): void {
		router.get("/", this.getPage.bind(this));
	}

	private async getPage(ctx: Context): Promise<void> {
		ctx.type = "html";
		ctx.body = this.page;
	}
}
