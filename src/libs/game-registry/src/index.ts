import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { ERRORS as ENGINE_ERRORS, ZvmEngine } from "../../engine/index.js";
import {
	type IGame,
	type IGameRegistry,
	type IGameSummary,
	type ILoadedStory,
	type IScanResult,
} from "../types.js";

const STORY_EXTENSION = ".z3";

// Titles for the story files this service is built around. Anything else
// in the directory is exposed under its file name.
const KNOWN_TITLES = new Map<string, string>([
	["zork1", "Zork I: The Great Underground Empire"],
	["zork2", "Zork II: The Wizard of Frobozz"],
	["zork3", "Zork III: The Dungeon Master"],
]);

// Reads every .z3 file in a directory. Files that are not version 3 stories
// are reported rather than thrown so one stray file cannot stop the server.
export function scanStoryDirectory(dir: string): IScanResult {
	const result: IScanResult = { stories: [], skipped: [] };
	for (const file of readdirSync(dir).sort()) {
		if (extname(file).toLowerCase() !== STORY_EXTENSION) {
			continue;
		}
		const id = basename(file, extname(file)).toLowerCase();
		const data = new Uint8Array(readFileSync(join(dir, file)));
		if (data.length < 0x40 || data[0] !== 3) {
			result.skipped.push({ file, reason: ENGINE_ERRORS.unsupported_story });
			continue;
		}
		result.stories.push({ id, title: KNOWN_TITLES.get(id) ?? id, data });
	}
	return result;
}

export class GameRegistry implements IGameRegistry {
	private readonly games = new Map<string, IGame>();

	constructor(stories: ILoadedStory[]) {
		for (const story of stories) {
			const engine = new ZvmEngine(story.data);
			this.games.set(story.id, {
				id: story.id,
				title: story.title,
				story: engine.getStoryInfo(),
				engine,
			});
		}
	}

	list(): IGameSummary[] {
		return [...this.games.values()].map(({ id, title, story }) => ({
			id,
			title,
			story,
		}));
	}

	get(gameId: string): IGame | null {
		return this.games.get(gameId) ?? null;
	}
}
