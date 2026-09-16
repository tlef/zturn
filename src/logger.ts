/* eslint-disable @typescript-eslint/naming-convention */
import { type Middleware } from "koa";

// Logger is the one module-level singleton in the app. Everything else is
// constructed in App and injected. It writes one JSON object per line so the
// output is greppable locally and parseable by a log shipper.

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

let minLevel: Level = "info";

const Logger = {
	setLevel,
	logDebug,
	logInfo,
	logWarn,
	logError,
	getLoggerMiddleware,
};

export { Logger };

function setLevel(level: string): void {
	if (level in LEVEL_ORDER) {
		minLevel = level as Level;
	}
}

function write(level: Level, message: string, data?: object): void {
	if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
		return;
	}
	const line = JSON.stringify({
		time: new Date().toISOString(),
		level,
		message,
		...data,
	});
	if (level === "error") {
		// eslint-disable-next-line no-console
		console.error(line);
	} else {
		// eslint-disable-next-line no-console
		console.log(line);
	}
}

function logDebug(message: string, data?: object): void {
	write("debug", message, data);
}

function logInfo(message: string, data?: object): void {
	write("info", message, data);
}

function logWarn(message: string, data?: object): void {
	write("warn", message, data);
}

function logError(error: unknown, data?: object): void {
	if (error instanceof Error) {
		write("error", error.message, {
			name: error.name,
			stack: error.stack,
			...data,
		});
	} else {
		write("error", String(error), data);
	}
}

function getLoggerMiddleware(env: string): Middleware {
	if (env === "test") {
		return async (_ctx, next) => {
			await next();
		};
	}
	return async (ctx, next) => {
		const start = performance.now();
		try {
			await next();
		} finally {
			logInfo("request", {
				method: ctx.method,
				path: ctx.path,
				status: ctx.status,
				ms: Math.round(performance.now() - start),
			});
		}
	};
}
