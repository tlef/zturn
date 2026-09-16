import { describe, it, beforeEach } from "mocha";
import { expect } from "chai";
import { SlackController } from "./index.js";
import { ERRORS } from "../types.js";
import { ControllerError } from "../../../libs/controller-error/index.js";
import { FakeEngine } from "../../../libs/engine/index.js";
import { type IGameRegistry } from "../../../libs/game-registry/index.js";
import { SecretBox } from "../../../libs/secret-box/index.js";
import { SlackSigner } from "../../../libs/slack-signing/index.js";
import { SnapshotCache } from "../../../libs/snapshot-cache/index.js";
import { TokenService } from "../../../libs/token/index.js";
import {
	MemorySessionDatastore,
	SessionValidator,
} from "../../../models/sessions/index.js";
import {
	MemorySlackAppDatastore,
	SlackAppValidator,
} from "../../../models/slack-apps/index.js";
import { SessionController } from "../../session-controller/index.js";

const KEY = "ab".repeat(32);
const SECRET = "0123456789abcdef0123456789abcdef";

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

function command(
	text: string,
	channelId = "C123",
	triggerId = `${Math.random()}`,
) {
	return { channelId, text, triggerId, userName: "tim" };
}

async function expectError(
	promise: Promise<unknown>,
	code: string,
): Promise<void> {
	try {
		await promise;
	} catch (error) {
		expect(error).to.be.instanceOf(ControllerError);
		expect((error as ControllerError).code).to.equal(code);
		return;
	}
	throw new Error(`expected ${code}`);
}

describe("SlackController", () => {
	let controller: SlackController;
	let signer: SlackSigner;

	beforeEach(() => {
		const registry = fakeRegistry();
		const sessions = new SessionController(
			new MemorySessionDatastore(),
			new SessionValidator(),
			registry,
			new TokenService(),
			new SnapshotCache(),
		);
		signer = new SlackSigner();
		controller = new SlackController(
			new MemorySlackAppDatastore(),
			new SlackAppValidator(),
			sessions,
			registry,
			new SecretBox(KEY),
			signer,
			new TokenService(),
		);
	});

	it("creates a pending bridge, activates it, and then verifies signed requests", async () => {
		const { bridgeId, activated } = await controller.createBridge();
		expect(activated).to.equal(false);
		const ts = String(Math.floor(Date.now() / 1000));
		const body = "text=look";
		const signature = signer.sign(SECRET, ts, body);

		await expectError(
			controller.verifyRequest(bridgeId, ts, signature, body),
			ERRORS.bridge_not_activated,
		);
		await expectError(
			controller.activateBridge(bridgeId, "nope"),
			ERRORS.invalid_signing_secret,
		);
		await controller.activateBridge(bridgeId, SECRET);
		expect((await controller.getBridge(bridgeId)).activated).to.equal(true);

		await controller.verifyRequest(bridgeId, ts, signature, body);
		await expectError(
			controller.verifyRequest(bridgeId, ts, signature, "text=steal"),
			ERRORS.bad_signature,
		);
		await expectError(
			controller.verifyRequest("missingbridge", ts, signature, body),
			ERRORS.bridge_not_found,
		);
		await expectError(
			controller.verifyRequest("!", ts, signature, body),
			ERRORS.invalid_bridge_id,
		);
	});

	it("explains itself with help and games", async () => {
		const { bridgeId } = await controller.createBridge();
		const help = await controller.handleCommand(bridgeId, command(""));
		expect(help.visibility).to.equal("ephemeral");
		expect(help.text).to.include("/zork new");
		const games = await controller.handleCommand(bridgeId, command("games"));
		expect(games.text).to.include("Fake Game");
	});

	it("asks for a game before playing, then plays turns in the channel", async () => {
		const { bridgeId } = await controller.createBridge();
		const nothing = await controller.handleCommand(bridgeId, command("look"));
		expect(nothing.visibility).to.equal("ephemeral");
		expect(nothing.text).to.include("/zork new");

		const started = await controller.handleCommand(bridgeId, command("new"));
		expect(started.visibility).to.equal("inChannel");
		expect(started.text).to.include("@tim started *Fake Game*");
		expect(started.text).to.include("Welcome");

		const turn = await controller.handleCommand(
			bridgeId,
			command("open mailbox"),
		);
		expect(turn.visibility).to.equal("inChannel");
		expect(turn.text).to.include("*Nowhere*   Score: 5   Moves: 1");
		expect(turn.text).to.include("&gt; open mailbox   (tim)");
		expect(turn.text).to.include("You open mailbox.");
	});

	it("keeps channels separate and lets new replace a game", async () => {
		const { bridgeId } = await controller.createBridge();
		await controller.handleCommand(bridgeId, command("new", "C1"));
		await controller.handleCommand(bridgeId, command("look", "C1"));
		const other = await controller.handleCommand(
			bridgeId,
			command("look", "C2"),
		);
		expect(other.visibility).to.equal("ephemeral");
		const status1 = await controller.handleCommand(
			bridgeId,
			command("status", "C1"),
		);
		expect(status1.text).to.include("turn 1");
		await controller.handleCommand(bridgeId, command("new fake 42", "C1"));
		const status2 = await controller.handleCommand(
			bridgeId,
			command("status", "C1"),
		);
		expect(status2.text).to.include("turn 0");
		expect(status2.text).to.include("seed 42");
	});

	it("treats a redelivered command as the same turn", async () => {
		const { bridgeId } = await controller.createBridge();
		await controller.handleCommand(bridgeId, command("new"));
		const first = await controller.handleCommand(
			bridgeId,
			command("look", "C123", "trig-1"),
		);
		const again = await controller.handleCommand(
			bridgeId,
			command("look", "C123", "trig-1"),
		);
		expect(again).to.deep.equal(first);
		const status = await controller.handleCommand(bridgeId, command("status"));
		expect(status.text).to.include("turn 1");
	});

	it("undoes, reports the end of the game, and explains bad game ids", async () => {
		const { bridgeId } = await controller.createBridge();
		const empty = await controller.handleCommand(bridgeId, command("undo"));
		expect(empty.visibility).to.equal("ephemeral");
		await controller.handleCommand(bridgeId, command("new"));
		expect(
			(await controller.handleCommand(bridgeId, command("undo"))).text,
		).to.include("Nothing to undo");
		await controller.handleCommand(bridgeId, command("look"));
		const undone = await controller.handleCommand(bridgeId, command("undo"));
		expect(undone.visibility).to.equal("inChannel");
		expect(undone.text).to.include("undid the last turn");
		expect(undone.text).to.include("Welcome");

		const over = await controller.handleCommand(bridgeId, command("quit"));
		expect(over.text).to.include("The game has ended");
		const after = await controller.handleCommand(bridgeId, command("look"));
		expect(after.visibility).to.equal("ephemeral");
		expect(after.text).to.include("/zork new");

		const bad = await controller.handleCommand(bridgeId, command("new zork9"));
		expect(bad.visibility).to.equal("ephemeral");
		expect(bad.text).to.include("zork9");
	});

	it("rejects malformed channel ids and unknown bridges", async () => {
		const { bridgeId } = await controller.createBridge();
		await expectError(
			controller.handleCommand(bridgeId, command("look", "c-bad")),
			ERRORS.invalid_channel_id,
		);
		await expectError(
			controller.handleCommand("missingbridge", command("look")),
			ERRORS.bridge_not_found,
		);
	});
});
