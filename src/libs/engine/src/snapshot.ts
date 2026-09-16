import type { ZvmIo } from "ifvms";
import { type Awaiting, ERRORS } from "../types.js";

// Snapshot layout, all integers big-endian:
//   0   "ZTSN"
//   4   u16 format version
//   6   u32 PRNG state
//   10  u32 length of the JSON metadata
//   14  metadata, then the Quetzal image to the end
// Bump SNAPSHOT_FORMAT whenever any of this, the metadata, or the ZVM
// dependency changes in a way that alters the bytes. Old snapshots are then
// rejected and rebuilt from the input log.
export const SNAPSHOT_FORMAT = 1;

const MAGIC = "ZTSN";
const HEADER_LENGTH = 14;

export interface SnapshotReadData {
	bufferLength: number;
	bufaddr: number;
	parseaddr: number;
	routine: number;
	storer: number;
	time: number;
}

export interface SnapshotParts {
	rng: number;
	awaiting: Awaiting;
	readData: SnapshotReadData | null;
	io: ZvmIo;
	quetzal: Uint8Array;
}

interface Metadata {
	awaiting: Awaiting;
	readData: SnapshotReadData | null;
	io: ZvmIo;
}

export function encodeSnapshot(parts: SnapshotParts): Uint8Array {
	const metadata: Metadata = {
		awaiting: parts.awaiting,
		readData: parts.readData,
		io: parts.io,
	};
	const meta = new TextEncoder().encode(JSON.stringify(metadata));
	const out = new Uint8Array(
		HEADER_LENGTH + meta.length + parts.quetzal.length,
	);
	const view = new DataView(out.buffer);
	new TextEncoder().encodeInto(MAGIC, out);
	view.setUint16(4, SNAPSHOT_FORMAT);
	view.setUint32(6, parts.rng >>> 0);
	view.setUint32(10, meta.length);
	out.set(meta, HEADER_LENGTH);
	out.set(parts.quetzal, HEADER_LENGTH + meta.length);
	return out;
}

export function decodeSnapshot(bytes: Uint8Array): SnapshotParts {
	if (bytes.length < HEADER_LENGTH) {
		throw new Error(ERRORS.snapshot_corrupt);
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) {
		throw new Error(ERRORS.snapshot_corrupt);
	}
	if (view.getUint16(4) !== SNAPSHOT_FORMAT) {
		throw new Error(ERRORS.snapshot_incompatible);
	}
	const rng = view.getUint32(6);
	const metaLength = view.getUint32(10);
	const metaEnd = HEADER_LENGTH + metaLength;
	if (metaEnd > bytes.length) {
		throw new Error(ERRORS.snapshot_corrupt);
	}
	let metadata: Metadata;
	try {
		metadata = JSON.parse(
			new TextDecoder().decode(bytes.subarray(HEADER_LENGTH, metaEnd)),
		) as Metadata;
	} catch {
		throw new Error(ERRORS.snapshot_corrupt);
	}
	return {
		rng,
		awaiting: metadata.awaiting,
		readData: metadata.readData,
		io: metadata.io,
		// Copy so the VM never aliases the caller's buffer.
		quetzal: bytes.slice(metaEnd),
	};
}
