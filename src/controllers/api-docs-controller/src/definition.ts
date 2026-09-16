// Shared between the runtime /docs route and scripts/generate-api-docs.mjs
// so the two never drift.
export const OPENAPI_DEFINITION = {
	openapi: "3.0.3",
	info: {
		title: "zturn API",
		version: "0.1.0",
		description:
			"Infocom Z-machine games over HTTP. One request plays one turn.",
	},
	components: {
		securitySchemes: {
			sessionToken: {
				type: "http",
				scheme: "bearer",
				description:
					"The token returned when the session was created. Paste it into Authorize.",
			},
		},
	},
};

// Swagger UI files the docs page is allowed to serve. Anything else is 404.
export const SWAGGER_UI_ASSETS: ReadonlyMap<string, string> = new Map([
	["swagger-ui.css", "text/css"],
	["swagger-ui-bundle.js", "application/javascript"],
]);
