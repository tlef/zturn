import { App, type AppConfig } from "./app.js";
import { Logger } from "./logger.js";

const DEFAULT_ENV = "development";
const DEFAULT_PORT = 41732;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_STORY_DIR = "./stories";
const DEFAULT_DATABASE_PATH = "./data/zturn.sqlite";
const DEFAULT_LOG_LEVEL = "info";

const env = process.env.ENV ?? DEFAULT_ENV;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const host = process.env.HOST ?? DEFAULT_HOST;

Logger.setLevel(process.env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL);

const config: AppConfig = {
	env,
	storyDir: process.env.STORY_DIR ?? DEFAULT_STORY_DIR,
	databasePath: process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
};

const app = new App(config);
await app.start(port, host);

async function gracefulShutdown(signal: string): Promise<void> {
	Logger.logInfo("Shutting down", { signal });
	try {
		await app.stop();
		process.exit(0);
	} catch (error) {
		Logger.logError(error);
		process.exit(1);
	}
}

process.on("SIGTERM", () => {
	void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
	void gracefulShutdown("SIGINT");
});
