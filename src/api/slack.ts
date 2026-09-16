import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context } from "koa";
import type Router from "@koa/router";
import {
	type ISlackCommand,
	type ISlackController,
} from "../controllers/slack-controller/index.js";
import { badRequest } from "./api-errors.js";

const PAGE_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"adapters",
	"slack",
	"page",
	"index.html",
);

// The Slack bridge. Visitors register their own Slack app here and point
// its slash command at their bridge URL; the page at /slack walks them
// through it. The command endpoint is what Slack itself calls.
export class ApiSlack {
	protected slackController: ISlackController | null;
	private readonly page: string;

	// A null controller means the bridge is not enabled on this server; the
	// page still loads and says so.
	constructor(slackController: ISlackController | null) {
		this.slackController = slackController;
		this.page = readFileSync(PAGE_PATH, "utf8");
	}

	public registerRoutes(router: Router): void {
		router.get("/slack", this.getPage.bind(this));

		/**
		 * @openapi
		 * /slack/bridges:
		 *   post:
		 *     tags:
		 *       - Slack
		 *     summary: Create a bridge for your own Slack app
		 *     description: >
		 *       Returns a bridge id. Put https://HOST/slack/bridges/ID/commands in your app's
		 *       slash command, then activate the bridge with the app's signing secret.
		 *       Returns 404 when the server has no Slack secret key configured.
		 *     responses:
		 *       201:
		 *         description: The new bridge
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 bridgeId:
		 *                   type: string
		 *                 activated:
		 *                   type: boolean
		 */
		router.post("/slack/bridges", this.createBridge.bind(this));

		/**
		 * @openapi
		 * /slack/bridges/{id}:
		 *   get:
		 *     tags:
		 *       - Slack
		 *     summary: Bridge status
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema:
		 *           type: string
		 *     responses:
		 *       200:
		 *         description: Whether the bridge has been activated
		 *       404:
		 *         description: No such bridge
		 */
		router.get("/slack/bridges/:id", this.getBridge.bind(this));

		/**
		 * @openapi
		 * /slack/bridges/{id}/activate:
		 *   post:
		 *     tags:
		 *       - Slack
		 *     summary: Activate a bridge with your app's signing secret
		 *     description: The secret is stored encrypted and used only to verify that requests come from your app.
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema:
		 *           type: string
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [signingSecret]
		 *             properties:
		 *               signingSecret:
		 *                 type: string
		 *                 description: 32 hex characters, from the app's Basic Information page.
		 *     responses:
		 *       200:
		 *         description: The bridge is active
		 *       400:
		 *         description: Not a signing secret
		 *       404:
		 *         description: No such bridge
		 */
		router.post("/slack/bridges/:id/activate", this.activateBridge.bind(this));

		/**
		 * @openapi
		 * /slack/bridges/{id}/commands:
		 *   post:
		 *     tags:
		 *       - Slack
		 *     summary: Slash command endpoint, called by Slack
		 *     description: >
		 *       Receives Slack's form-encoded slash command payload, verifies its signature
		 *       against the bridge's signing secret, and replies with a Slack message.
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema:
		 *           type: string
		 *     responses:
		 *       200:
		 *         description: A Slack message payload
		 *       401:
		 *         description: The signature did not verify
		 */
		router.post("/slack/bridges/:id/commands", this.handleCommand.bind(this));
	}

	private async getPage(ctx: Context): Promise<void> {
		ctx.type = "html";
		ctx.body = this.page;
	}

	private async createBridge(ctx: Context): Promise<void> {
		const controller = this.enabled(ctx);
		ctx.status = 201;
		ctx.body = await controller.createBridge();
	}

	private async getBridge(ctx: Context): Promise<void> {
		const controller = this.enabled(ctx);
		ctx.body = await controller.getBridge(String(ctx.params.id));
	}

	private async activateBridge(ctx: Context): Promise<void> {
		const controller = this.enabled(ctx);
		const body: unknown = ctx.request.body;
		const secret =
			typeof body === "object" && body !== null
				? (body as { signingSecret?: unknown }).signingSecret
				: undefined;
		if (typeof secret !== "string") {
			badRequest("signingSecret must be a string");
		}
		await controller.activateBridge(String(ctx.params.id), secret);
		ctx.body = await controller.getBridge(String(ctx.params.id));
	}

	private async handleCommand(ctx: Context): Promise<void> {
		const controller = this.enabled(ctx);
		const bridgeId = String(ctx.params.id);
		// koa-body keeps the raw request text here when includeUnparsed is on.
		const raw = (ctx.request as { rawBody?: unknown }).rawBody;
		await controller.verifyRequest(
			bridgeId,
			ctx.get("x-slack-request-timestamp"),
			ctx.get("x-slack-signature"),
			typeof raw === "string" ? raw : "",
		);
		const form = ctx.request.body as Record<string, unknown>;
		const command: ISlackCommand = {
			channelId: String(form.channel_id ?? ""),
			text: String(form.text ?? ""),
			triggerId: String(form.trigger_id ?? ""),
			userName: typeof form.user_name === "string" ? form.user_name : null,
		};
		const reply = await controller.handleCommand(bridgeId, command);
		// Slack's own field names.
		/* eslint-disable @typescript-eslint/naming-convention */
		ctx.body = {
			response_type:
				reply.visibility === "inChannel" ? "in_channel" : "ephemeral",
			text: reply.text,
		};
		/* eslint-enable @typescript-eslint/naming-convention */
	}

	private enabled(ctx: Context): ISlackController {
		if (!this.slackController) {
			ctx.throw(404, "The Slack bridge is not enabled on this server");
		}
		return this.slackController;
	}
}
