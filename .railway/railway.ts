import {
	defineRailway,
	github,
	preserve,
	project,
	service,
	volume,
} from "railway/iac";

// Deploy settings for the zturn service, applied with `railway config apply`
// (needs the `railway` dev dependency). Scoped to this service and its volume;
// the rest of the project is managed elsewhere. Variables are preserved as
// set in the dashboard, never written here.
export const partial = "zturn";

export default defineRailway(() => {
	const zturnVolume = volume("zturn-volume", {
		region: "us-west2",
		sizeMB: 50000,
		allowOnlineResize: true,
		alerts: { usage: { "80": {}, "95": {}, "100": {} } },
	});
	const zturn = service("zturn", {
		source: github("tlef/zturn", { checkSuites: false }),
		healthcheck: "/health",
		healthcheckTimeout: 60,
		replicas: { "us-west2": 1 },
		domains: ["zturn.tlef.ca"],
		volumeMounts: { "/app/data": zturnVolume },
		env: {
			RAILWAY_RUN_UID: preserve(),
			SLACK_SECRET_KEY: preserve(),
			STORY_DIR: preserve(),
		},
	});
	return project("tlef.ca", {
		resources: [zturn, zturnVolume],
	});
});
