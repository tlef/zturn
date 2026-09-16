import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { AppDatabase } from "../../../libs/database/index.js";
import { MemorySlackAppDatastore } from "./memory.js";
import { SqliteSlackAppDatastore } from "./sqlite.js";
import { type ISlackAppDatastore } from "../types.js";

const T0 = "2026-09-16T12:00:00.000Z";
const T1 = "2026-09-16T12:01:00.000Z";

function contract(
	name: string,
	make: () => { store: ISlackAppDatastore; close: () => void },
): void {
	describe(name, () => {
		let store: ISlackAppDatastore;
		let close: () => void;

		beforeEach(async () => {
			({ store, close } = make());
			await store.createBridge({
				id: "bridge-1",
				signingSecretSealed: null,
				createdAt: T0,
				activatedAt: null,
			});
		});

		afterEach(() => close());

		it("creates a pending bridge and activates it once", async () => {
			expect(await store.getBridge("bridge-1")).to.deep.equal({
				id: "bridge-1",
				signingSecretSealed: null,
				createdAt: T0,
				activatedAt: null,
			});
			expect(await store.activateBridge("bridge-1", "sealed", T1)).to.equal(
				true,
			);
			expect(await store.getBridge("bridge-1")).to.deep.equal({
				id: "bridge-1",
				signingSecretSealed: "sealed",
				createdAt: T0,
				activatedAt: T1,
			});
			expect(await store.activateBridge("nope", "sealed", T1)).to.equal(false);
			expect(await store.getBridge("nope")).to.equal(null);
		});

		it("maps a channel to a session and replaces it on a new game", async () => {
			expect(await store.getChannel("bridge-1", "C1")).to.equal(null);
			await store.setChannel({
				bridgeId: "bridge-1",
				channelId: "C1",
				sessionId: "s1",
				updatedAt: T0,
			});
			expect((await store.getChannel("bridge-1", "C1"))?.sessionId).to.equal(
				"s1",
			);
			await store.setChannel({
				bridgeId: "bridge-1",
				channelId: "C1",
				sessionId: "s2",
				updatedAt: T1,
			});
			expect(await store.getChannel("bridge-1", "C1")).to.deep.equal({
				bridgeId: "bridge-1",
				channelId: "C1",
				sessionId: "s2",
				updatedAt: T1,
			});
			expect(await store.getChannel("other", "C1")).to.equal(null);
		});
	});
}

describe("slack app datastores", () => {
	contract("MemorySlackAppDatastore", () => ({
		store: new MemorySlackAppDatastore(),
		close: () => {},
	}));
	contract("SqliteSlackAppDatastore", () => {
		const database = new AppDatabase(":memory:");
		return {
			store: new SqliteSlackAppDatastore(database),
			close: () => database.close(),
		};
	});
});
