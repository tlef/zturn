export interface ISlackSigner {
	// Produces the X-Slack-Signature value for a request.
	sign: (signingSecret: string, timestamp: string, rawBody: string) => string;
	// True only for a fresh timestamp and a matching signature.
	verify: (
		signingSecret: string,
		timestamp: string,
		signature: string,
		rawBody: string,
		nowSeconds?: number,
	) => boolean;
}
