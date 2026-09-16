// 32-bit xorshift, the same generator ZVM uses when a game seeds @random.
// The engine owns it so that replay never depends on Math.random.
export class Xorshift32 {
	private state = 1;

	constructor(seed: number) {
		this.setState(seed);
	}

	getState(): number {
		return this.state;
	}

	setState(state: number): void {
		// xorshift is stuck at zero forever, so map zero to a fixed nonzero seed.
		this.state = state >>> 0 || 0x9e3779b9;
	}

	// 1..range inclusive, matching the Z-machine @random contract.
	random(range: number): number {
		let s = this.state;
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		this.state = s >>> 0;
		return 1 + ((this.state & 0x7fff) % range);
	}
}
