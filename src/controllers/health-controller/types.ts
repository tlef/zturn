export interface HealthResult {
	status: "ok";
	uptimeSeconds: number;
}

export interface IHealthController {
	getHealth: () => HealthResult;
}
