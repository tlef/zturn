import { type ISessionValidator } from "../types.js";

// Input is passed to the engine untouched, so the only concerns are size and
// control characters that could never come from a keyboard.
const MAX_INPUT_BYTES = 256;
const MAX_KEY_LENGTH = 128;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0a-\x1f\x7f]/;

export class SessionValidator implements ISessionValidator {
	isValidSessionId(id: string): boolean {
		return ID_PATTERN.test(id);
	}

	isValidGameId(id: string): boolean {
		return ID_PATTERN.test(id);
	}

	isValidInput(input: string): boolean {
		return (
			typeof input === "string" &&
			Buffer.byteLength(input, "utf8") <= MAX_INPUT_BYTES &&
			!CONTROL_CHARS.test(input)
		);
	}

	isValidTurn(turn: number): boolean {
		return Number.isInteger(turn) && turn >= 0;
	}

	isValidIdempotencyKey(key: string): boolean {
		return key.length <= MAX_KEY_LENGTH && KEY_PATTERN.test(key);
	}
}
