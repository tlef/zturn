export enum ERRORS {
	invalid_bridge_id = "invalid_bridge_id",
	bridge_not_found = "bridge_not_found",
	bridge_not_activated = "bridge_not_activated",
	invalid_signing_secret = "invalid_signing_secret",
	bad_signature = "bad_signature",
	invalid_channel_id = "invalid_channel_id",
}

export interface ISlackBridge {
	bridgeId: string;
	activated: boolean;
}

// The fields of a slash command payload the bridge uses.
export interface ISlackCommand {
	channelId: string;
	text: string;
	// Unique per invocation; doubles as the idempotency key.
	triggerId: string;
	userName: string | null;
}

// "inChannel" replies are seen by the whole channel; "ephemeral" only by
// the person who typed the command.
export interface ISlackReply {
	visibility: "inChannel" | "ephemeral";
	text: string;
}

export interface ISlackController {
	createBridge: () => Promise<ISlackBridge>;
	getBridge: (bridgeId: string) => Promise<ISlackBridge>;
	activateBridge: (bridgeId: string, signingSecret: string) => Promise<void>;
	// Throws unless the request is fresh and signed by the bridge's app.
	verifyRequest: (
		bridgeId: string,
		timestamp: string,
		signature: string,
		rawBody: string,
	) => Promise<void>;
	handleCommand: (
		bridgeId: string,
		command: ISlackCommand,
	) => Promise<ISlackReply>;
}
