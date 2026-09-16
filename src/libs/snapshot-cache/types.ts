import { type Snapshot } from "../engine/index.js";

export interface ICachedSnapshot {
	version: number;
	state: Snapshot;
}

// Snapshots are a cache over the input log, never the source of truth. A
// miss costs a replay from turn zero, which takes milliseconds.
export interface ISnapshotCache {
	get: (sessionId: string, version: number) => Snapshot | null;
	set: (sessionId: string, version: number, state: Snapshot) => void;
	drop: (sessionId: string) => void;
}
