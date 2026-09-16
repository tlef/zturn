import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { type Readable, type Writable } from "node:stream";
import { ApiError } from "./client.js";
import {
	type IReplayFile,
	type ISessionCredentials,
	type ITurnOutput,
	type IZturnClient,
} from "../types.js";

const STATUS_WIDTH = 60;

export const USAGE = `zturn - play Z-machine games over the zturn API

Usage:
  zturn games                          list playable games
  zturn play <gameId> [--seed N]       start a new session and play
  zturn play --session ID --token T    resume a session
  zturn export --session ID --token T  print the session as a replay file
  zturn import <file> [--play]         create a session from a replay file

Options:
  --url URL   API base URL (default: $ZTURN_URL or http://127.0.0.1:3000)
`;

export interface ICliIo {
	stdin: Readable;
	stdout: Writable;
	stderr: Writable;
}

interface ParsedArgs {
	command: string | undefined;
	positional: string[];
	options: Map<string, string | true>;
}

// Plain argv handling: `--name value`, `--flag`, and positionals.
export function parseArgs(argv: string[]): ParsedArgs {
	const options = new Map<string, string | true>();
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const name = arg.slice(2);
			const next = argv[i + 1];
			if (next !== undefined && !next.startsWith("--")) {
				options.set(name, next);
				i++;
			} else {
				options.set(name, true);
			}
		} else {
			positional.push(arg);
		}
	}
	return { command: positional[0], positional: positional.slice(1), options };
}

export class Cli {
	protected client: IZturnClient;
	protected io: ICliIo;

	constructor(client: IZturnClient, io: ICliIo) {
		this.client = client;
		this.io = io;
	}

	// Returns the process exit code.
	async run(argv: string[]): Promise<number> {
		const args = parseArgs(argv);
		try {
			switch (args.command) {
				case "games":
					return await this.games();
				case "play":
					return await this.play(args);
				case "export":
					return await this.export(args);
				case "import":
					return await this.import(args);
				default:
					this.io.stdout.write(USAGE);
					return args.command === undefined || args.command === "help" ? 0 : 2;
			}
		} catch (error) {
			this.io.stderr.write(`${describeError(error)}\n`);
			return 1;
		}
	}

	private async games(): Promise<number> {
		const games = await this.client.listGames();
		if (games.length === 0) {
			this.io.stdout.write("No games are loaded on the server.\n");
			return 0;
		}
		for (const game of games) {
			this.io.stdout.write(
				`${game.id.padEnd(10)} ${game.title}  (release ${game.story.release}, serial ${game.story.serial})\n`,
			);
		}
		return 0;
	}

	private async play(args: ParsedArgs): Promise<number> {
		const creds = credentialsFrom(args);
		let expectedTurn: number;
		if (creds) {
			const session = await this.client.getSession(creds);
			expectedTurn = session.turn;
			const transcript = await this.client.getTranscript(creds);
			this.io.stdout.write(
				`Resuming ${session.gameId} at turn ${session.turn}.\n\n`,
			);
			this.render(transcript[transcript.length - 1].out);
			return this.loop(
				creds,
				expectedTurn,
				transcript[transcript.length - 1].out.awaiting,
			);
		}
		const gameId = args.positional[0];
		if (!gameId) {
			this.io.stderr.write(USAGE);
			return 2;
		}
		const created = await this.client.createSession(gameId, seedFrom(args));
		this.io.stdout.write(
			`Session ${created.session.id} (seed ${created.session.seed})\n\n`,
		);
		this.render(created.out);
		return this.loop(
			{ id: created.session.id, token: created.token },
			created.turn,
			created.out.awaiting,
		);
	}

	private async export(args: ParsedArgs): Promise<number> {
		const creds = credentialsFrom(args);
		if (!creds) {
			this.io.stderr.write(USAGE);
			return 2;
		}
		const session = await this.client.getSession(creds);
		if (typeof session.seed !== "number") {
			throw new Error("the server did not report a seed; it may need updating");
		}
		const transcript = await this.client.getTranscript(creds);
		const replay: IReplayFile = {
			gameId: session.gameId,
			seed: session.seed,
			inputs: transcript
				.filter((t) => t.input !== null)
				.map((t) => t.input as string),
		};
		this.io.stdout.write(`${JSON.stringify(replay, null, 2)}\n`);
		return 0;
	}

	// Creates a fresh session and replays the file's inputs through the API.
	private async import(args: ParsedArgs): Promise<number> {
		const file = args.positional[0];
		if (!file) {
			this.io.stderr.write(USAGE);
			return 2;
		}
		const replay = readReplayFile(file);
		const created = await this.client.createSession(replay.gameId, replay.seed);
		const creds = { id: created.session.id, token: created.token };
		let turn = created.turn;
		let out = created.out;
		for (const input of replay.inputs) {
			const reply = await this.client.playTurn(creds, input, turn);
			turn = reply.turn;
			out = reply.out;
		}
		this.io.stdout.write(
			`Session ${creds.id} (seed ${created.session.seed}) at turn ${turn}.\n`,
		);
		if (args.options.get("play")) {
			this.io.stdout.write("\n");
			this.render(out);
			return this.loop(creds, turn, out.awaiting);
		}
		this.io.stdout.write(
			`Resume with: zturn play --session ${creds.id} --token ${creds.token}\n`,
		);
		return 0;
	}

	// The readline loop. Each line is one turn. Ends on EOF or when the
	// game itself ends.
	private async loop(
		creds: ISessionCredentials,
		startTurn: number,
		awaiting: ITurnOutput["awaiting"],
	): Promise<number> {
		let expectedTurn = startTurn;
		if (awaiting === "none") {
			this.io.stdout.write("\nThe game has ended.\n");
			return 0;
		}
		const rl = createInterface({
			input: this.io.stdin,
			output: this.io.stdout,
			prompt: "> ",
			terminal: false,
		});
		rl.prompt();
		for await (const line of rl) {
			let reply;
			try {
				reply = await this.client.playTurn(creds, line, expectedTurn);
			} catch (error) {
				if (error instanceof ApiError && error.code === "turn_conflict") {
					expectedTurn = Number(error.body.turn);
					this.io.stdout.write(
						`\nSomeone else played; the session is at turn ${expectedTurn}.\n\n`,
					);
					this.render(error.body.out as ITurnOutput);
					rl.prompt();
					continue;
				}
				rl.close();
				throw error;
			}
			expectedTurn = reply.turn;
			this.io.stdout.write("\n");
			this.render(reply.out);
			if (reply.out.awaiting === "none") {
				this.io.stdout.write("\nThe game has ended.\n");
				rl.close();
				return 0;
			}
			rl.prompt();
		}
		this.io.stdout.write(
			`\nResume with: zturn play --session ${creds.id} --token ${creds.token}\n`,
		);
		return 0;
	}

	private render(out: ITurnOutput): void {
		if (out.status) {
			const right = `Score: ${out.status.score}  Moves: ${out.status.moves}`;
			const left = out.status.location.padEnd(STATUS_WIDTH - right.length);
			this.io.stdout.write(`${left}${right}\n`);
		}
		this.io.stdout.write(`${out.text}\n`);
	}
}

function credentialsFrom(args: ParsedArgs): ISessionCredentials | null {
	const id = args.options.get("session");
	const token = args.options.get("token");
	if (typeof id === "string" && typeof token === "string") {
		return { id, token };
	}
	return null;
}

function seedFrom(args: ParsedArgs): number | undefined {
	const seed = args.options.get("seed");
	return typeof seed === "string" ? Number(seed) : undefined;
}

function readReplayFile(file: string): IReplayFile {
	const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof (parsed as IReplayFile).gameId !== "string" ||
		typeof (parsed as IReplayFile).seed !== "number" ||
		!Array.isArray((parsed as IReplayFile).inputs)
	) {
		throw new Error(`${file} is not a replay file (need gameId, seed, inputs)`);
	}
	return parsed as IReplayFile;
}

function describeError(error: unknown): string {
	if (error instanceof ApiError) {
		const detail =
			typeof error.body.detail === "string" ? `: ${error.body.detail}` : "";
		return `Error ${error.status} ${error.code}${detail}`;
	}
	if (error instanceof Error && "cause" in error && error.cause) {
		return `Error: ${error.message} (${String(error.cause)})`;
	}
	return error instanceof Error ? `Error: ${error.message}` : String(error);
}
