/* eslint-disable @typescript-eslint/naming-convention */
// The smallest Glk that ZVM will accept. It captures main-window text,
// records what the VM is waiting for, and returns control to the caller
// instead of waiting for an event. Method names are Glk's own.

export class RefBox {
	private value = 0;

	get_value(): number {
		return this.value;
	}

	set_value(value: number): void {
		this.value = value;
	}
}

export class RefStruct {
	private readonly fields: unknown[] = [];

	push_field(value: unknown): void {
		this.fields.push(value);
	}

	set_field(index: number, value: unknown): void {
		this.fields[index] = value;
	}

	get_field(index: number): unknown {
		return this.fields[index];
	}

	get_fields(): unknown[] {
		return this.fields;
	}
}

export interface GlkWindow {
	rock: number;
	wintype: number;
	str: GlkStream;
}

export interface GlkStream {
	win: GlkWindow;
}

export type PendingRequest =
	| { kind: "line"; win: GlkWindow; buffer: number[] }
	| { kind: "char"; win: GlkWindow };

const SCREEN_WIDTH = 80;
const SCREEN_HEIGHT = 24;

// Glk event type codes used by ZVM.
export const EVTYPE_LINE_INPUT = 3;

export class GlkShim {
	public readonly RefBox = RefBox;
	public readonly RefStruct = RefStruct;

	private mainwin: GlkWindow | null = null;
	private currentwin: GlkWindow | null = null;
	private text = "";
	private pending: PendingRequest | null = null;
	private exited = false;

	// Called by the engine before every run so a turn sees only its own output.
	resetForTurn(): void {
		this.text = "";
		this.pending = null;
		this.exited = false;
	}

	getText(): string {
		return this.text;
	}

	getPending(): PendingRequest | null {
		return this.pending;
	}

	hasExited(): boolean {
		return this.exited;
	}

	// --- Capabilities and styles: nothing is supported, nothing is styled ---

	glk_gestalt(_selector: number, _value: number): number {
		return 0;
	}

	glk_stylehint_set(
		_wintype: number,
		_style: number,
		_hint: number,
		_value: number,
	): void {}

	glk_stylehint_clear(_wintype: number, _style: number, _hint: number): void {}

	glk_set_style(_style: number): void {}

	garglk_set_reversevideo(_reverse: number): void {}

	garglk_set_reversevideo_stream(_str: GlkStream, _reverse: number): void {}

	garglk_set_zcolors_stream(_str: GlkStream, _fg: number, _bg: number): void {}

	// --- Windows: the first one opened is the main window, the rest are void ---

	glk_window_open(
		_split: GlkWindow | 0,
		_method: number,
		_size: number,
		wintype: number,
		rock: number,
	): GlkWindow {
		const win: GlkWindow = { rock, wintype, str: { win: null as never } };
		win.str = { win };
		if (!this.mainwin) {
			this.mainwin = win;
			this.currentwin = win;
		}
		return win;
	}

	glk_window_close(win: GlkWindow): void {
		if (this.currentwin === win) {
			this.currentwin = this.mainwin;
		}
	}

	glk_window_get_parent(_win: GlkWindow): object {
		return {};
	}

	glk_window_set_arrangement(
		_pair: object,
		_method: number,
		_size: number,
		_key: GlkWindow | null,
	): void {}

	glk_window_get_size(
		win: GlkWindow,
		widthBox: RefBox,
		heightBox: RefBox | 0,
	): void {
		widthBox.set_value(SCREEN_WIDTH);
		if (heightBox) {
			heightBox.set_value(win === this.mainwin ? SCREEN_HEIGHT : 1);
		}
	}

	glk_window_clear(_win: GlkWindow): void {}

	glk_window_move_cursor(_win: GlkWindow, _col: number, _row: number): void {}

	glk_window_get_stream(win: GlkWindow): GlkStream {
		return win.str;
	}

	glk_set_window(win: GlkWindow | null): void {
		this.currentwin = win ?? this.mainwin;
	}

	// --- Output: only the main window is kept ---

	glk_put_jstring(text: string): void {
		if (this.currentwin === this.mainwin) {
			this.text += text;
		}
	}

	glk_put_jstring_stream(str: GlkStream, text: string): void {
		if (str.win === this.mainwin) {
			this.text += text;
		}
	}

	// --- Files: every prompt is cancelled, so no file stream can ever exist ---

	glk_fileref_create_by_prompt(
		_usage: number,
		_mode: number,
		_rock: number,
	): null {
		return null;
	}

	glk_fileref_destroy(_fref: unknown): void {}

	glk_stream_open_file(_fref: unknown, _mode: number, _rock: number): never {
		throw new Error("glk_stream_open_file is not supported");
	}

	glk_stream_open_file_uni(
		_fref: unknown,
		_mode: number,
		_rock: number,
	): never {
		throw new Error("glk_stream_open_file_uni is not supported");
	}

	glk_stream_close(_str: unknown): void {}

	glk_put_char_stream_uni(_str: unknown, _ch: number): void {}

	glk_put_buffer_stream(_str: unknown, _buf: Uint8Array): void {}

	glk_get_buffer_stream(_str: unknown, _buf: Uint8Array): number {
		return 0;
	}

	glk_get_line_stream_uni(_str: unknown, _buf: number[]): number {
		return 0;
	}

	glk_get_char_stream_uni(_str: unknown): number {
		return -1;
	}

	// --- Input: record the request and hand control back ---

	glk_request_line_event_uni(
		win: GlkWindow,
		buffer: number[],
		_initlen: number,
	): void {
		this.pending = { kind: "line", win, buffer };
	}

	glk_request_char_event_uni(win: GlkWindow): void {
		this.pending = { kind: "char", win };
	}

	glk_select(_event: RefStruct): void {}

	glk_exit(): void {
		this.exited = true;
	}

	update(): void {}

	// ZVM catches everything in start() and resume() and hands it here.
	// Rethrowing turns it back into an ordinary exception for the engine.
	fatal_error(error: unknown): never {
		throw error;
	}
}
