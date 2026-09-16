import { type IEngine, type StoryInfo } from "../engine/index.js";

export interface IGameSummary {
	id: string;
	title: string;
	story: StoryInfo;
}

export interface IGame extends IGameSummary {
	engine: IEngine;
}

export interface IGameRegistry {
	list: () => IGameSummary[];
	get: (gameId: string) => IGame | null;
}

export interface ILoadedStory {
	id: string;
	title: string;
	data: Uint8Array;
}

export interface ISkippedFile {
	file: string;
	reason: string;
}

export interface IScanResult {
	stories: ILoadedStory[];
	skipped: ISkippedFile[];
}
