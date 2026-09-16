import type { DatabaseSync } from "node:sqlite";
import { type IAppDatabase } from "../../../libs/database/index.js";
import {
	type ISlackAppDatastore,
	type ISlackBridgeBase,
	type ISlackChannelBase,
} from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS slack_bridges (
	id TEXT PRIMARY KEY,
	signing_secret_sealed TEXT,
	created_at TEXT NOT NULL,
	activated_at TEXT
);
CREATE TABLE IF NOT EXISTS slack_channels (
	bridge_id TEXT NOT NULL REFERENCES slack_bridges(id) ON DELETE CASCADE,
	channel_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (bridge_id, channel_id)
);
`;

/* eslint-disable @typescript-eslint/naming-convention */
interface BridgeRow {
	id: string;
	signing_secret_sealed: string | null;
	created_at: string;
	activated_at: string | null;
}

interface ChannelRow {
	bridge_id: string;
	channel_id: string;
	session_id: string;
	updated_at: string;
}
/* eslint-enable @typescript-eslint/naming-convention */

export class SqliteSlackAppDatastore implements ISlackAppDatastore {
	private readonly db: DatabaseSync;

	constructor(database: IAppDatabase) {
		this.db = database.getConnection();
		this.db.exec(SCHEMA);
	}

	async createBridge(bridge: ISlackBridgeBase): Promise<void> {
		this.db
			.prepare(
				"INSERT INTO slack_bridges (id, signing_secret_sealed, created_at, activated_at) VALUES (?, ?, ?, ?)",
			)
			.run(
				bridge.id,
				bridge.signingSecretSealed,
				bridge.createdAt,
				bridge.activatedAt,
			);
	}

	async getBridge(bridgeId: string): Promise<ISlackBridgeBase | null> {
		const row = this.db
			.prepare("SELECT * FROM slack_bridges WHERE id = ?")
			.get(bridgeId) as BridgeRow | undefined;
		return row
			? {
					id: row.id,
					signingSecretSealed: row.signing_secret_sealed,
					createdAt: row.created_at,
					activatedAt: row.activated_at,
				}
			: null;
	}

	async activateBridge(
		bridgeId: string,
		signingSecretSealed: string,
		at: string,
	): Promise<boolean> {
		const result = this.db
			.prepare(
				"UPDATE slack_bridges SET signing_secret_sealed = ?, activated_at = ? WHERE id = ?",
			)
			.run(signingSecretSealed, at, bridgeId);
		return Number(result.changes) === 1;
	}

	async getChannel(
		bridgeId: string,
		channelId: string,
	): Promise<ISlackChannelBase | null> {
		const row = this.db
			.prepare(
				"SELECT * FROM slack_channels WHERE bridge_id = ? AND channel_id = ?",
			)
			.get(bridgeId, channelId) as ChannelRow | undefined;
		return row
			? {
					bridgeId: row.bridge_id,
					channelId: row.channel_id,
					sessionId: row.session_id,
					updatedAt: row.updated_at,
				}
			: null;
	}

	async setChannel(channel: ISlackChannelBase): Promise<void> {
		this.db
			.prepare(
				`INSERT INTO slack_channels (bridge_id, channel_id, session_id, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT (bridge_id, channel_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`,
			)
			.run(
				channel.bridgeId,
				channel.channelId,
				channel.sessionId,
				channel.updatedAt,
			);
	}
}
