import type Koa from "koa";
import { ControllerError } from "../libs/controller-error/index.js";
import { ERRORS as SESSION_ERRORS } from "../controllers/session-controller/index.js";
import { ERRORS as SLACK_ERRORS } from "../controllers/slack-controller/index.js";

// Wire-level codes the API itself raises while parsing a request.
export enum API_ERRORS {
	invalid_request = "invalid_request",
}

const STATUS_BY_CODE = new Map<string, number>([
	[API_ERRORS.invalid_request, 400],
	[SESSION_ERRORS.invalid_game_id, 400],
	[SESSION_ERRORS.invalid_session_id, 400],
	[SESSION_ERRORS.invalid_input, 400],
	[SESSION_ERRORS.invalid_turn, 400],
	[SESSION_ERRORS.invalid_idempotency_key, 400],
	[SESSION_ERRORS.invalid_seed, 400],
	[SESSION_ERRORS.unauthorized, 401],
	[SESSION_ERRORS.game_not_found, 404],
	[SESSION_ERRORS.session_not_found, 404],
	[SESSION_ERRORS.turn_conflict, 409],
	[SESSION_ERRORS.game_over, 409],
	[SESSION_ERRORS.session_corrupt, 500],
	[SLACK_ERRORS.invalid_bridge_id, 400],
	[SLACK_ERRORS.invalid_signing_secret, 400],
	[SLACK_ERRORS.invalid_channel_id, 400],
	[SLACK_ERRORS.bridge_not_found, 404],
	[SLACK_ERRORS.bridge_not_activated, 403],
	[SLACK_ERRORS.bad_signature, 401],
]);

// Turns a ControllerError into a JSON response: { error: code, ...data }.
// Codes without a mapping are treated as server errors and rethrown so the
// outer error middleware logs them.
export async function controllerErrorMiddleware(
	ctx: Koa.Context,
	next: Koa.Next,
): Promise<void> {
	try {
		await next();
	} catch (error) {
		if (!(error instanceof ControllerError)) {
			throw error;
		}
		const status = STATUS_BY_CODE.get(error.code);
		if (status === undefined || status >= 500) {
			throw error;
		}
		ctx.status = status;
		ctx.body = { error: error.code, ...error.data };
	}
}

// For request shapes the API cannot even hand to a controller.
export function badRequest(detail: string): never {
	throw new ControllerError(API_ERRORS.invalid_request, { detail });
}
