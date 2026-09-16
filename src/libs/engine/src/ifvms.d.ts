/* eslint-disable @typescript-eslint/naming-convention */
// Minimal typings for the members of ZVM (ifvms.js 1.1.x) that the engine
// touches. Names are ZVM's own. Anything not listed here is off limits.
declare module "ifvms" {
	export interface ZvmMemoryView {
		getUint8: (addr: number) => number;
		getUint16: (addr: number) => number;
	}

	// The pending @read request, set by ZVM when it blocks on line input.
	export interface ZvmReadData {
		buffer: number[];
		bufaddr: number;
		parseaddr: number;
		routine: number;
		storer: number;
		time: number;
	}

	// ZVM's screen model. Plain data apart from the transcript stream
	// handles, which stay unset because the engine cancels every file prompt.
	export interface ZvmIo {
		streams: unknown[];
		currentwin: number;
		width: number;
		[key: string]: unknown;
	}

	export interface ZvmOptions {
		Glk: object;
		stack_len?: number;
		undo_len?: number;
	}

	export interface ZvmInstance {
		prepare: (story: Uint8Array, options: ZvmOptions) => void;
		start: () => void;
		resume: (arg?: unknown) => void;
		run: () => void;
		restart: (autorestoring?: number) => void;
		save_file: (pc: number, autosaving?: number) => ArrayBuffer;
		restore_file: (data: Uint8Array, autorestoring?: number) => number;
		handle_create_fileref: (fref: unknown) => number | undefined;
		decode: (addr: number, length: number) => string;
		random: (range: number) => number;
		m: ZvmMemoryView;
		globals: number;
		objects: number;
		pc: number;
		version: number;
		read_data: ZvmReadData | undefined;
		io: ZvmIo;
		glk_event: unknown;
		glk_blocking_call: string | null;
		quit: number | undefined;
	}

	export const ZVM: new () => ZvmInstance;
}
