import { type Context } from "koa";
import type Router from "@koa/router";
import { type IHealthController } from "../controllers/health-controller/index.js";

export class ApiHealth {
	protected healthController: IHealthController;

	constructor(healthController: IHealthController) {
		this.healthController = healthController;
	}

	public registerRoutes(router: Router): void {
		/**
		 * @openapi
		 * /health:
		 *   get:
		 *     tags:
		 *       - Health
		 *     summary: Liveness check
		 *     description: Returns ok while the process is up. No authentication.
		 *     responses:
		 *       200:
		 *         description: The service is running
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 status:
		 *                   type: string
		 *                   example: ok
		 *                 uptimeSeconds:
		 *                   type: integer
		 *                   example: 42
		 */
		router.get("/health", this.getHealth.bind(this));
	}

	private async getHealth(ctx: Context): Promise<void> {
		ctx.status = 200;
		ctx.body = this.healthController.getHealth();
	}
}
