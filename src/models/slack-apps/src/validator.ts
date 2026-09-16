import { type ISlackAppValidator } from "../types.js";

const BRIDGE_ID = /^[A-Za-z0-9_-]{8,64}$/;
// Slack signing secrets are 32 hex characters.
const SIGNING_SECRET = /^[0-9a-f]{32}$/i;
const CHANNEL_ID = /^[A-Z0-9]{1,64}$/;

export class SlackAppValidator implements ISlackAppValidator {
	isValidBridgeId(id: string): boolean {
		return BRIDGE_ID.test(id);
	}

	isValidSigningSecret(secret: string): boolean {
		return SIGNING_SECRET.test(secret);
	}

	isValidChannelId(id: string): boolean {
		return CHANNEL_ID.test(id);
	}
}
