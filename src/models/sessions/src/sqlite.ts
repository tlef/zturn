import type { DatabaseSync } from "node:sqlite";
import { type IAppDatabase } from "../../../libs/database/index.js";
import { type TurnOutput } from "../../../libs/engine/index.js";
import {
	type ISessionBase,
	type ISessionDatastore,
	type ITurnBase,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	game_id TEXT NOT NULL,
	seed INTEGER NOT NULL,
	token_hash TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	last_played_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	turn INTEGER NOT NULL,
	input TEXT,
	output TEXT NOT NULL,
	idempotency_key TEXT,
	PRIMARY KEY (session_id, turn)
);
CREATE UNIQUE INDEX IF NOT EXISTS turns_idempotency_key
	ON turns (session_id, idempotency_key)
	WHERE idempotency_key IS NOT NULL;
`;

// Row shapes mirror the column names.
/* eslint-disable @typescript-eslint/naming-convention */
interface SessionRow {
	id: string;
	game_id: string;
	seed: number;
	token_hash: string;
	version: number;
	created_at: string;
	last_played_at: string;
}

interface TurnRow {
	turn: number;
	input: string | null;
	output: string;
	idempotency_key: string | null;
}
/* eslint-enable @typescript-eslint/naming-convention */

export class SqliteSessionDatastore implements ISessionDatastore {
	private readonly db: DatabaseSync;

	constructor(database: IAppDatabase) {
		this.db = database.getConnection();
		this.db.exec(SCHEMA);
	}

	async createSession(session: ISessionBase, boot: TurnOutput): Promise<void> {
		const insertSession = this.db.prepare(
			`INSERT INTO sessions (id, game_id, seed, token_hash, version, created_at, last_played_at)
			 VALUES (?, ?, ?, ?, 0, ?, ?)`,
		);
		const insertTurn = this.db.prepare(
			`INSERT INTO turns (session_id, turn, input, output, idempotency_key)
			 VALUES (?, 0, NULL, ?, NULL)`,
		);
		this.db.exec("BEGIN");
		try {
			insertSession.run(
				session.id,
				session.gameId,
				session.seed,
				session.tokenHash,
				session.createdAt,
				session.lastPlayedAt,
			);
			insertTurn.run(session.id, JSON.stringify(boot));
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async getSession(sessionId: string): Promise<ISessionBase | null> {
		const row = this.db
			.prepare("SELECT * FROM sessions WHERE id = ?")
			.get(sessionId) as SessionRow | undefined;
		return row ? buildSessionFromRow(row) : null;
	}

	async getTurns(sessionId: string): Promise<ITurnBase[]> {
		const rows = this.db
			.prepare(
				"SELECT turn, input, output, idempotency_key FROM turns WHERE session_id = ? ORDER BY turn",
			)
			.all(sessionId) as unknown as TurnRow[];
		return rows.map(buildTurnFromRow);
	}

	async getTurnByKey(
		sessionId: string,
		idempotencyKey: string,
	): Promise<ITurnBase | null> {
		const row = this.db
			.prepare(
				"SELECT turn, input, output, idempotency_key FROM turns WHERE session_id = ? AND idempotency_key = ?",
			)
			.get(sessionId, idempotencyKey) as TurnRow | undefined;
		return row ? buildTurnFromRow(row) : null;
	}

	// The version check and the insert happen in one transaction, so two
	// racing commits can never both succeed.
	async commitTurn(
		sessionId: string,
		expectedVersion: number,
		turn: ITurnBase,
		playedAt: string,
	): Promise<boolean> {
		if (turn.turn !== expectedVersion + 1) {
			return false;
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const updated = this.db
				.prepare(
					"UPDATE sessions SET version = ?, last_played_at = ? WHERE id = ? AND version = ?",
				)
				.run(turn.turn, playedAt, sessionId, expectedVersion);
			if (Number(updated.changes) !== 1) {
				this.db.exec("ROLLBACK");
				return false;
			}
			this.db
				.prepare(
					"INSERT INTO turns (session_id, turn, input, output, idempotency_key) VALUES (?, ?, ?, ?, ?)",
				)
				.run(
					sessionId,
					turn.turn,
					turn.input,
					JSON.stringify(turn.output),
					turn.idempotencyKey,
				);
			this.db.exec("COMMIT");
			return true;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async rewind(
		sessionId: string,
		toTurn: number,
		at: string,
	): Promise<boolean> {
		if (toTurn < 0) {
			return false;
		}
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const updated = this.db
				.prepare(
					"UPDATE sessions SET version = ?, last_played_at = ? WHERE id = ? AND version > ?",
				)
				.run(toTurn, at, sessionId, toTurn);
			if (Number(updated.changes) !== 1) {
				this.db.exec("ROLLBACK");
				return false;
			}
			this.db
				.prepare("DELETE FROM turns WHERE session_id = ? AND turn > ?")
				.run(sessionId, toTurn);
			this.db.exec("COMMIT");
			return true;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}
}

function buildSessionFromRow(row: SessionRow): ISessionBase {
	return {
		id: row.id,
		gameId: row.game_id,
		seed: Number(row.seed),
		tokenHash: row.token_hash,
		version: Number(row.version),
		createdAt: row.created_at,
		lastPlayedAt: row.last_played_at,
	};
}

function buildTurnFromRow(row: TurnRow): ITurnBase {
	return {
		turn: Number(row.turn),
		input: row.input,
		output: JSON.parse(row.output) as TurnOutput,
		idempotencyKey: row.idempotency_key,
	};
}
