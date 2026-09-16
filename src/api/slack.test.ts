/* eslint-disable @typescript-eslint/naming-convention */
// Slack's own form field names appear throughout.
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import supertest from "supertest";
import { App } from "../app.js";
import { FakeEngine } from "../libs/engine/index.js";
import { type IGameRegistry } from "../libs/game-registry/index.js";
import { SlackSigner } from "../libs/slack-signing/index.js";

const KEY = "cd".repeat(32);
const SECRET = "fedcba9876543210fedcba9876543210";

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

// A slash command the way Slack sends it: form-encoded and signed.
function slackCommand(
	request: ReturnType<typeof supertest>,
	bridgeId: string,
	fields: Record<string, string>,
	secret = SECRET,
	timestamp = String(Math.floor(Date.now() / 1000)),
) {
	const body = new URLSearchParams(fields).toString();
	const signature = new SlackSigner().sign(secret, timestamp, body);
	return request
		.post(`/slack/bridges/${bridgeId}/commands`)
		.set("content-type", "application/x-www-form-urlencoded")
		.set("x-slack-request-timestamp", timestamp)
		.set("x-slack-signature", signature)
		.send(body);
}

describe("Slack bridge API", () => {
	describe("when enabled", () => {
		let app: App;
		let request: ReturnType<typeof supertest>;

		before(() => {
			app = new App({
				env: "test",
				storyDir: "./stories",
				databasePath: ":memory:",
				slackSecretKey: KEY,
				gameRegistry: fakeRegistry(),
			});
			request = supertest(app.getCallback());
		});

		after(async () => {
			await app.stop();
		});

		async function activatedBridge(): Promise<string> {
			const created = await request.post("/slack/bridges").expect(201);
			await request
				.post(`/slack/bridges/${created.body.bridgeId}/activate`)
				.send({ signingSecret: SECRET })
				.expect(200);
			return created.body.bridgeId;
		}

		it("serves the setup page", async () => {
			const res = await request.get("/slack").expect(200);
			expect(res.type).to.equal("text/html");
			expect(res.text).to.include("Create bridge");
		});

		it("creates, reports and activates a bridge", async () => {
			const created = await request.post("/slack/bridges").expect(201);
			expect(created.body.activated).to.equal(false);
			const id = created.body.bridgeId;
			expect(
				(await request.get(`/slack/bridges/${id}`).expect(200)).body.activated,
			).to.equal(false);
			const bad = await request
				.post(`/slack/bridges/${id}/activate`)
				.send({ signingSecret: "nope" })
				.expect(400);
			expect(bad.body.error).to.equal("invalid_signing_secret");
			const shape = await request
				.post(`/slack/bridges/${id}/activate`)
				.send({})
				.expect(400);
			expect(shape.body.error).to.equal("invalid_request");
			const ok = await request
				.post(`/slack/bridges/${id}/activate`)
				.send({ signingSecret: SECRET })
				.expect(200);
			expect(ok.body.activated).to.equal(true);
			await request.get("/slack/bridges/doesnotexist").expect(404);
		});

		it("refuses commands that are unsigned, badly signed, stale, or to a pending bridge", async () => {
			const pending = (await request.post("/slack/bridges").expect(201)).body
				.bridgeId;
			const res = await slackCommand(request, pending, {
				text: "look",
				channel_id: "C1",
				trigger_id: "t1",
			}).expect(403);
			expect(res.body.error).to.equal("bridge_not_activated");

			const id = await activatedBridge();
			const wrong = await slackCommand(
				request,
				id,
				{ text: "look", channel_id: "C1", trigger_id: "t1" },
				"0".repeat(32),
			).expect(401);
			expect(wrong.body.error).to.equal("bad_signature");
			await slackCommand(
				request,
				id,
				{ text: "look", channel_id: "C1", trigger_id: "t1" },
				SECRET,
				"1000",
			).expect(401);
			await request
				.post(`/slack/bridges/${id}/commands`)
				.set("content-type", "application/x-www-form-urlencoded")
				.send("text=look&channel_id=C1")
				.expect(401);
		});

		it("plays a game through signed slash commands", async () => {
			const id = await activatedBridge();
			const help = await slackCommand(request, id, {
				text: "",
				channel_id: "C9",
				trigger_id: "t0",
				user_name: "tim",
			}).expect(200);
			expect(help.body.response_type).to.equal("ephemeral");

			const started = await slackCommand(request, id, {
				text: "new fake 5",
				channel_id: "C9",
				trigger_id: "t1",
				user_name: "tim",
			}).expect(200);
			expect(started.body.response_type).to.equal("in_channel");
			expect(started.body.text).to.include("Welcome (seed 5)");

			const turn = await slackCommand(request, id, {
				text: "open mailbox",
				channel_id: "C9",
				trigger_id: "t2",
				user_name: "tim",
			}).expect(200);
			expect(turn.body.response_type).to.equal("in_channel");
			expect(turn.body.text).to.include("You open mailbox.");
			expect(turn.body.text).to.include("Moves: 1");

			const status = await slackCommand(request, id, {
				text: "status",
				channel_id: "C9",
				trigger_id: "t3",
			}).expect(200);
			expect(status.body.text).to.include("turn 1");
		});
	});

	describe("when disabled", () => {
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

		it("still serves the page but has no bridge endpoints", async () => {
			await request.get("/slack").expect(200);
			await request.post("/slack/bridges").expect(404);
			await request.get("/slack/bridges/abc").expect(404);
		});
	});
});
