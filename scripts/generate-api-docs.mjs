/* eslint-disable no-console */
// Writes an offline copy of the API docs to api-docs/. Runs after tsc so it
// can import the shared OpenAPI definition from the build output.
const env = process.env.ENV ?? "development";
if (env !== "development" && env !== "local") {
	console.log(`Skipping API docs generation (ENV=${env})`);
	process.exit(0);
}

import swaggerJsdoc from "swagger-jsdoc";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(projectRoot, "api-docs");

const { OPENAPI_DEFINITION, SWAGGER_UI_ASSETS } = await import(
	join(projectRoot, "out", "controllers", "api-docs-controller", "index.js")
);

const spec = swaggerJsdoc({
	definition: OPENAPI_DEFINITION,
	apis: [join(projectRoot, "src", "api", "*.ts")],
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "swagger.json"), JSON.stringify(spec, null, 2));

const swaggerUiPath = dirname(
	createRequire(import.meta.url).resolve("swagger-ui-dist/package.json"),
);
for (const asset of Object.keys(SWAGGER_UI_ASSETS)) {
	copyFileSync(join(swaggerUiPath, asset), join(outDir, asset));
}

writeFileSync(
	join(outDir, "index.html"),
	`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>zturn API</title>
	<link rel="stylesheet" href="swagger-ui.css">
</head>
<body>
	<div id="swagger-ui"></div>
	<script src="swagger-ui-bundle.js"></script>
	<script>
		SwaggerUIBundle({ url: "swagger.json", dom_id: "#swagger-ui" });
	</script>
</body>
</html>
`,
);

console.log(`API docs written to ${outDir}/`);
