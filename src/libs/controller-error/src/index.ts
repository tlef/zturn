import { type IControllerErrorData } from "../types.js";

// Thrown by controllers. The message is a code from that controller's ERRORS
// enum, so callers can match on it the way they would with a bare Error; the
// optional data rides along for responses that need more than a code, such
// as a turn conflict that reports the current turn.
export class ControllerError extends Error {
	public readonly code: string;
	public readonly data: IControllerErrorData | undefined;

	constructor(code: string, data?: IControllerErrorData) {
		super(code);
		this.name = "ControllerError";
		this.code = code;
		this.data = data;
	}
}
