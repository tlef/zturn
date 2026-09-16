import type { DatabaseSync } from "node:sqlite";

export interface IAppDatabase {
	getConnection: () => DatabaseSync;
	close: () => void;
}
