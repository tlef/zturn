import { describe, it } from "mocha";
import { expect } from "chai";
import { SecretBox } from "./index.js";

const KEY = "0".repeat(63) + "1";

describe("SecretBox", () => {
	it("round-trips text and never repeats a ciphertext", () => {
		const box = new SecretBox(KEY);
		const a = box.encrypt("hunter2");
		const b = box.encrypt("hunter2");
		expect(a).to.not.equal(b);
		expect(box.decrypt(a)).to.equal("hunter2");
		expect(box.decrypt(b)).to.equal("hunter2");
	});

	it("rejects tampering and the wrong key", () => {
		const box = new SecretBox(KEY);
		const sealed = box.encrypt("secret");
		const tampered =
			sealed.slice(0, -2) + (sealed.endsWith("AA") ? "BB" : "AA");
		expect(() => box.decrypt(tampered)).to.throw();
		expect(() => new SecretBox("f".repeat(64)).decrypt(sealed)).to.throw();
		expect(() => box.decrypt("short")).to.throw();
	});

	it("insists on a 32-byte hex key", () => {
		expect(() => new SecretBox("abc")).to.throw();
		expect(() => new SecretBox("g".repeat(64))).to.throw();
	});
});
