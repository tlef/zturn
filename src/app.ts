import Koa from "koa";
import Router from "@koa/router";
import { koaBody } from "koa-body";

import { Logger } from "./logger.js";
import {
	HealthController,
	type IHealthController,
} from "./controllers/health-controller/index.js";
import { ApiHealth } from "./api/health.js";

export interface AppConfig {
	env: string;
	storyDir: string;
	databasePath: string;
}

export class App {
	protected app: Koa;
	protected router: Router;

	protected healthController: IHealthController;

	protected apiHealth: ApiHealth;

	private server: ReturnType<Koa["listen"]> | null = null;

	public constructor(config: AppConfig) {
		this.app = new Koa();
		this.router = new Router();

		this.app.use(Logger.getLoggerMiddleware(config.env));
		this.app.use(errorMiddleware);
		this.app.use(koaBody());

		Logger.logInfo("App starting", {
			env: config.env,
			storyDir: config.storyDir,
			databasePath: config.databasePath,
		});

		this.healthController = new HealthController();

		this.apiHealth = new ApiHealth(this.healthController);
		this.apiHealth.registerRoutes(this.router);

		this.app.use(this.router.routes());
		this.app.use(this.router.allowedMethods());
	}

	public start(port: number, host: string): void {
		this.server = this.app.listen(port, host);
		Logger.logInfo("Listening", { port, host });
	}

	public async stop(): Promise<void> {
		const server = this.server;
		if (!server) {
			return;
		}
		this.server = null;
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	}

	public getCallback(): ReturnType<Koa["callback"]> {
		return this.app.callback();
	}
}

// Logs 5xx errors and returns a clean body. 4xx errors from ctx.throw are
// re-thrown so Koa renders them as usual.
async function errorMiddleware(
	ctx: Koa.Context,
	next: Koa.Next,
): Promise<void> {
	try {
		await next();
	} catch (err: unknown) {
		const status =
			err instanceof Error && "status" in err
				? (err as { status: number }).status
				: 500;
		if (status < 500) {
			throw err;
		}
		Logger.logError(err, { method: ctx.method, path: ctx.path });
		ctx.status = 500;
		ctx.body = { error: "internal_error" };
	}
}
