import Koa from "koa";
import Router from "@koa/router";
import { koaBody } from "koa-body";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { Logger } from "./logger.js";
import { AppDatabase } from "./libs/database/index.js";
import {
	GameRegistry,
	type IGameRegistry,
	scanStoryDirectory,
} from "./libs/game-registry/index.js";
import { SnapshotCache } from "./libs/snapshot-cache/index.js";
import { TokenService } from "./libs/token/index.js";
import {
	type ISessionDatastore,
	SessionValidator,
	SqliteSessionDatastore,
} from "./models/sessions/index.js";
import {
	HealthController,
	type IHealthController,
} from "./controllers/health-controller/index.js";
import {
	type ISessionController,
	SessionController,
} from "./controllers/session-controller/index.js";
import { ApiDocsController } from "./controllers/api-docs-controller/index.js";
import { ApiHealth } from "./api/health.js";
import { ApiGame } from "./api/game.js";
import { ApiSession } from "./api/session.js";
import { ApiDocs } from "./api/api-docs.js";
import { controllerErrorMiddleware } from "./api/api-errors.js";

export interface AppConfig {
	env: string;
	storyDir: string;
	databasePath: string;
	// Tests inject a registry so no story file is needed.
	gameRegistry?: IGameRegistry;
}

export class App {
	protected app: Koa;
	protected router: Router;

	protected database: AppDatabase;
	protected gameRegistry: IGameRegistry;
	protected sessionDatastore: ISessionDatastore;

	protected healthController: IHealthController;
	protected sessionController: ISessionController;

	protected apiHealth: ApiHealth;
	protected apiGame: ApiGame;
	protected apiSession: ApiSession;

	private server: ReturnType<Koa["listen"]> | null = null;

	public constructor(config: AppConfig) {
		this.app = new Koa();
		this.router = new Router();

		this.app.use(Logger.getLoggerMiddleware(config.env));
		this.app.use(errorMiddleware);
		this.app.use(controllerErrorMiddleware);
		this.app.use(koaBody());

		Logger.logInfo("App starting", {
			env: config.env,
			storyDir: config.storyDir,
			databasePath: config.databasePath,
		});

		this.gameRegistry = config.gameRegistry ?? loadGames(config.storyDir);

		this.database = new AppDatabase(openDatabasePath(config.databasePath));
		this.sessionDatastore = new SqliteSessionDatastore(this.database);

		this.healthController = new HealthController();
		this.sessionController = new SessionController(
			this.sessionDatastore,
			new SessionValidator(),
			this.gameRegistry,
			new TokenService(),
			new SnapshotCache(),
		);

		this.apiHealth = new ApiHealth(this.healthController);
		this.apiHealth.registerRoutes(this.router);

		// Swagger UI, development only. Registered before auth so /docs is public.
		if (isDevelopment(config.env)) {
			const apiDocs = new ApiDocs(new ApiDocsController());
			apiDocs.registerRoutes(this.router);
		}

		this.apiGame = new ApiGame(this.gameRegistry);
		this.apiGame.registerRoutes(this.router);

		this.apiSession = new ApiSession(this.sessionController);
		this.apiSession.registerRoutes(this.router);

		this.app.use(this.router.routes());
		this.app.use(this.router.allowedMethods());
	}

	// Resolves once the port is bound, so getPort() is accurate afterwards.
	public async start(port: number, host: string): Promise<void> {
		const server = this.app.listen(port, host);
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("listening", resolve);
			server.once("error", reject);
		});
		Logger.logInfo("Listening", { port: this.getPort(), host });
	}

	public async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
		}
		this.database.close();
	}

	// The port actually bound, for callers that start on port 0.
	public getPort(): number | null {
		const address = this.server?.address();
		return address && typeof address === "object" ? address.port : null;
	}

	public getCallback(): ReturnType<Koa["callback"]> {
		return this.app.callback();
	}
}

function isDevelopment(env: string): boolean {
	return env === "development" || env === "local";
}

// A missing story directory is not fatal: the server starts with no games
// and says so, which is easier to diagnose than a crash on first boot.
function loadGames(storyDir: string): IGameRegistry {
	if (!existsSync(storyDir)) {
		Logger.logWarn("Story directory not found; no games loaded", { storyDir });
		return new GameRegistry([]);
	}
	const scan = scanStoryDirectory(storyDir);
	for (const skipped of scan.skipped) {
		Logger.logWarn("Skipping story file", skipped);
	}
	Logger.logInfo("Games loaded", { games: scan.stories.map((s) => s.id) });
	return new GameRegistry(scan.stories);
}

function openDatabasePath(databasePath: string): string {
	if (databasePath !== ":memory:") {
		mkdirSync(dirname(databasePath), { recursive: true });
	}
	return databasePath;
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
