import { ControllerError } from "../../../libs/controller-error/index.js";
import {
	ERRORS as ENGINE_ERRORS,
	type IEngine,
	type Snapshot,
	type TurnOutput,
} from "../../../libs/engine/index.js";
import { type IGameRegistry } from "../../../libs/game-registry/index.js";
import { type ISnapshotCache } from "../../../libs/snapshot-cache/index.js";
import { type ITokenService } from "../../../libs/token/index.js";
import {
	type ISessionBase,
	type ISessionDatastore,
	type ISessionValidator,
	type ITurnBase,
} from "../../../models/sessions/index.js";
import {
	ERRORS,
	type ICreatedSession,
	type IPlayTurnRequest,
	type ISessionController,
	type ISessionSummary,
	type ITranscriptEntry,
	type ITurnReply,
} from "../types.js";

// The turn function's caller. Loads the session, applies the version and
// idempotency rules, replays to the current state when the cache misses,
// steps the engine once, and commits with compare-and-swap.
export class SessionController implements ISessionController {
	protected sessionDatastore: ISessionDatastore;
	protected sessionValidator: ISessionValidator;
	protected gameRegistry: IGameRegistry;
	protected tokenService: ITokenService;
	protected snapshotCache: ISnapshotCache;

	constructor(
		sessionDatastore: ISessionDatastore,
		sessionValidator: ISessionValidator,
		gameRegistry: IGameRegistry,
		tokenService: ITokenService,
		snapshotCache: ISnapshotCache,
	) {
		this.sessionDatastore = sessionDatastore;
		this.sessionValidator = sessionValidator;
		this.gameRegistry = gameRegistry;
		this.tokenService = tokenService;
		this.snapshotCache = snapshotCache;
	}

	async createSession(gameId: string): Promise<ICreatedSession> {
		if (!this.sessionValidator.isValidGameId(gameId)) {
			throw new ControllerError(ERRORS.invalid_game_id);
		}
		const game = this.gameRegistry.get(gameId);
		if (!game) {
			throw new ControllerError(ERRORS.game_not_found);
		}
		const now = new Date().toISOString();
		const token = this.tokenService.generateToken();
		const session: ISessionBase = {
			id: this.tokenService.generateSessionId(),
			gameId,
			seed: this.tokenService.generateSeed(),
			tokenHash: this.tokenService.hashToken(token),
			version: 0,
			createdAt: now,
			lastPlayedAt: now,
		};
		const booted = game.engine.boot(session.seed);
		await this.sessionDatastore.createSession(session, booted.out);
		this.snapshotCache.set(session.id, 0, booted.state);
		return {
			session: this.summarize(session, booted.out),
			token,
			out: booted.out,
		};
	}

	async authorize(sessionId: string, token: string | null): Promise<void> {
		const session = await this.loadSession(sessionId);
		if (!token || !this.tokenService.verifyToken(token, session.tokenHash)) {
			throw new ControllerError(ERRORS.unauthorized);
		}
	}

	async getSession(sessionId: string): Promise<ISessionSummary> {
		const session = await this.loadSession(sessionId);
		const turns = await this.loadTurns(session);
		return this.summarize(session, turns[session.version].output);
	}

	async playTurn(
		sessionId: string,
		request: IPlayTurnRequest,
	): Promise<ITurnReply> {
		this.validateTurnRequest(request);
		const session = await this.loadSession(sessionId);

		// A repeated key returns the stored reply and never steps the game.
		if (request.idempotencyKey) {
			const seen = await this.sessionDatastore.getTurnByKey(
				sessionId,
				request.idempotencyKey,
			);
			if (seen) {
				return { turn: seen.turn, out: seen.output };
			}
		}

		const turns = await this.loadTurns(session);
		const current = turns[session.version];
		if (
			request.expectedTurn !== undefined &&
			request.expectedTurn !== session.version
		) {
			throw this.conflict(session.version, current.output);
		}
		if (current.output.awaiting === "none") {
			throw new ControllerError(ERRORS.game_over, {
				turn: session.version,
				out: current.output,
			});
		}

		const engine = this.engineFor(session);
		const state = this.stateAt(engine, session, turns);
		const result = this.stepEngine(engine, state, request.input);
		const turn: ITurnBase = {
			turn: session.version + 1,
			input: request.input,
			output: result.out,
			idempotencyKey: request.idempotencyKey ?? null,
		};

		let committed: boolean;
		try {
			committed = await this.sessionDatastore.commitTurn(
				sessionId,
				session.version,
				turn,
				new Date().toISOString(),
			);
		} catch (error) {
			// Two requests with the same key can race past the lookup above;
			// the unique index then rejects the second, which is the stored reply.
			committed = false;
			if (!request.idempotencyKey) {
				throw error;
			}
		}
		if (!committed) {
			if (request.idempotencyKey) {
				const seen = await this.sessionDatastore.getTurnByKey(
					sessionId,
					request.idempotencyKey,
				);
				if (seen) {
					return { turn: seen.turn, out: seen.output };
				}
			}
			const latest = await this.loadSession(sessionId);
			const latestTurns = await this.loadTurns(latest);
			throw this.conflict(latest.version, latestTurns[latest.version].output);
		}
		this.snapshotCache.set(sessionId, turn.turn, result.state);
		return { turn: turn.turn, out: result.out };
	}

	async getTranscript(sessionId: string): Promise<ITranscriptEntry[]> {
		const session = await this.loadSession(sessionId);
		const turns = await this.loadTurns(session);
		return turns.map((t) => ({ turn: t.turn, input: t.input, out: t.output }));
	}

	async rewind(sessionId: string, toTurn: number): Promise<ISessionSummary> {
		if (!this.sessionValidator.isValidTurn(toTurn)) {
			throw new ControllerError(ERRORS.invalid_turn);
		}
		const session = await this.loadSession(sessionId);
		if (toTurn > session.version) {
			throw new ControllerError(ERRORS.invalid_turn);
		}
		if (toTurn < session.version) {
			const ok = await this.sessionDatastore.rewind(
				sessionId,
				toTurn,
				new Date().toISOString(),
			);
			if (!ok) {
				const latest = await this.loadSession(sessionId);
				const latestTurns = await this.loadTurns(latest);
				throw this.conflict(latest.version, latestTurns[latest.version].output);
			}
			this.snapshotCache.drop(sessionId);
		}
		return this.getSession(sessionId);
	}

	private validateTurnRequest(request: IPlayTurnRequest): void {
		if (!this.sessionValidator.isValidInput(request.input)) {
			throw new ControllerError(ERRORS.invalid_input);
		}
		if (
			request.expectedTurn !== undefined &&
			!this.sessionValidator.isValidTurn(request.expectedTurn)
		) {
			throw new ControllerError(ERRORS.invalid_turn);
		}
		if (
			request.idempotencyKey !== undefined &&
			!this.sessionValidator.isValidIdempotencyKey(request.idempotencyKey)
		) {
			throw new ControllerError(ERRORS.invalid_idempotency_key);
		}
	}

	private async loadSession(sessionId: string): Promise<ISessionBase> {
		if (!this.sessionValidator.isValidSessionId(sessionId)) {
			throw new ControllerError(ERRORS.invalid_session_id);
		}
		const session = await this.sessionDatastore.getSession(sessionId);
		if (!session) {
			throw new ControllerError(ERRORS.session_not_found);
		}
		return session;
	}

	private async loadTurns(session: ISessionBase): Promise<ITurnBase[]> {
		const turns = await this.sessionDatastore.getTurns(session.id);
		if (turns.length !== session.version + 1) {
			throw new ControllerError(ERRORS.session_corrupt);
		}
		return turns;
	}

	private engineFor(session: ISessionBase): IEngine {
		const game = this.gameRegistry.get(session.gameId);
		if (!game) {
			throw new ControllerError(ERRORS.game_not_found);
		}
		return game.engine;
	}

	// Snapshots are a cache over the input log. On a miss, replay from boot.
	private stateAt(
		engine: IEngine,
		session: ISessionBase,
		turns: ITurnBase[],
	): Snapshot {
		const cached = this.snapshotCache.get(session.id, session.version);
		if (cached) {
			return cached;
		}
		let state = engine.boot(session.seed).state;
		for (let i = 1; i <= session.version; i++) {
			state = this.stepEngine(engine, state, turns[i].input ?? "").state;
		}
		this.snapshotCache.set(session.id, session.version, state);
		return state;
	}

	private stepEngine(engine: IEngine, state: Snapshot, input: string) {
		try {
			return engine.step(state, input);
		} catch (error) {
			if (error instanceof Error && error.message === ENGINE_ERRORS.game_over) {
				throw new ControllerError(ERRORS.game_over);
			}
			throw error;
		}
	}

	private conflict(turn: number, out: TurnOutput): ControllerError {
		return new ControllerError(ERRORS.turn_conflict, { turn, out });
	}

	private summarize(
		session: ISessionBase,
		latest: TurnOutput,
	): ISessionSummary {
		return {
			id: session.id,
			gameId: session.gameId,
			turn: session.version,
			status: latest.status,
			awaiting: latest.awaiting,
			createdAt: session.createdAt,
			lastPlayedAt: session.lastPlayedAt,
		};
	}
}
