import { type HealthResult, type IHealthController } from "../types.js";

export class HealthController implements IHealthController {
	private readonly startedAt: number;

	constructor() {
		this.startedAt = Date.now();
	}

	getHealth(): HealthResult {
		return {
			status: "ok",
			uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
		};
	}
}
