import { type TurnOutput } from "../../libs/engine/index.js";

export interface ISessionBase {
	id: string;
	gameId: string;
	seed: number;
	tokenHash: string;
	// Number of inputs played so far. Turn 0 is the boot output.
	version: number;
	createdAt: string;
	lastPlayedAt: string;
}

export interface ITurnBase {
	turn: number;
	// null for turn 0, which is the game's own intro.
	input: string | null;
	output: TurnOutput;
	idempotencyKey: string | null;
}

// The input log is the source of truth for a session. Turns are stored with
// their output so transcripts and idempotent replies never need a replay.
export interface ISessionDatastore {
	createSession: (session: ISessionBase, boot: TurnOutput) => Promise<void>;
	getSession: (sessionId: string) => Promise<ISessionBase | null>;
	getTurns: (sessionId: string) => Promise<ITurnBase[]>;
	getTurnByKey: (
		sessionId: string,
		idempotencyKey: string,
	) => Promise<ITurnBase | null>;
	// Appends a turn only if the session is still at expectedVersion.
	// Resolves false on a version conflict; nothing is written then.
	commitTurn: (
		sessionId: string,
		expectedVersion: number,
		turn: ITurnBase,
		playedAt: string,
	) => Promise<boolean>;
	// Drops every turn after toTurn. Resolves false if the session is unknown
	// or toTurn is not below the current version.
	rewind: (sessionId: string, toTurn: number, at: string) => Promise<boolean>;
}

export interface ISessionValidator {
	isValidSessionId: (id: string) => boolean;
	isValidGameId: (id: string) => boolean;
	isValidInput: (input: string) => boolean;
	isValidTurn: (turn: number) => boolean;
	isValidIdempotencyKey: (key: string) => boolean;
}
