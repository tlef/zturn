export enum ERRORS {
	unsupported_story = "unsupported_story",
	snapshot_corrupt = "snapshot_corrupt",
	snapshot_incompatible = "snapshot_incompatible",
	story_mismatch = "story_mismatch",
	game_over = "game_over",
}

// Full VM state at a turn boundary. Opaque to callers; only the engine that
// produced it can read it, and only while its format version matches.
export type Snapshot = Uint8Array;

// What the game is blocked on after a turn. "char" cannot occur in a
// version 3 story but is kept so the interface need not change for v5.
export type Awaiting = "line" | "char" | "none";

export interface Status {
	location: string;
	score: number;
	moves: number;
}

export interface TurnOutput {
	text: string;
	status: Status | null;
	awaiting: Awaiting;
}

export interface TurnResult {
	state: Snapshot;
	out: TurnOutput;
}

export interface StoryInfo {
	zVersion: number;
	release: number;
	serial: string;
	checksum: number;
}

// A game turn is a pure function from a snapshot and one line of input to a
// new snapshot and a block of output. Given the same seed and inputs an
// engine always produces the same result.
export interface IEngine {
	getStoryInfo: () => StoryInfo;
	boot: (seed: number) => TurnResult;
	step: (state: Snapshot, input: string) => TurnResult;
}
