import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameRegistry, scanStoryDirectory } from "./index.js";

// A header-only version 3 story is enough for the registry: the engine only
// parses the header until a game is actually booted.
function fakeStory(version: number, release: number): Uint8Array {
	const data = new Uint8Array(0x40);
	data[0] = version;
	data[2] = release >> 8;
	data[3] = release & 0xff;
	data.set(new TextEncoder().encode("240916"), 0x12);
	return data;
}

describe("game registry", () => {
	let dir: string;

	before(() => {
		dir = mkdtempSync(join(tmpdir(), "zturn-stories-"));
		writeFileSync(join(dir, "zork1.z3"), fakeStory(3, 88));
		writeFileSync(join(dir, "Custom.Z3"), fakeStory(3, 7));
		writeFileSync(join(dir, "modern.z3"), fakeStory(5, 1));
		writeFileSync(join(dir, "notes.txt"), "not a story");
	});

	after(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("loads version 3 stories, ignores other files, and reports bad ones", () => {
		const scan = scanStoryDirectory(dir);
		expect(scan.stories.map((s) => s.id)).to.deep.equal(["custom", "zork1"]);
		expect(scan.skipped).to.deep.equal([
			{ file: "modern.z3", reason: "unsupported_story" },
		]);
	});

	it("gives known stories a title and the rest their file name", () => {
		const registry = new GameRegistry(scanStoryDirectory(dir).stories);
		const titles = new Map(registry.list().map((g) => [g.id, g.title]));
		expect(titles.get("zork1")).to.equal(
			"Zork I: The Great Underground Empire",
		);
		expect(titles.get("custom")).to.equal("custom");
	});

	it("exposes the story header and an engine per game", () => {
		const registry = new GameRegistry(scanStoryDirectory(dir).stories);
		const game = registry.get("zork1");
		expect(game?.story.release).to.equal(88);
		expect(game?.story.serial).to.equal("240916");
		expect(game?.engine).to.not.equal(undefined);
		expect(registry.get("missing")).to.equal(null);
	});
});
