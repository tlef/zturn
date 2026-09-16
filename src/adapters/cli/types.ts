// Wire shapes as the HTTP API returns them. The adapter deliberately defines
// its own copies rather than importing from the server's controllers, so it
// depends on the API alone.

export type Awaiting = "line" | "char" | "none";

export interface IStatus {
	location: string;
	score: number;
	moves: number;
}

export interface ITurnOutput {
	text: string;
	status: IStatus | null;
	awaiting: Awaiting;
}

export interface IGameSummary {
	id: string;
	title: string;
	story: { zVersion: number; release: number; serial: string };
}

export interface ISessionSummary {
	id: string;
	gameId: string;
	seed: number;
	turn: number;
	status: IStatus | null;
	awaiting: Awaiting;
}

export interface ICreatedSession {
	session: ISessionSummary;
	token: string;
	turn: number;
	out: ITurnOutput;
}

export interface ITurnReply {
	turn: number;
	out: ITurnOutput;
}

export interface ITranscriptEntry {
	turn: number;
	input: string | null;
	out: ITurnOutput;
}

// A complete, portable description of a session.
export interface IReplayFile {
	gameId: string;
	seed: number;
	inputs: string[];
}

export interface ISessionCredentials {
	id: string;
	token: string;
}

export interface IZturnClient {
	listGames: () => Promise<IGameSummary[]>;
	createSession: (gameId: string, seed?: number) => Promise<ICreatedSession>;
	getSession: (creds: ISessionCredentials) => Promise<ISessionSummary>;
	playTurn: (
		creds: ISessionCredentials,
		input: string,
		expectedTurn?: number,
	) => Promise<ITurnReply>;
	getTranscript: (creds: ISessionCredentials) => Promise<ITranscriptEntry[]>;
}
