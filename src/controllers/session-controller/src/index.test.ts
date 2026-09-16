import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { SessionController } from "./index.js";
import { ERRORS } from "../types.js";
import { ControllerError } from "../../../libs/controller-error/index.js";
import { FakeEngine, type IEngine } from "../../../libs/engine/index.js";
import { type IGameRegistry } from "../../../libs/game-registry/index.js";
import { SnapshotCache } from "../../../libs/snapshot-cache/index.js";
import { TokenService } from "../../../libs/token/index.js";
import {
	MemorySessionDatastore,
	SessionValidator,
} from "../../../models/sessions/index.js";

// A registry with one fake game, plus a counter so tests can see when the
// controller replays from turn zero instead of using the cache.
function fakeRegistry(): IGameRegistry & { boots: number } {
	const engine: IEngine = new FakeEngine();
	const registry = {
		boots: 0,
		list: () => [{ id: "fake", title: "Fake", story: engine.getStoryInfo() }],
		get: (id: string) =>
			id === "fake"
				? {
						id,
						title: "Fake",
						story: engine.getStoryInfo(),
						engine: {
							getStoryInfo: () => engine.getStoryInfo(),
							boot: (seed: number) => {
								registry.boots++;
								return engine.boot(seed);
							},
							step: (state: Uint8Array, input: string) =>
								engine.step(state, input),
						},
					}
				: null,
	};
	return registry;
}

async function expectError(
	promise: Promise<unknown>,
	code: ERRORS,
): Promise<ControllerError> {
	try {
		await promise;
	} catch (error) {
		expect(error).to.be.instanceOf(ControllerError);
		expect((error as ControllerError).code).to.equal(code);
		return error as ControllerError;
	}
	throw new Error(`expected ${code} to be thrown`);
}

describe("SessionController", () => {
	let store: MemorySessionDatastore;
	let registry: ReturnType<typeof fakeRegistry>;
	let controller: SessionController;

	function makeController(): SessionController {
		return new SessionController(
			store,
			new SessionValidator(),
			registry,
			new TokenService(),
			new SnapshotCache(),
		);
	}

	beforeEach(() => {
		store = new MemorySessionDatastore();
		registry = fakeRegistry();
		controller = makeController();
	});

	it("creates a session at turn 0 with a token and the intro", async () => {
		const created = await controller.createSession("fake");
		expect(created.session.turn).to.equal(0);
		expect(created.session.gameId).to.equal("fake");
		expect(created.session.awaiting).to.equal("line");
		expect(created.token).to.have.length.greaterThan(20);
		expect(created.out.text).to.match(/^Welcome/);
	});

	it("rejects unknown and malformed game ids", async () => {
		await expectError(controller.createSession("zork9"), ERRORS.game_not_found);
		await expectError(controller.createSession("../x"), ERRORS.invalid_game_id);
	});

	it("authorizes only the session's own token", async () => {
		const created = await controller.createSession("fake");
		await controller.authorize(created.session.id, created.token);
		await expectError(
			controller.authorize(created.session.id, "wrong"),
			ERRORS.unauthorized,
		);
		await expectError(
			controller.authorize(created.session.id, null),
			ERRORS.unauthorized,
		);
		await expectError(
			controller.authorize("missing", created.token),
			ERRORS.session_not_found,
		);
	});

	it("plays turns in order and reports the new turn number", async () => {
		const { session } = await controller.createSession("fake");
		const first = await controller.playTurn(session.id, { input: "look" });
		expect(first.turn).to.equal(1);
		expect(first.out.text).to.include("You look.");
		const second = await controller.playTurn(session.id, {
			input: "north",
			expectedTurn: 1,
		});
		expect(second.turn).to.equal(2);
		expect((await controller.getSession(session.id)).turn).to.equal(2);
	});

	it("returns a conflict carrying the current turn when expectedTurn is stale", async () => {
		const { session } = await controller.createSession("fake");
		await controller.playTurn(session.id, { input: "look" });
		const error = await expectError(
			controller.playTurn(session.id, { input: "north", expectedTurn: 0 }),
			ERRORS.turn_conflict,
		);
		expect(error.data?.turn).to.equal(1);
		expect((error.data?.out as { text: string }).text).to.include("You look.");
		expect((await controller.getSession(session.id)).turn).to.equal(1);
	});

	it("replays a repeated idempotency key without advancing the game", async () => {
		const { session } = await controller.createSession("fake");
		const first = await controller.playTurn(session.id, {
			input: "look",
			idempotencyKey: "evt-1",
		});
		const again = await controller.playTurn(session.id, {
			input: "something else",
			idempotencyKey: "evt-1",
		});
		expect(again).to.deep.equal(first);
		expect((await controller.getSession(session.id)).turn).to.equal(1);
	});

	it("rebuilds state from the input log when the cache is cold", async () => {
		const { session } = await controller.createSession("fake");
		await controller.playTurn(session.id, { input: "look" });
		await controller.playTurn(session.id, { input: "north" });
		const bootsBefore = registry.boots;

		const cold = makeController();
		const reply = await cold.playTurn(session.id, { input: "east" });
		expect(reply.turn).to.equal(3);
		expect(reply.out.text).to.include("move 3");
		expect(registry.boots).to.equal(bootsBefore + 1);

		// Warm now: another turn must not boot again.
		await cold.playTurn(session.id, { input: "west" });
		expect(registry.boots).to.equal(bootsBefore + 1);
	});

	it("rewinds, then continues from the earlier turn", async () => {
		const { session } = await controller.createSession("fake");
		await controller.playTurn(session.id, { input: "look" });
		await controller.playTurn(session.id, { input: "north" });
		const rewound = await controller.rewind(session.id, 1);
		expect(rewound.turn).to.equal(1);
		const next = await controller.playTurn(session.id, { input: "south" });
		expect(next.turn).to.equal(2);
		expect(next.out.text).to.include("move 2");
		expect(
			(await controller.getTranscript(session.id)).map((t) => t.input),
		).to.deep.equal([null, "look", "south"]);
		await expectError(controller.rewind(session.id, 5), ERRORS.invalid_turn);
		expect((await controller.rewind(session.id, 2)).turn).to.equal(2);
	});

	it("refuses turns after the game has ended", async () => {
		const { session } = await controller.createSession("fake");
		const last = await controller.playTurn(session.id, { input: "quit" });
		expect(last.out.awaiting).to.equal("none");
		expect((await controller.getSession(session.id)).status).to.equal(null);
		await expectError(
			controller.playTurn(session.id, { input: "look" }),
			ERRORS.game_over,
		);
	});

	it("validates input, turn numbers and keys", async () => {
		const { session } = await controller.createSession("fake");
		await expectError(
			controller.playTurn(session.id, { input: "x".repeat(300) }),
			ERRORS.invalid_input,
		);
		await expectError(
			controller.playTurn(session.id, { input: "look", expectedTurn: -1 }),
			ERRORS.invalid_turn,
		);
		await expectError(
			controller.playTurn(session.id, {
				input: "look",
				idempotencyKey: "has space",
			}),
			ERRORS.invalid_idempotency_key,
		);
		await expectError(
			controller.getSession("not/valid"),
			ERRORS.invalid_session_id,
		);
	});

	it("produces a full transcript", async () => {
		const { session } = await controller.createSession("fake");
		await controller.playTurn(session.id, { input: "look" });
		const transcript = await controller.getTranscript(session.id);
		expect(transcript).to.have.length(2);
		expect(transcript[0].input).to.equal(null);
		expect(transcript[1].input).to.equal("look");
		expect(transcript[1].out.status?.moves).to.equal(1);
	});
});
