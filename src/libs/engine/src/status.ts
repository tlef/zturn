import type { ZvmInstance } from "ifvms";
import { type Status } from "../types.js";

// A version 3 status line comes from three globals: the current room object,
// the score, and the move count. This reads them the same way ZVM does when
// it draws the status window, so no output text is ever parsed.
export function readStatus(vm: ZvmInstance): Status {
	const m = vm.m;
	const room = m.getUint16(vm.globals);
	let location = "";
	if (room !== 0) {
		const proptable = m.getUint16(vm.objects + 9 * room + 7);
		location = String(vm.decode(proptable + 1, m.getUint8(proptable) * 2));
	}
	return {
		location,
		score: toSigned16(m.getUint16(vm.globals + 2)),
		moves: m.getUint16(vm.globals + 4),
	};
}

function toSigned16(value: number): number {
	return value >= 0x8000 ? value - 0x10000 : value;
}
