import { describe, it, before } from "mocha";
import { expect } from "chai";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZvmEngine } from "./index.js";
import { ERRORS, type Snapshot, type TurnResult } from "../types.js";
import { decodeSnapshot, encodeSnapshot } from "./snapshot.js";

// Any version 3 story will do. ZTURN_TEST_STORY overrides the default so the
// suite can run against a freely distributable game when Zork is absent.
const STORY_PATH = resolve(process.env.ZTURN_TEST_STORY ?? "stories/zork1.z3");

const SEED = 12345;
const PROBE_INPUTS = ["look", "inventory", "north", "look", "wait"];

// Some stories open with a question before the first command prompt. Keyed
// by serial number; anything not listed boots straight to a prompt.
const PREAMBLES = new Map<string, string[]>([
	["151001", ["n"]], // Adventure (ZILF): "Do you need instructions?"
]);

function loadStory(): Uint8Array | null {
	return existsSync(STORY_PATH)
		? new Uint8Array(readFileSync(STORY_PATH))
		: null;
}

// Boot and answer any opening question, returning the first real prompt.
function start(engine: ZvmEngine, seed: number): TurnResult {
	let result = engine.boot(seed);
	for (const input of PREAMBLES.get(engine.getStoryInfo().serial) ?? []) {
		result = engine.step(result.state, input);
	}
	return result;
}

function play(engine: ZvmEngine, seed: number, inputs: string[]): TurnResult[] {
	const results = [start(engine, seed)];
	for (const input of inputs) {
		results.push(engine.step(results[results.length - 1].state, input));
	}
	return results;
}

describe("ZvmEngine", function () {
	let story: Uint8Array;

	before(function () {
		const loaded = loadStory();
		if (!loaded) {
			// eslint-disable-next-line no-console
			console.log(
				`    (skipping: no story file at ${STORY_PATH}; set ZTURN_TEST_STORY or add stories/zork1.z3)`,
			);
			this.skip();
		}
		story = loaded as Uint8Array;
	});

	it("rejects a story that is not version 3", () => {
		const bogus = new Uint8Array(0x40);
		bogus[0] = 5;
		expect(() => new ZvmEngine(bogus)).to.throw(ERRORS.unsupported_story);
	});

	it("reports the story header", () => {
		const info = new ZvmEngine(story).getStoryInfo();
		expect(info.zVersion).to.equal(3);
		expect(info.serial).to.have.length(6);
		expect(info.release).to.be.greaterThan(0);
	});

	it("boots to the first prompt with intro text and a status line", () => {
		const { out } = new ZvmEngine(story).boot(SEED);
		expect(out.awaiting).to.equal("line");
		expect(out.text).to.not.equal("");
		expect(out.text).to.not.match(/>\s*$/);
		expect(out.status).to.not.equal(null);
		expect(out.status?.location).to.not.equal("");
		expect(out.status?.moves).to.be.a("number");
	});

	it("plays a turn and advances the move counter", () => {
		const engine = new ZvmEngine(story);
		const booted = start(engine, SEED);
		const turn = engine.step(booted.state, "look");
		expect(turn.out.awaiting).to.equal("line");
		expect(turn.out.text).to.not.equal("");
		expect(turn.out.status?.moves).to.be.greaterThan(
			booted.out.status?.moves ?? 0,
		);
	});

	it("is deterministic: same seed and inputs give identical output and bytes", () => {
		const a = play(new ZvmEngine(story), SEED, PROBE_INPUTS);
		const b = play(new ZvmEngine(story), SEED, PROBE_INPUTS);
		for (let i = 0; i < a.length; i++) {
			expect(b[i].out).to.deep.equal(a[i].out);
			expect(Buffer.compare(a[i].state, b[i].state)).to.equal(0);
		}
	});

	it("resumes from a snapshot on a fresh engine with identical results", () => {
		const first = play(new ZvmEngine(story), SEED, PROBE_INPUTS);
		const second = new ZvmEngine(story);
		const resumed = second.step(first[2].state, PROBE_INPUTS[2]);
		expect(resumed.out).to.deep.equal(first[3].out);
		expect(Buffer.compare(resumed.state, first[3].state)).to.equal(0);
	});

	it("does not let one step affect the next when snapshots are reused", () => {
		const engine = new ZvmEngine(story);
		const booted = start(engine, SEED);
		const viaLook = engine.step(booted.state, "look");
		const viaInventory = engine.step(booted.state, "inventory");
		const viaLookAgain = engine.step(booted.state, "look");
		expect(viaLookAgain.out).to.deep.equal(viaLook.out);
		expect(viaInventory.out.text).to.not.equal(viaLook.out.text);
	});

	it("lets the game's own save fail gracefully and keeps playing", () => {
		const engine = new ZvmEngine(story);
		const booted = start(engine, SEED);
		const saved = engine.step(booted.state, "save");
		expect(saved.out.awaiting).to.equal("line");
		expect(saved.out.status).to.not.equal(null);
		const next = engine.step(saved.state, "look");
		expect(next.out.awaiting).to.equal("line");
	});

	it("ends the game on quit and refuses further turns", () => {
		const engine = new ZvmEngine(story);
		const booted = start(engine, SEED);
		let result = engine.step(booted.state, "quit");
		if (result.out.awaiting === "line") {
			result = engine.step(result.state, "y");
		}
		expect(result.out.awaiting).to.equal("none");
		expect(result.out.status).to.equal(null);
		expect(() => engine.step(result.state, "look")).to.throw(ERRORS.game_over);
	});

	it("rejects corrupt and incompatible snapshots", () => {
		const engine = new ZvmEngine(story);
		const { state } = engine.boot(SEED);
		expect(() => engine.step(new Uint8Array(3), "look")).to.throw(
			ERRORS.snapshot_corrupt,
		);
		const garbage = state.slice();
		garbage.set([0, 0, 0, 0], 0);
		expect(() => engine.step(garbage, "look")).to.throw(
			ERRORS.snapshot_corrupt,
		);
		const future = state.slice();
		new DataView(future.buffer).setUint16(4, 999);
		expect(() => engine.step(future, "look")).to.throw(
			ERRORS.snapshot_incompatible,
		);
	});

	it("round-trips a snapshot through the codec unchanged", () => {
		const { state } = new ZvmEngine(story).boot(SEED);
		const again: Snapshot = encodeSnapshot(decodeSnapshot(state));
		expect(Buffer.compare(again, state)).to.equal(0);
	});
});
