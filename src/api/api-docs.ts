import { createReadStream } from "node:fs";
import { type Context } from "koa";
import type Router from "@koa/router";
import {
	type IApiDocsController,
	SWAGGER_UI_ASSETS,
} from "../controllers/api-docs-controller/index.js";

// Development only. Serves Swagger UI for the routes documented with
// @openapi blocks in this directory. Not registered in production.
export class ApiDocs {
	protected apiDocsController: IApiDocsController;

	constructor(apiDocsController: IApiDocsController) {
		this.apiDocsController = apiDocsController;
	}

	public registerRoutes(router: Router): void {
		router.get("/docs", this.getDocs.bind(this));
		router.get("/docs/swagger.json", this.getSpec.bind(this));
		router.get("/docs/static/:asset", this.getStaticAsset.bind(this));
	}

	private async getDocs(ctx: Context): Promise<void> {
		ctx.type = "html";
		ctx.body = this.apiDocsController.getDocsHtml();
	}

	private async getSpec(ctx: Context): Promise<void> {
		ctx.body = this.apiDocsController.getSpec();
	}

	private async getStaticAsset(ctx: Context): Promise<void> {
		const name = String(ctx.params.asset);
		const path = this.apiDocsController.getStaticAssetPath(name);
		const type = SWAGGER_UI_ASSETS.get(name);
		if (!path || !type) {
			ctx.throw(404);
		}
		ctx.type = type;
		ctx.body = createReadStream(path);
	}
}
