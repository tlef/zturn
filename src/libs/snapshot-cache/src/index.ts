import { type Snapshot } from "../../engine/index.js";
import { type ICachedSnapshot, type ISnapshotCache } from "../types.js";

const DEFAULT_MAX_ENTRIES = 1000;

// One entry per session, the latest version only, evicted least recently
// used. Map preserves insertion order, so re-inserting marks an entry fresh.
export class SnapshotCache implements ISnapshotCache {
	private readonly entries = new Map<string, ICachedSnapshot>();
	private readonly maxEntries: number;

	constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
		this.maxEntries = maxEntries;
	}

	get(sessionId: string, version: number): Snapshot | null {
		const entry = this.entries.get(sessionId);
		if (!entry || entry.version !== version) {
			return null;
		}
		this.entries.delete(sessionId);
		this.entries.set(sessionId, entry);
		return entry.state;
	}

	set(sessionId: string, version: number, state: Snapshot): void {
		this.entries.delete(sessionId);
		this.entries.set(sessionId, { version, state });
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
	}

	drop(sessionId: string): void {
		this.entries.delete(sessionId);
	}
}
