import { type Context } from "koa";
import type Router from "@koa/router";
import {
	type IPlayTurnRequest,
	type ISessionController,
} from "../controllers/session-controller/index.js";
import { badRequest } from "./api-errors.js";

const BEARER_PREFIX = /^Bearer\s+/i;

export class ApiSession {
	protected sessionController: ISessionController;

	constructor(sessionController: ISessionController) {
		this.sessionController = sessionController;
	}

	public registerRoutes(router: Router): void {
		/**
		 * @openapi
		 * components:
		 *   schemas:
		 *     TurnOutput:
		 *       type: object
		 *       properties:
		 *         text:
		 *           type: string
		 *           description: Main-window text produced by this turn, prompt removed.
		 *         status:
		 *           type: object
		 *           nullable: true
		 *           description: The status line, or null once the game has ended.
		 *           properties:
		 *             location:
		 *               type: string
		 *               example: West of House
		 *             score:
		 *               type: integer
		 *             moves:
		 *               type: integer
		 *         awaiting:
		 *           type: string
		 *           enum: [line, char, none]
		 *           description: What the game is blocked on next.
		 *     SessionSummary:
		 *       type: object
		 *       properties:
		 *         id:
		 *           type: string
		 *         gameId:
		 *           type: string
		 *         turn:
		 *           type: integer
		 *           description: Number of inputs played so far.
		 *         status:
		 *           type: object
		 *           nullable: true
		 *         awaiting:
		 *           type: string
		 *           enum: [line, char, none]
		 *         createdAt:
		 *           type: string
		 *           format: date-time
		 *         lastPlayedAt:
		 *           type: string
		 *           format: date-time
		 *     TurnReply:
		 *       type: object
		 *       properties:
		 *         turn:
		 *           type: integer
		 *         out:
		 *           $ref: '#/components/schemas/TurnOutput'
		 *     Error:
		 *       type: object
		 *       properties:
		 *         error:
		 *           type: string
		 *           description: A stable error code.
		 *
		 * /sessions:
		 *   post:
		 *     tags:
		 *       - Sessions
		 *     summary: Start a game
		 *     description: Creates a session and returns its bearer token. The token is the only credential for the session and is never shown again.
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [gameId]
		 *             properties:
		 *               gameId:
		 *                 type: string
		 *                 example: zork1
		 *     responses:
		 *       201:
		 *         description: The new session, its token, and the intro text as turn 0
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 session:
		 *                   $ref: '#/components/schemas/SessionSummary'
		 *                 token:
		 *                   type: string
		 *                 turn:
		 *                   type: integer
		 *                   example: 0
		 *                 out:
		 *                   $ref: '#/components/schemas/TurnOutput'
		 *       400:
		 *         description: Malformed request or game id
		 *       404:
		 *         description: No such game
		 */
		router.post("/sessions", this.createSession.bind(this));

		/**
		 * @openapi
		 * /sessions/{id}:
		 *   get:
		 *     tags:
		 *       - Sessions
		 *     summary: Current session state
		 *     security:
		 *       - sessionToken: []
		 *     parameters:
		 *       - $ref: '#/components/parameters/sessionId'
		 *     responses:
		 *       200:
		 *         description: Turn number, status line and what the game awaits
		 *         content:
		 *           application/json:
		 *             schema:
		 *               $ref: '#/components/schemas/SessionSummary'
		 *       401:
		 *         description: Missing or wrong token
		 *       404:
		 *         description: No such session
		 * components:
		 *   parameters:
		 *     sessionId:
		 *       in: path
		 *       name: id
		 *       required: true
		 *       schema:
		 *         type: string
		 */
		router.get("/sessions/:id", this.getSession.bind(this));

		/**
		 * @openapi
		 * /sessions/{id}/turns:
		 *   post:
		 *     tags:
		 *       - Sessions
		 *     summary: Play one turn
		 *     description: >
		 *       Sends one line of input to the game. Pass expectedTurn to be told, with a 409,
		 *       when someone else has played since you last looked. Pass idempotencyKey so a
		 *       retried request returns the stored reply instead of playing again.
		 *     security:
		 *       - sessionToken: []
		 *     parameters:
		 *       - $ref: '#/components/parameters/sessionId'
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [input]
		 *             properties:
		 *               input:
		 *                 type: string
		 *                 example: open mailbox
		 *               expectedTurn:
		 *                 type: integer
		 *                 description: The turn the client believes the session is on.
		 *               idempotencyKey:
		 *                 type: string
		 *                 description: Caller-chosen key, unique per attempted turn.
		 *     responses:
		 *       200:
		 *         description: The turn that was played
		 *         content:
		 *           application/json:
		 *             schema:
		 *               $ref: '#/components/schemas/TurnReply'
		 *       400:
		 *         description: Malformed request or input
		 *       401:
		 *         description: Missing or wrong token
		 *       409:
		 *         description: expectedTurn is stale, or the game has ended. The body carries the current turn and its output.
		 *         content:
		 *           application/json:
		 *             schema:
		 *               allOf:
		 *                 - $ref: '#/components/schemas/Error'
		 *                 - $ref: '#/components/schemas/TurnReply'
		 */
		router.post("/sessions/:id/turns", this.playTurn.bind(this));

		/**
		 * @openapi
		 * /sessions/{id}/transcript:
		 *   get:
		 *     tags:
		 *       - Sessions
		 *     summary: Full history
		 *     description: Every turn from the intro onward with its input and output.
		 *     security:
		 *       - sessionToken: []
		 *     parameters:
		 *       - $ref: '#/components/parameters/sessionId'
		 *     responses:
		 *       200:
		 *         description: The transcript
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 turns:
		 *                   type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       turn:
		 *                         type: integer
		 *                       input:
		 *                         type: string
		 *                         nullable: true
		 *                       out:
		 *                         $ref: '#/components/schemas/TurnOutput'
		 *       401:
		 *         description: Missing or wrong token
		 */
		router.get("/sessions/:id/transcript", this.getTranscript.bind(this));

		/**
		 * @openapi
		 * /sessions/{id}/rewind:
		 *   post:
		 *     tags:
		 *       - Sessions
		 *     summary: Undo
		 *     description: Truncates the session back to the given turn. Everything after it is forgotten.
		 *     security:
		 *       - sessionToken: []
		 *     parameters:
		 *       - $ref: '#/components/parameters/sessionId'
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [toTurn]
		 *             properties:
		 *               toTurn:
		 *                 type: integer
		 *                 example: 3
		 *     responses:
		 *       200:
		 *         description: The session as it now stands
		 *         content:
		 *           application/json:
		 *             schema:
		 *               $ref: '#/components/schemas/SessionSummary'
		 *       400:
		 *         description: toTurn is not a turn this session has reached
		 *       401:
		 *         description: Missing or wrong token
		 */
		router.post("/sessions/:id/rewind", this.rewind.bind(this));
	}

	private async createSession(ctx: Context): Promise<void> {
		const body = bodyOf(ctx);
		if (typeof body.gameId !== "string") {
			badRequest("gameId must be a string");
		}
		const created = await this.sessionController.createSession(body.gameId);
		ctx.status = 201;
		ctx.body = {
			session: created.session,
			token: created.token,
			turn: 0,
			out: created.out,
		};
	}

	private async getSession(ctx: Context): Promise<void> {
		const sessionId = await this.authorize(ctx);
		ctx.body = await this.sessionController.getSession(sessionId);
	}

	private async playTurn(ctx: Context): Promise<void> {
		const sessionId = await this.authorize(ctx);
		const body = bodyOf(ctx);
		if (typeof body.input !== "string") {
			badRequest("input must be a string");
		}
		const request: IPlayTurnRequest = { input: body.input };
		if (body.expectedTurn !== undefined) {
			if (typeof body.expectedTurn !== "number") {
				badRequest("expectedTurn must be a number");
			}
			request.expectedTurn = body.expectedTurn;
		}
		if (body.idempotencyKey !== undefined) {
			if (typeof body.idempotencyKey !== "string") {
				badRequest("idempotencyKey must be a string");
			}
			request.idempotencyKey = body.idempotencyKey;
		}
		ctx.body = await this.sessionController.playTurn(sessionId, request);
	}

	private async getTranscript(ctx: Context): Promise<void> {
		const sessionId = await this.authorize(ctx);
		ctx.body = { turns: await this.sessionController.getTranscript(sessionId) };
	}

	private async rewind(ctx: Context): Promise<void> {
		const sessionId = await this.authorize(ctx);
		const body = bodyOf(ctx);
		if (typeof body.toTurn !== "number") {
			badRequest("toTurn must be a number");
		}
		ctx.body = await this.sessionController.rewind(sessionId, body.toTurn);
	}

	// Every per-session route requires the session's bearer token.
	private async authorize(ctx: Context): Promise<string> {
		const sessionId = String(ctx.params.id);
		const header = ctx.get("authorization");
		const token = BEARER_PREFIX.test(header)
			? header.replace(BEARER_PREFIX, "").trim()
			: null;
		await this.sessionController.authorize(sessionId, token);
		return sessionId;
	}
}

function bodyOf(ctx: Context): Record<string, unknown> {
	const body: unknown = ctx.request.body;
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		badRequest("request body must be a JSON object");
	}
	return body as Record<string, unknown>;
}
