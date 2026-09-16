import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { type ISecretBox } from "../types.js";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Encrypts small secrets for storage. The sealed form is base64url of
// iv || tag || ciphertext. The key comes from the environment as 64 hex
// characters; generate one with `openssl rand -hex 32`.
export class SecretBox implements ISecretBox {
	private readonly key: Buffer;

	constructor(hexKey: string) {
		const key = Buffer.from(hexKey, "hex");
		if (key.length !== KEY_BYTES || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
			throw new Error("secret box key must be 64 hex characters");
		}
		this.key = key;
	}

	encrypt(plaintext: string): string {
		const iv = randomBytes(IV_BYTES);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const body = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
	}

	decrypt(sealed: string): string {
		const data = Buffer.from(sealed, "base64url");
		if (data.length < IV_BYTES + TAG_BYTES) {
			throw new Error("sealed value is too short");
		}
		const iv = data.subarray(0, IV_BYTES);
		const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
		const body = data.subarray(IV_BYTES + TAG_BYTES);
		const decipher = createDecipheriv(ALGORITHM, this.key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(body), decipher.final()]).toString(
			"utf8",
		);
	}
}
