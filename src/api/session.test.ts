import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import supertest from "supertest";
import { App } from "../app.js";
import { FakeEngine } from "../libs/engine/index.js";
import { type IGameRegistry } from "../libs/game-registry/index.js";

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

describe("sessions API", () => {
	let app: App;
	let request: ReturnType<typeof supertest>;

	before(() => {
		app = new App({
			env: "test",
			storyDir: "./stories",
			databasePath: ":memory:",
			gameRegistry: fakeRegistry(),
		});
		request = supertest(app.getCallback());
	});

	after(async () => {
		await app.stop();
	});

	async function createSession(): Promise<{ id: string; token: string }> {
		const res = await request
			.post("/sessions")
			.send({ gameId: "fake" })
			.expect(201);
		return { id: res.body.session.id, token: res.body.token };
	}

	it("lists games", async () => {
		const res = await request.get("/games").expect(200);
		expect(res.body.games).to.deep.equal([
			{
				id: "fake",
				title: "Fake Game",
				story: { zVersion: 3, release: 1, serial: "000000", checksum: 0 },
			},
		]);
	});

	it("creates a session and returns the intro as turn 0", async () => {
		const res = await request
			.post("/sessions")
			.send({ gameId: "fake" })
			.expect(201);
		expect(res.body.turn).to.equal(0);
		expect(res.body.token).to.be.a("string");
		expect(res.body.session.turn).to.equal(0);
		expect(res.body.out.text).to.match(/^Welcome/);
		expect(res.body.out.awaiting).to.equal("line");
	});

	it("rejects bad create requests with codes", async () => {
		const missing = await request.post("/sessions").send({}).expect(400);
		expect(missing.body.error).to.equal("invalid_request");
		const unknown = await request
			.post("/sessions")
			.send({ gameId: "nope" })
			.expect(404);
		expect(unknown.body.error).to.equal("game_not_found");
		const notJson = await request.post("/sessions").send([1]).expect(400);
		expect(notJson.body.error).to.equal("invalid_request");
	});

	it("requires the session's bearer token on every session route", async () => {
		const { id, token } = await createSession();
		const noAuth = await request.get(`/sessions/${id}`).expect(401);
		expect(noAuth.body.error).to.equal("unauthorized");
		await request
			.get(`/sessions/${id}`)
			.set("Authorization", "Bearer wrong")
			.expect(401);
		await request
			.post(`/sessions/${id}/turns`)
			.send({ input: "look" })
			.expect(401);
		await request
			.get(`/sessions/${id}`)
			.set("Authorization", `Bearer ${token}`)
			.expect(200);
		const missing = await request
			.get("/sessions/doesnotexist")
			.set("Authorization", `Bearer ${token}`)
			.expect(404);
		expect(missing.body.error).to.equal("session_not_found");
	});

	it("plays turns, reports conflicts, and honours idempotency keys", async () => {
		const { id, token } = await createSession();
		const auth = { authorization: `Bearer ${token}` };

		const first = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "look", expectedTurn: 0, idempotencyKey: "evt-1" })
			.expect(200);
		expect(first.body.turn).to.equal(1);
		expect(first.body.out.text).to.include("You look.");

		const stale = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "north", expectedTurn: 0 })
			.expect(409);
		expect(stale.body.error).to.equal("turn_conflict");
		expect(stale.body.turn).to.equal(1);
		expect(stale.body.out.text).to.include("You look.");

		const replay = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "north", idempotencyKey: "evt-1" })
			.expect(200);
		expect(replay.body).to.deep.equal(first.body);

		const status = await request.get(`/sessions/${id}`).set(auth).expect(200);
		expect(status.body.turn).to.equal(1);
		expect(status.body.status.moves).to.equal(1);
	});

	it("validates turn request shapes", async () => {
		const { id, token } = await createSession();
		const auth = { authorization: `Bearer ${token}` };
		const noInput = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ expectedTurn: 0 })
			.expect(400);
		expect(noInput.body.error).to.equal("invalid_request");
		const badTurn = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "look", expectedTurn: "zero" })
			.expect(400);
		expect(badTurn.body.error).to.equal("invalid_request");
		const tooLong = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "x".repeat(300) })
			.expect(400);
		expect(tooLong.body.error).to.equal("invalid_input");
	});

	it("serves the transcript and rewinds", async () => {
		const { id, token } = await createSession();
		const auth = { authorization: `Bearer ${token}` };
		for (const input of ["look", "north", "east"]) {
			await request
				.post(`/sessions/${id}/turns`)
				.set(auth)
				.send({ input })
				.expect(200);
		}
		const transcript = await request
			.get(`/sessions/${id}/transcript`)
			.set(auth)
			.expect(200);
		expect(
			transcript.body.turns.map((t: { input: string | null }) => t.input),
		).to.deep.equal([null, "look", "north", "east"]);

		const rewound = await request
			.post(`/sessions/${id}/rewind`)
			.set(auth)
			.send({ toTurn: 1 })
			.expect(200);
		expect(rewound.body.turn).to.equal(1);
		const tooFar = await request
			.post(`/sessions/${id}/rewind`)
			.set(auth)
			.send({ toTurn: 9 })
			.expect(400);
		expect(tooFar.body.error).to.equal("invalid_turn");
	});

	it("reports game over with 409 after the game ends", async () => {
		const { id, token } = await createSession();
		const auth = { authorization: `Bearer ${token}` };
		const last = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "quit" })
			.expect(200);
		expect(last.body.out.awaiting).to.equal("none");
		const after = await request
			.post(`/sessions/${id}/turns`)
			.set(auth)
			.send({ input: "look" })
			.expect(409);
		expect(after.body.error).to.equal("game_over");
	});
});
