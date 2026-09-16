import { type Context } from "koa";
import type Router from "@koa/router";
import { type IHealthController } from "../controllers/health-controller/index.js";

export class ApiHealth {
	protected healthController: IHealthController;

	constructor(healthController: IHealthController) {
		this.healthController = healthController;
	}

	public registerRoutes(router: Router): void {
		router.get("/health", this.getHealth.bind(this));
	}

	private async getHealth(ctx: Context): Promise<void> {
		ctx.status = 200;
		ctx.body = this.healthController.getHealth();
	}
}
