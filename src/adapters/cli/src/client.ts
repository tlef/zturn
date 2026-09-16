import { randomUUID } from "node:crypto";
import {
	type ICreatedSession,
	type IGameSummary,
	type ISessionCredentials,
	type ISessionSummary,
	type ITranscriptEntry,
	type ITurnReply,
	type IZturnClient,
} from "../types.js";

// Any non-2xx response. The body's error code and, for a 409, the current
// turn are kept so the caller can show what happened.
export class ApiError extends Error {
	public readonly status: number;
	public readonly code: string;
	public readonly body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		const code = typeof body.error === "string" ? body.error : "unknown";
		super(`${status} ${code}`);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

export class ZturnClient implements IZturnClient {
	private readonly baseUrl: string;

	constructor(baseUrl: string) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	async listGames(): Promise<IGameSummary[]> {
		const body = await this.request<{ games: IGameSummary[] }>("GET", "/games");
		return body.games;
	}

	async createSession(gameId: string, seed?: number): Promise<ICreatedSession> {
		return this.request("POST", "/sessions", undefined, { gameId, seed });
	}

	async getSession(creds: ISessionCredentials): Promise<ISessionSummary> {
		return this.request("GET", `/sessions/${creds.id}`, creds.token);
	}

	// Every turn carries a fresh idempotency key so a retried request after a
	// network failure can never play the same move twice.
	async playTurn(
		creds: ISessionCredentials,
		input: string,
		expectedTurn?: number,
	): Promise<ITurnReply> {
		return this.request("POST", `/sessions/${creds.id}/turns`, creds.token, {
			input,
			expectedTurn,
			idempotencyKey: randomUUID(),
		});
	}

	async getTranscript(creds: ISessionCredentials): Promise<ITranscriptEntry[]> {
		const body = await this.request<{ turns: ITranscriptEntry[] }>(
			"GET",
			`/sessions/${creds.id}/transcript`,
			creds.token,
		);
		return body.turns;
	}

	private async request<T>(
		method: string,
		path: string,
		token?: string,
		body?: object,
	): Promise<T> {
		const headers: Record<string, string> = { accept: "application/json" };
		if (token) {
			headers.authorization = `Bearer ${token}`;
		}
		if (body !== undefined) {
			headers["content-type"] = "application/json";
		}
		const response = await fetch(this.baseUrl + path, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		let parsed: unknown = {};
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = { error: "not_json", detail: text };
			}
		}
		if (!response.ok) {
			throw new ApiError(response.status, parsed as Record<string, unknown>);
		}
		return parsed as T;
	}
}
