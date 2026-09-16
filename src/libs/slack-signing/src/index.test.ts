import { describe, it } from "mocha";
import { expect } from "chai";
import { SlackSigner } from "./index.js";

// Worked example from Slack's documentation on verifying requests.
const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const TIMESTAMP = "1531420618";
const BODY =
	"token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
const SIGNATURE =
	"v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503";

describe("SlackSigner", () => {
	const signer = new SlackSigner();

	it("reproduces Slack's documented signature", () => {
		expect(signer.sign(SECRET, TIMESTAMP, BODY)).to.equal(SIGNATURE);
	});

	it("verifies a fresh, correctly signed request", () => {
		expect(
			signer.verify(SECRET, TIMESTAMP, SIGNATURE, BODY, Number(TIMESTAMP) + 10),
		).to.equal(true);
	});

	it("rejects stale timestamps, wrong secrets and altered bodies", () => {
		const now = Number(TIMESTAMP);
		expect(
			signer.verify(SECRET, TIMESTAMP, SIGNATURE, BODY, now + 600),
		).to.equal(false);
		expect(signer.verify("other", TIMESTAMP, SIGNATURE, BODY, now)).to.equal(
			false,
		);
		expect(
			signer.verify(SECRET, TIMESTAMP, SIGNATURE, BODY + "x", now),
		).to.equal(false);
		expect(signer.verify(SECRET, "nan", SIGNATURE, BODY, now)).to.equal(false);
		expect(signer.verify(SECRET, TIMESTAMP, "v0=short", BODY, now)).to.equal(
			false,
		);
	});
});
