import { createHmac, timingSafeEqual } from "node:crypto";
import { type ISlackSigner } from "../types.js";

const VERSION = "v0";
const MAX_AGE_SECONDS = 5 * 60;

// Slack's request signing: HMAC-SHA256 over "v0:<timestamp>:<body>" with the
// app's signing secret, sent as "v0=<hex>" alongside the timestamp header.
export class SlackSigner implements ISlackSigner {
	sign(signingSecret: string, timestamp: string, rawBody: string): string {
		const digest = createHmac("sha256", signingSecret)
			.update(`${VERSION}:${timestamp}:${rawBody}`)
			.digest("hex");
		return `${VERSION}=${digest}`;
	}

	verify(
		signingSecret: string,
		timestamp: string,
		signature: string,
		rawBody: string,
		nowSeconds: number = Math.floor(Date.now() / 1000),
	): boolean {
		const ts = Number(timestamp);
		if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_AGE_SECONDS) {
			return false;
		}
		const expected = Buffer.from(this.sign(signingSecret, timestamp, rawBody));
		const given = Buffer.from(signature);
		return expected.length === given.length && timingSafeEqual(expected, given);
	}
}
