import {
	type ISlackAppDatastore,
	type ISlackBridgeBase,
	type ISlackChannelBase,
} from "../types.js";

export class MemorySlackAppDatastore implements ISlackAppDatastore {
	private readonly bridges = new Map<string, ISlackBridgeBase>();
	private readonly channels = new Map<string, ISlackChannelBase>();

	async createBridge(bridge: ISlackBridgeBase): Promise<void> {
		this.bridges.set(bridge.id, { ...bridge });
	}

	async getBridge(bridgeId: string): Promise<ISlackBridgeBase | null> {
		const bridge = this.bridges.get(bridgeId);
		return bridge ? { ...bridge } : null;
	}

	async activateBridge(
		bridgeId: string,
		signingSecretSealed: string,
		at: string,
	): Promise<boolean> {
		const bridge = this.bridges.get(bridgeId);
		if (!bridge) {
			return false;
		}
		bridge.signingSecretSealed = signingSecretSealed;
		bridge.activatedAt = at;
		return true;
	}

	async getChannel(
		bridgeId: string,
		channelId: string,
	): Promise<ISlackChannelBase | null> {
		const channel = this.channels.get(`${bridgeId}/${channelId}`);
		return channel ? { ...channel } : null;
	}

	async setChannel(channel: ISlackChannelBase): Promise<void> {
		this.channels.set(`${channel.bridgeId}/${channel.channelId}`, {
			...channel,
		});
	}
}
