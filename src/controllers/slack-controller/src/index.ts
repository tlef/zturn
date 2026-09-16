import { ControllerError } from "../../../libs/controller-error/index.js";
import { type IGameRegistry } from "../../../libs/game-registry/index.js";
import { type ISecretBox } from "../../../libs/secret-box/index.js";
import { type ISlackSigner } from "../../../libs/slack-signing/index.js";
import { type ITokenService } from "../../../libs/token/index.js";
import {
	type ISlackAppDatastore,
	type ISlackAppValidator,
	type ISlackBridgeBase,
} from "../../../models/slack-apps/index.js";
import {
	ERRORS as SESSION_ERRORS,
	type ISessionController,
	type ITurnReply,
} from "../../session-controller/index.js";
import { type TurnOutput } from "../../../libs/engine/index.js";
import {
	ERRORS,
	type ISlackBridge,
	type ISlackCommand,
	type ISlackController,
	type ISlackReply,
} from "../types.js";

const HELP = [
	"*How to play*",
	"`/zork new` starts a game in this channel (`/zork new zork2` for another game, add a number for a seed).",
	"`/zork <command>` plays a turn, for example `/zork open mailbox`.",
	"`/zork undo` takes back the last turn. `/zork status` shows where you are. `/zork games` lists what is available.",
	"Everyone in the channel shares one game and sees every move.",
].join("\n");

// Slack's slash-command bridge. Each bridge is one visitor's own Slack app;
// each channel on it plays one session. Commands other than the built-in
// verbs are sent to the game as typed.
export class SlackController implements ISlackController {
	protected slackAppDatastore: ISlackAppDatastore;
	protected slackAppValidator: ISlackAppValidator;
	protected sessionController: ISessionController;
	protected gameRegistry: IGameRegistry;
	protected secretBox: ISecretBox;
	protected signer: ISlackSigner;
	protected tokenService: ITokenService;

	constructor(
		slackAppDatastore: ISlackAppDatastore,
		slackAppValidator: ISlackAppValidator,
		sessionController: ISessionController,
		gameRegistry: IGameRegistry,
		secretBox: ISecretBox,
		signer: ISlackSigner,
		tokenService: ITokenService,
	) {
		this.slackAppDatastore = slackAppDatastore;
		this.slackAppValidator = slackAppValidator;
		this.sessionController = sessionController;
		this.gameRegistry = gameRegistry;
		this.secretBox = secretBox;
		this.signer = signer;
		this.tokenService = tokenService;
	}

	async createBridge(): Promise<ISlackBridge> {
		const bridge: ISlackBridgeBase = {
			id: this.tokenService.generateSessionId(),
			signingSecretSealed: null,
			createdAt: new Date().toISOString(),
			activatedAt: null,
		};
		await this.slackAppDatastore.createBridge(bridge);
		return { bridgeId: bridge.id, activated: false };
	}

	async getBridge(bridgeId: string): Promise<ISlackBridge> {
		const bridge = await this.loadBridge(bridgeId);
		return {
			bridgeId: bridge.id,
			activated: bridge.signingSecretSealed !== null,
		};
	}

	async activateBridge(bridgeId: string, signingSecret: string): Promise<void> {
		if (!this.slackAppValidator.isValidSigningSecret(signingSecret)) {
			throw new ControllerError(ERRORS.invalid_signing_secret);
		}
		await this.loadBridge(bridgeId);
		await this.slackAppDatastore.activateBridge(
			bridgeId,
			this.secretBox.encrypt(signingSecret),
			new Date().toISOString(),
		);
	}

	async verifyRequest(
		bridgeId: string,
		timestamp: string,
		signature: string,
		rawBody: string,
	): Promise<void> {
		const bridge = await this.loadBridge(bridgeId);
		if (bridge.signingSecretSealed === null) {
			throw new ControllerError(ERRORS.bridge_not_activated);
		}
		const secret = this.secretBox.decrypt(bridge.signingSecretSealed);
		if (!this.signer.verify(secret, timestamp, signature, rawBody)) {
			throw new ControllerError(ERRORS.bad_signature);
		}
	}

	async handleCommand(
		bridgeId: string,
		command: ISlackCommand,
	): Promise<ISlackReply> {
		await this.loadBridge(bridgeId);
		if (!this.slackAppValidator.isValidChannelId(command.channelId)) {
			throw new ControllerError(ERRORS.invalid_channel_id);
		}
		const text = command.text.trim();
		const [verb, ...rest] = text.split(/\s+/);
		switch (verb.toLowerCase()) {
			case "":
			case "help":
				return ephemeral(HELP);
			case "games":
				return ephemeral(this.listGames());
			case "new":
				return this.newGame(bridgeId, command, rest);
			case "undo":
				return this.undo(bridgeId, command);
			case "status":
				return this.status(bridgeId, command);
			default:
				return this.play(bridgeId, command, text);
		}
	}

	private listGames(): string {
		const games = this.gameRegistry.list();
		if (games.length === 0) {
			return "This server has no games loaded.";
		}
		return games.map((g) => `\`${g.id}\`  ${g.title}`).join("\n");
	}

	private async newGame(
		bridgeId: string,
		command: ISlackCommand,
		args: string[],
	): Promise<ISlackReply> {
		const games = this.gameRegistry.list();
		if (games.length === 0) {
			return ephemeral("This server has no games loaded.");
		}
		let gameId = games[0].id;
		let seed: number | undefined;
		for (const arg of args) {
			if (/^\d+$/.test(arg)) {
				seed = Number(arg);
			} else {
				gameId = arg.toLowerCase();
			}
		}
		let created;
		try {
			created = await this.sessionController.createSession(gameId, seed);
		} catch (error) {
			return ephemeral(describeSessionError(error, gameId));
		}
		await this.slackAppDatastore.setChannel({
			bridgeId,
			channelId: command.channelId,
			sessionId: created.session.id,
			updatedAt: new Date().toISOString(),
		});
		const who = command.userName ? `@${command.userName}` : "Someone";
		return inChannel(
			`${who} started *${titleOf(games, gameId)}*.\n${formatTurn(null, created.out)}`,
		);
	}

	private async play(
		bridgeId: string,
		command: ISlackCommand,
		input: string,
	): Promise<ISlackReply> {
		const sessionId = await this.sessionFor(bridgeId, command.channelId);
		if (!sessionId) {
			return ephemeral(
				"No game is running in this channel. Start one with `/zork new`.",
			);
		}
		let reply: ITurnReply;
		try {
			reply = await this.sessionController.playTurn(sessionId, {
				input,
				idempotencyKey: `slack:${command.triggerId}`,
			});
		} catch (error) {
			return ephemeral(describeSessionError(error));
		}
		return inChannel(formatTurn(input, reply.out, command.userName));
	}

	private async undo(
		bridgeId: string,
		command: ISlackCommand,
	): Promise<ISlackReply> {
		const sessionId = await this.sessionFor(bridgeId, command.channelId);
		if (!sessionId) {
			return ephemeral(
				"No game is running in this channel. Start one with `/zork new`.",
			);
		}
		try {
			const session = await this.sessionController.getSession(sessionId);
			if (session.turn === 0) {
				return ephemeral("Nothing to undo yet.");
			}
			await this.sessionController.rewind(sessionId, session.turn - 1);
			const transcript = await this.sessionController.getTranscript(sessionId);
			const last = transcript[transcript.length - 1];
			const who = command.userName ? `@${command.userName}` : "Someone";
			return inChannel(
				`${who} undid the last turn.\n${formatTurn(last.input, last.out)}`,
			);
		} catch (error) {
			return ephemeral(describeSessionError(error));
		}
	}

	private async status(
		bridgeId: string,
		command: ISlackCommand,
	): Promise<ISlackReply> {
		const sessionId = await this.sessionFor(bridgeId, command.channelId);
		if (!sessionId) {
			return ephemeral(
				"No game is running in this channel. Start one with `/zork new`.",
			);
		}
		try {
			const session = await this.sessionController.getSession(sessionId);
			const games = this.gameRegistry.list();
			const status = session.status
				? `${statusLine(session.status)}`
				: "The game has ended.";
			return ephemeral(
				`*${titleOf(games, session.gameId)}*, turn ${session.turn}, seed ${session.seed}.\n${status}`,
			);
		} catch (error) {
			return ephemeral(describeSessionError(error));
		}
	}

	private async sessionFor(
		bridgeId: string,
		channelId: string,
	): Promise<string | null> {
		const channel = await this.slackAppDatastore.getChannel(
			bridgeId,
			channelId,
		);
		return channel ? channel.sessionId : null;
	}

	private async loadBridge(bridgeId: string): Promise<ISlackBridgeBase> {
		if (!this.slackAppValidator.isValidBridgeId(bridgeId)) {
			throw new ControllerError(ERRORS.invalid_bridge_id);
		}
		const bridge = await this.slackAppDatastore.getBridge(bridgeId);
		if (!bridge) {
			throw new ControllerError(ERRORS.bridge_not_found);
		}
		return bridge;
	}
}

function inChannel(text: string): ISlackReply {
	return { visibility: "inChannel", text };
}

function ephemeral(text: string): ISlackReply {
	return { visibility: "ephemeral", text };
}

function titleOf(
	games: { id: string; title: string }[],
	gameId: string,
): string {
	return games.find((g) => g.id === gameId)?.title ?? gameId;
}

function statusLine(status: NonNullable<TurnOutput["status"]>): string {
	return `*${escapeMrkdwn(status.location)}*   Score: ${status.score}   Moves: ${status.moves}`;
}

// Status line as a header, then the command and the game's text in a code
// block so nothing in it is taken for Slack formatting.
function formatTurn(
	input: string | null,
	out: TurnOutput,
	userName?: string | null,
): string {
	const lines: string[] = [];
	if (out.status) {
		lines.push(statusLine(out.status));
	}
	const body: string[] = [];
	if (input !== null) {
		body.push(`> ${input}${userName ? `   (${userName})` : ""}`);
	}
	body.push(out.text);
	lines.push("```\n" + escapeMrkdwn(body.join("\n")) + "\n```");
	if (out.awaiting === "none") {
		lines.push("_The game has ended. `/zork new` starts another._");
	}
	return lines.join("\n");
}

function escapeMrkdwn(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function describeSessionError(error: unknown, gameId?: string): string {
	const code = error instanceof ControllerError ? error.code : null;
	switch (code) {
		case SESSION_ERRORS.game_not_found:
		case SESSION_ERRORS.invalid_game_id:
			return `There is no game called \`${gameId ?? "?"}\`. Try \`/zork games\`.`;
		case SESSION_ERRORS.invalid_seed:
			return "The seed must be a whole number from 1 to 4294967295.";
		case SESSION_ERRORS.session_not_found:
			return "This channel's game no longer exists. Start another with `/zork new`.";
		case SESSION_ERRORS.game_over:
			return "The game has ended. `/zork new` starts another.";
		case SESSION_ERRORS.invalid_input:
			return "That command is too long for the game.";
		default:
			throw error;
	}
}
