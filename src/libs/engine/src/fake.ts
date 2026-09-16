import {
	ERRORS,
	type IEngine,
	type Snapshot,
	type StoryInfo,
	type TurnResult,
} from "../types.js";

interface FakeState {
	seed: number;
	moves: number;
	over: boolean;
}

// A stand-in engine for tests above the engine layer. It is deterministic,
// echoes its input, counts moves, and ends on "quit", so controller and API
// tests need no story file.
export class FakeEngine implements IEngine {
	getStoryInfo(): StoryInfo {
		return { zVersion: 3, release: 1, serial: "000000", checksum: 0 };
	}

	boot(seed: number): TurnResult {
		return this.result(
			{ seed, moves: 0, over: false },
			`Welcome (seed ${seed})`,
		);
	}

	step(state: Snapshot, input: string): TurnResult {
		const current = decode(state);
		if (current.over) {
			throw new Error(ERRORS.game_over);
		}
		if (input === "quit") {
			return this.result({ ...current, over: true }, "Goodbye.");
		}
		const moves = current.moves + 1;
		return this.result(
			{ ...current, moves },
			`You ${input}. (move ${moves}, seed ${current.seed})`,
		);
	}

	private result(state: FakeState, text: string): TurnResult {
		return {
			state: new TextEncoder().encode(JSON.stringify(state)),
			out: {
				text,
				status: state.over
					? null
					: { location: "Nowhere", score: state.moves * 5, moves: state.moves },
				awaiting: state.over ? "none" : "line",
			},
		};
	}
}

function decode(state: Snapshot): FakeState {
	try {
		return JSON.parse(new TextDecoder().decode(state)) as FakeState;
	} catch {
		throw new Error(ERRORS.snapshot_corrupt);
	}
}
