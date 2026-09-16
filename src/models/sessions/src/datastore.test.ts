import { describe, it, beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import { AppDatabase } from "../../../libs/database/index.js";
import { type TurnOutput } from "../../../libs/engine/index.js";
import { MemorySessionDatastore } from "./memory.js";
import { SqliteSessionDatastore } from "./sqlite.js";
import {
	type ISessionBase,
	type ISessionDatastore,
	type ITurnBase,
} from "../types.js";

const T0 = "2026-09-16T12:00:00.000Z";
const T1 = "2026-09-16T12:01:00.000Z";

const BOOT: TurnOutput = {
	text: "West of House",
	status: { location: "West of House", score: 0, moves: 0 },
	awaiting: "line",
};

function session(id = "s1"): ISessionBase {
	return {
		id,
		gameId: "zork1",
		seed: 42,
		tokenHash: "hash",
		version: 0,
		createdAt: T0,
		lastPlayedAt: T0,
	};
}

function turn(n: number, input: string, key: string | null = null): ITurnBase {
	return {
		turn: n,
		input,
		output: {
			text: `You ${input}.`,
			status: { location: "West of House", score: 0, moves: n },
			awaiting: "line",
		},
		idempotencyKey: key,
	};
}

// Both datastores must satisfy exactly the same contract.
function contract(
	name: string,
	make: () => { store: ISessionDatastore; close: () => void },
): void {
	describe(name, () => {
		let store: ISessionDatastore;
		let close: () => void;

		beforeEach(async () => {
			({ store, close } = make());
			await store.createSession(session(), BOOT);
		});

		afterEach(() => close());

		it("stores the session at version 0 with the boot output as turn 0", async () => {
			const found = await store.getSession("s1");
			expect(found).to.deep.equal(session());
			expect(await store.getTurns("s1")).to.deep.equal([
				{ turn: 0, input: null, output: BOOT, idempotencyKey: null },
			]);
			expect(await store.getSession("nope")).to.equal(null);
			expect(await store.getTurns("nope")).to.deep.equal([]);
		});

		it("commits a turn when the version matches and bumps it", async () => {
			expect(
				await store.commitTurn("s1", 0, turn(1, "look", "k1"), T1),
			).to.equal(true);
			const found = await store.getSession("s1");
			expect(found?.version).to.equal(1);
			expect(found?.lastPlayedAt).to.equal(T1);
			expect((await store.getTurns("s1")).map((t) => t.turn)).to.deep.equal([
				0, 1,
			]);
		});

		it("rejects a commit whose expected version is stale, writing nothing", async () => {
			await store.commitTurn("s1", 0, turn(1, "look"), T1);
			expect(await store.commitTurn("s1", 0, turn(1, "north"), T1)).to.equal(
				false,
			);
			expect(await store.commitTurn("s1", 5, turn(6, "north"), T1)).to.equal(
				false,
			);
			expect(await store.commitTurn("s1", 1, turn(3, "north"), T1)).to.equal(
				false,
			);
			const turns = await store.getTurns("s1");
			expect(turns).to.have.length(2);
			expect(turns[1].input).to.equal("look");
		});

		it("lets exactly one of two racing commits through", async () => {
			const results = await Promise.all([
				store.commitTurn("s1", 0, turn(1, "look", "a"), T1),
				store.commitTurn("s1", 0, turn(1, "north", "b"), T1),
			]);
			expect(results.filter(Boolean)).to.have.length(1);
			expect((await store.getSession("s1"))?.version).to.equal(1);
		});

		it("finds a turn by idempotency key", async () => {
			await store.commitTurn("s1", 0, turn(1, "look", "evt-1"), T1);
			const found = await store.getTurnByKey("s1", "evt-1");
			expect(found?.turn).to.equal(1);
			expect(found?.input).to.equal("look");
			expect(await store.getTurnByKey("s1", "evt-2")).to.equal(null);
			expect(await store.getTurnByKey("other", "evt-1")).to.equal(null);
		});

		it("rewinds by dropping later turns and lowering the version", async () => {
			await store.commitTurn("s1", 0, turn(1, "look"), T1);
			await store.commitTurn("s1", 1, turn(2, "north"), T1);
			await store.commitTurn("s1", 2, turn(3, "east"), T1);
			expect(await store.rewind("s1", 1, T1)).to.equal(true);
			expect((await store.getSession("s1"))?.version).to.equal(1);
			expect((await store.getTurns("s1")).map((t) => t.turn)).to.deep.equal([
				0, 1,
			]);
			expect(await store.commitTurn("s1", 1, turn(2, "west"), T1)).to.equal(
				true,
			);
		});

		it("refuses a rewind that is not backwards or targets an unknown session", async () => {
			await store.commitTurn("s1", 0, turn(1, "look"), T1);
			expect(await store.rewind("s1", 1, T1)).to.equal(false);
			expect(await store.rewind("s1", 4, T1)).to.equal(false);
			expect(await store.rewind("s1", -1, T1)).to.equal(false);
			expect(await store.rewind("nope", 0, T1)).to.equal(false);
			expect((await store.getSession("s1"))?.version).to.equal(1);
		});

		it("keeps sessions independent", async () => {
			await store.createSession(session("s2"), BOOT);
			await store.commitTurn("s1", 0, turn(1, "look", "shared-key"), T1);
			expect(
				await store.commitTurn("s2", 0, turn(1, "north", "shared-key"), T1),
			).to.equal(true);
			expect((await store.getSession("s2"))?.version).to.equal(1);
			expect((await store.getTurns("s1"))[1].input).to.equal("look");
		});
	});
}

describe("session datastores", () => {
	contract("MemorySessionDatastore", () => ({
		store: new MemorySessionDatastore(),
		close: () => {},
	}));

	contract("SqliteSessionDatastore", () => {
		const database = new AppDatabase(":memory:");
		return {
			store: new SqliteSessionDatastore(database),
			close: () => database.close(),
		};
	});
});
