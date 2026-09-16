// A bridge is one visitor's Slack app connected to this server. It is
// created first so the manifest can carry its URL, then activated once the
// app exists and its signing secret is known.
export interface ISlackBridgeBase {
	id: string;
	// Encrypted; null until activated.
	signingSecretSealed: string | null;
	createdAt: string;
	activatedAt: string | null;
}

export interface ISlackChannelBase {
	bridgeId: string;
	channelId: string;
	sessionId: string;
	updatedAt: string;
}

export interface ISlackAppDatastore {
	createBridge: (bridge: ISlackBridgeBase) => Promise<void>;
	getBridge: (bridgeId: string) => Promise<ISlackBridgeBase | null>;
	activateBridge: (
		bridgeId: string,
		signingSecretSealed: string,
		at: string,
	) => Promise<boolean>;
	getChannel: (
		bridgeId: string,
		channelId: string,
	) => Promise<ISlackChannelBase | null>;
	setChannel: (channel: ISlackChannelBase) => Promise<void>;
}

export interface ISlackAppValidator {
	isValidBridgeId: (id: string) => boolean;
	isValidSigningSecret: (secret: string) => boolean;
	isValidChannelId: (id: string) => boolean;
}
