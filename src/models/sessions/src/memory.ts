import {
	type ISessionBase,
	type ISessionDatastore,
	type ITurnBase,
} from "../types.js";
import { type TurnOutput } from "../../../libs/engine/index.js";

interface StoredSession {
	session: ISessionBase;
	turns: ITurnBase[];
}

// For tests and single-process use. Same contract as the SQLite store.
export class MemorySessionDatastore implements ISessionDatastore {
	private readonly sessions = new Map<string, StoredSession>();

	async createSession(session: ISessionBase, boot: TurnOutput): Promise<void> {
		this.sessions.set(session.id, {
			session: { ...session, version: 0 },
			turns: [{ turn: 0, input: null, output: boot, idempotencyKey: null }],
		});
	}

	async getSession(sessionId: string): Promise<ISessionBase | null> {
		const stored = this.sessions.get(sessionId);
		return stored ? { ...stored.session } : null;
	}

	async getTurns(sessionId: string): Promise<ITurnBase[]> {
		const stored = this.sessions.get(sessionId);
		return stored ? stored.turns.map(cloneTurn) : [];
	}

	async getTurnByKey(
		sessionId: string,
		idempotencyKey: string,
	): Promise<ITurnBase | null> {
		const stored = this.sessions.get(sessionId);
		const turn = stored?.turns.find((t) => t.idempotencyKey === idempotencyKey);
		return turn ? cloneTurn(turn) : null;
	}

	async commitTurn(
		sessionId: string,
		expectedVersion: number,
		turn: ITurnBase,
		playedAt: string,
	): Promise<boolean> {
		const stored = this.sessions.get(sessionId);
		if (!stored || stored.session.version !== expectedVersion) {
			return false;
		}
		if (turn.turn !== expectedVersion + 1) {
			return false;
		}
		stored.turns.push(cloneTurn(turn));
		stored.session.version = turn.turn;
		stored.session.lastPlayedAt = playedAt;
		return true;
	}

	async rewind(
		sessionId: string,
		toTurn: number,
		at: string,
	): Promise<boolean> {
		const stored = this.sessions.get(sessionId);
		if (!stored || toTurn < 0 || toTurn >= stored.session.version) {
			return false;
		}
		stored.turns = stored.turns.filter((t) => t.turn <= toTurn);
		stored.session.version = toTurn;
		stored.session.lastPlayedAt = at;
		return true;
	}
}

function cloneTurn(turn: ITurnBase): ITurnBase {
	return {
		...turn,
		output: {
			...turn.output,
			status: turn.output.status && { ...turn.output.status },
		},
	};
}
