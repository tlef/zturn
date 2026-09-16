import {
	createHash,
	randomBytes,
	randomInt,
	timingSafeEqual,
} from "node:crypto";
import { type ITokenService } from "../types.js";

const SESSION_ID_BYTES = 12;
const TOKEN_BYTES = 32;

// Session ids are public and short; tokens are the sole credential and are
// stored only as a hash.
export class TokenService implements ITokenService {
	generateSessionId(): string {
		return randomBytes(SESSION_ID_BYTES).toString("base64url");
	}

	generateToken(): string {
		return randomBytes(TOKEN_BYTES).toString("base64url");
	}

	generateSeed(): number {
		return randomInt(1, 0x100000000);
	}

	hashToken(token: string): string {
		return createHash("sha256").update(token).digest("hex");
	}

	verifyToken(token: string, hash: string): boolean {
		const a = Buffer.from(this.hashToken(token), "hex");
		const b = Buffer.from(hash, "hex");
		return a.length === b.length && timingSafeEqual(a, b);
	}
}
