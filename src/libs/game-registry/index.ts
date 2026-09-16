import {
	type IGame,
	type IGameRegistry,
	type IGameSummary,
	type ILoadedStory,
	type IScanResult,
	type ISkippedFile,
} from "./types.js";
import { GameRegistry, scanStoryDirectory } from "./src/index.js";

export type {
	IGame,
	IGameRegistry,
	IGameSummary,
	ILoadedStory,
	IScanResult,
	ISkippedFile,
};
export { GameRegistry, scanStoryDirectory };
