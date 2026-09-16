import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { App } from "../../../app.js";
import { FakeEngine } from "../../../libs/engine/index.js";
import { type IGameRegistry } from "../../../libs/game-registry/index.js";
import { Cli, parseArgs } from "./cli.js";
import { ZturnClient } from "./client.js";

function fakeRegistry(): IGameRegistry {
	const engine = new FakeEngine();
	const game = {
		id: "fake",
		title: "Fake Game",
		story: engine.getStoryInfo(),
		engine,
	};
	return {
		list: () => [{ id: game.id, title: game.title, story: game.story }],
		get: (id: string) => (id === "fake" ? game : null),
	};
}

class Capture extends Writable {
	public text = "";

	constructor() {
		super({
			write: (chunk: Buffer, _enc: string, cb: () => void) => {
				this.text += chunk.toString();
				cb();
			},
		});
	}
}

describe("CLI adapter", () => {
	let app: App;
	let client: ZturnClient;
	let dir: string;

	before(async () => {
		app = new App({
			env: "test",
			storyDir: "./stories",
			databasePath: ":memory:",
			gameRegistry: fakeRegistry(),
		});
		await app.start(0, "127.0.0.1");
		client = new ZturnClient(`http://127.0.0.1:${app.getPort()}`);
		dir = mkdtempSync(join(tmpdir(), "zturn-cli-"));
	});

	after(async () => {
		await app.stop();
		rmSync(dir, { recursive: true, force: true });
	});

	// Runs one command with the given stdin lines and captures the output.
	async function run(
		argv: string[],
		lines: string[] = [],
	): Promise<{ code: number; out: string; err: string }> {
		const out = new Capture();
		const err = new Capture();
		const stdin = lines.length
			? Readable.from(lines.map((l) => `${l}\n`))
			: new PassThrough();
		if (!lines.length) {
			(stdin as PassThrough).end();
		}
		const cli = new Cli(client, { stdin, stdout: out, stderr: err });
		const code = await cli.run(argv);
		return { code, out: out.text, err: err.text };
	}

	it("parses options and positionals", () => {
		const args = parseArgs([
			"play",
			"zork1",
			"--seed",
			"7",
			"--play",
			"--url",
			"http://x",
		]);
		expect(args.command).to.equal("play");
		expect(args.positional).to.deep.equal(["zork1"]);
		expect(args.options.get("seed")).to.equal("7");
		expect(args.options.get("play")).to.equal(true);
		expect(args.options.get("url")).to.equal("http://x");
	});

	it("prints usage for no command and errors for an unknown one", async () => {
		expect((await run([])).code).to.equal(0);
		const bad = await run(["dance"]);
		expect(bad.code).to.equal(2);
		expect(bad.out).to.include("Usage:");
	});

	it("lists games", async () => {
		const { code, out } = await run(["games"]);
		expect(code).to.equal(0);
		expect(out).to.include("fake");
		expect(out).to.include("Fake Game");
	});

	it("plays a session from stdin and prints a resume command on EOF", async () => {
		const { code, out } = await run(
			["play", "fake", "--seed", "42"],
			["look", "north"],
		);
		expect(code).to.equal(0);
		expect(out).to.include("seed 42");
		expect(out).to.include("Welcome (seed 42)");
		expect(out).to.include("You look. (move 1");
		expect(out).to.include("You north. (move 2");
		expect(out).to.match(/Nowhere\s+Score: 10\s+Moves: 2/);
		expect(out).to.match(/Resume with: zturn play --session \S+ --token \S+/);
	});

	it("resumes a session, and stops when the game ends", async () => {
		const first = await run(["play", "fake"], ["look"]);
		const [, id, token] = /--session (\S+) --token (\S+)/.exec(
			first.out,
		) as RegExpExecArray;
		const second = await run(
			["play", "--session", id, "--token", token],
			["quit", "ignored"],
		);
		expect(second.code).to.equal(0);
		expect(second.out).to.include("Resuming fake at turn 1");
		expect(second.out).to.include("Goodbye.");
		expect(second.out).to.include("The game has ended.");
		expect(second.out).to.not.include("ignored");
	});

	it("exports a replay file and imports it into an identical new session", async () => {
		const played = await run(
			["play", "fake", "--seed", "99"],
			["look", "north", "east"],
		);
		const [, id, token] = /--session (\S+) --token (\S+)/.exec(
			played.out,
		) as RegExpExecArray;

		const exported = await run(["export", "--session", id, "--token", token]);
		expect(exported.code).to.equal(0);
		const replay = JSON.parse(exported.out);
		expect(replay).to.deep.equal({
			gameId: "fake",
			seed: 99,
			inputs: ["look", "north", "east"],
		});

		const file = join(dir, "replay.json");
		writeFileSync(file, exported.out);
		const imported = await run(["import", file]);
		expect(imported.code).to.equal(0);
		expect(imported.out).to.include("(seed 99) at turn 3");
		const [, newId, newToken] = /--session (\S+) --token (\S+)/.exec(
			imported.out,
		) as RegExpExecArray;
		expect(newId).to.not.equal(id);
		const original = await client.getTranscript({ id, token });
		const copy = await client.getTranscript({ id: newId, token: newToken });
		expect(copy).to.deep.equal(original);
	});

	it("reports a turn conflict and carries on at the right turn", async () => {
		const created = await client.createSession("fake");
		const creds = { id: created.session.id, token: created.token };
		// Someone else plays between our turns.
		await client.playTurn(creds, "look");
		const { code, out } = await run(
			["play", "--session", creds.id, "--token", creds.token],
			["north"],
		);
		expect(code).to.equal(0);
		expect(out).to.include("Resuming fake at turn 1");
		expect(out).to.include("You north. (move 2");
	});

	it("reports API errors with their code", async () => {
		const { code, err } = await run(["play", "nope"]);
		expect(code).to.equal(1);
		expect(err).to.include("404 game_not_found");
		const bad = await run(["import", join(dir, "missing.json")]);
		expect(bad.code).to.equal(1);
		expect(bad.err).to.include("Error");
	});
});
