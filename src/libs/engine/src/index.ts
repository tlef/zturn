import { ZVM, type ZvmInstance, type ZvmReadData } from "ifvms";
import {
	ERRORS,
	type IEngine,
	type Snapshot,
	type StoryInfo,
	type TurnResult,
} from "../types.js";
import { EVTYPE_LINE_INPUT, GlkShim, RefStruct } from "./glk.js";
import { Xorshift32 } from "./prng.js";
import { decodeSnapshot, encodeSnapshot } from "./snapshot.js";
import { readStatus } from "./status.js";

const SUPPORTED_Z_VERSION = 3;

// One engine per story. It keeps a single resident VM, because ZVM compiles
// Z-code routines to JavaScript on first use and that cache is per instance.
// Every step restores the caller's snapshot into that VM, runs one turn, and
// snapshots it back out, so the VM's own state between calls never matters.
export class ZvmEngine implements IEngine {
	private readonly story: Uint8Array;
	private readonly info: StoryInfo;
	private readonly glk = new GlkShim();
	private readonly prng = new Xorshift32(1);
	private vm: ZvmInstance | null = null;

	constructor(story: Uint8Array) {
		if (story.length < 0x40 || story[0] !== SUPPORTED_Z_VERSION) {
			throw new Error(ERRORS.unsupported_story);
		}
		this.story = story;
		this.info = {
			zVersion: story[0],
			release: (story[2] << 8) | story[3],
			serial: new TextDecoder("latin1").decode(story.subarray(0x12, 0x18)),
			checksum: (story[0x1c] << 8) | story[0x1d],
		};
	}

	getStoryInfo(): StoryInfo {
		return this.info;
	}

	boot(seed: number): TurnResult {
		const vm = this.getVm();
		this.prng.setState(seed);
		this.glk.resetForTurn();
		vm.quit = 0;
		vm.restart();
		vm.run();
		this.settle(vm);
		return this.finish(vm);
	}

	step(state: Snapshot, input: string): TurnResult {
		const parts = decodeSnapshot(state);
		if (parts.awaiting === "none" || !parts.readData) {
			throw new Error(ERRORS.game_over);
		}
		const vm = this.getVm();

		// Restore in the same order as ZVM's own autorestore: screen state
		// first, then a quiet restart, then the Quetzal image over it.
		this.prng.setState(parts.rng);
		this.glk.resetForTurn();
		vm.io = parts.io;
		vm.restart(1);
		if (vm.restore_file(parts.quetzal, 1) !== 2) {
			throw new Error(ERRORS.story_mismatch);
		}
		vm.quit = 0;
		vm.glk_blocking_call = null;

		// Recreate the pending @read and fill its buffer with the input.
		const buffer: number[] = new Array<number>(
			parts.readData.bufferLength,
		).fill(0);
		const codes = Array.from(input, (ch) => ch.codePointAt(0) ?? 0).slice(
			0,
			buffer.length,
		);
		codes.forEach((code, i) => (buffer[i] = code));
		const readData: ZvmReadData = { ...parts.readData, buffer };
		vm.read_data = readData;

		// Deliver it as a Glk line input event.
		const event = new RefStruct();
		event.push_field(EVTYPE_LINE_INPUT);
		event.push_field(null);
		event.push_field(codes.length);
		event.push_field(0);
		vm.glk_event = event;
		vm.resume();
		this.settle(vm);
		return this.finish(vm);
	}

	private getVm(): ZvmInstance {
		if (this.vm) {
			return this.vm;
		}
		const vm = new ZVM();
		// ZVM writes into the buffer it is given, so hand it a copy.
		// eslint-disable-next-line @typescript-eslint/naming-convention
		vm.prepare(this.story.slice(), { Glk: this.glk });
		// Route @random through the engine's generator. A negative argument
		// reseeds, as the spec says; zero would normally switch to true
		// randomness, which is meaningless here, so it is ignored.
		vm.random = (range: number): number => {
			if (range < 0) {
				this.prng.setState(-range);
				return 0;
			}
			if (range === 0) {
				return 0;
			}
			return this.prng.random(range);
		};
		// start() sets up memory views and runs the intro once. That output
		// is discarded; boot() reruns it under the caller's seed.
		this.glk.resetForTurn();
		vm.start();
		this.vm = vm;
		return vm;
	}

	// ZVM stops for a file prompt when the game itself tries to save, restore
	// or open a transcript. Cancel each one so the game reports failure and
	// carries on until it either wants input or has quit.
	private settle(vm: ZvmInstance): void {
		while (!vm.quit && vm.glk_blocking_call) {
			vm.glk_blocking_call = null;
			if (vm.handle_create_fileref(null)) {
				vm.run();
			}
		}
	}

	private finish(vm: ZvmInstance): TurnResult {
		const ended = Boolean(vm.quit) || this.glk.hasExited();
		const pending = ended ? null : this.glk.getPending();
		const awaiting = pending ? pending.kind : "none";
		const readData: ZvmReadData | undefined = vm.read_data;
		const state = encodeSnapshot({
			rng: this.prng.getState(),
			awaiting,
			readData:
				awaiting === "line" && readData
					? {
							bufferLength: readData.buffer.length,
							bufaddr: readData.bufaddr,
							parseaddr: readData.parseaddr,
							routine: readData.routine,
							storer: readData.storer,
							time: readData.time,
						}
					: null,
			io: vm.io,
			quetzal: new Uint8Array(vm.save_file(vm.pc, 1)),
		});
		return {
			state,
			out: {
				text: cleanText(this.glk.getText()),
				status: ended ? null : readStatus(vm),
				awaiting,
			},
		};
	}
}

// Drop the game's own input prompt from the end of a turn and trim the
// blank lines Zork prints around its text.
function cleanText(raw: string): string {
	return raw
		.replace(/\r/g, "\n")
		.replace(/\s*>\s*$/, "")
		.trim();
}
