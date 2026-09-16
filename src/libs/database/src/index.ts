import { DatabaseSync } from "node:sqlite";
import { type IAppDatabase } from "../types.js";

// One SQLite connection for the process. Pass ":memory:" for tests.
export class AppDatabase implements IAppDatabase {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		this.db = new DatabaseSync(path);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA foreign_keys = ON");
		this.db.exec("PRAGMA busy_timeout = 5000");
	}

	getConnection(): DatabaseSync {
		return this.db;
	}

	close(): void {
		this.db.close();
	}
}
