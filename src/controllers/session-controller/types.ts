import {
	type Awaiting,
	type Status,
	type TurnOutput,
} from "../../libs/engine/index.js";

export enum ERRORS {
	invalid_game_id = "invalid_game_id",
	invalid_session_id = "invalid_session_id",
	invalid_input = "invalid_input",
	invalid_turn = "invalid_turn",
	invalid_idempotency_key = "invalid_idempotency_key",
	invalid_seed = "invalid_seed",
	game_not_found = "game_not_found",
	session_not_found = "session_not_found",
	unauthorized = "unauthorized",
	// Carries { turn, out } for the turn the session is actually on.
	turn_conflict = "turn_conflict",
	game_over = "game_over",
	session_corrupt = "session_corrupt",
}

export interface ISessionSummary {
	id: string;
	gameId: string;
	// With the input list, enough to replay the session anywhere.
	seed: number;
	turn: number;
	status: Status | null;
	awaiting: Awaiting;
	createdAt: string;
	lastPlayedAt: string;
}

export interface ICreatedSession {
	session: ISessionSummary;
	token: string;
	out: TurnOutput;
}

export interface ITurnReply {
	turn: number;
	out: TurnOutput;
}

export interface ITranscriptEntry {
	turn: number;
	input: string | null;
	out: TurnOutput;
}

export interface IPlayTurnRequest {
	input: string;
	expectedTurn?: number;
	idempotencyKey?: string;
}

export interface ISessionController {
	createSession: (gameId: string, seed?: number) => Promise<ICreatedSession>;
	authorize: (sessionId: string, token: string | null) => Promise<void>;
	getSession: (sessionId: string) => Promise<ISessionSummary>;
	playTurn: (
		sessionId: string,
		request: IPlayTurnRequest,
	) => Promise<ITurnReply>;
	getTranscript: (sessionId: string) => Promise<ITranscriptEntry[]>;
	rewind: (sessionId: string, toTurn: number) => Promise<ISessionSummary>;
}
