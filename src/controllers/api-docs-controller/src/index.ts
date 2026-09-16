import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Options } from "swagger-jsdoc";
import { type IApiDocsController } from "../types.js";
import { OPENAPI_DEFINITION, SWAGGER_UI_ASSETS } from "./definition.js";

// swagger-jsdoc and swagger-ui-dist are only needed when the docs route is
// registered, which App does in development. They are required here rather
// than imported at the top so production startup never loads them.
const esmRequire = createRequire(import.meta.url);

// This file lives four levels below the project root in both src/ and out/.
const PROJECT_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);

export class ApiDocsController implements IApiDocsController {
	private readonly spec: object;
	private readonly swaggerUiPath: string;

	constructor() {
		const swaggerJsdoc = esmRequire("swagger-jsdoc") as (
			options: Options,
		) => object;
		this.spec = swaggerJsdoc({
			definition: OPENAPI_DEFINITION,
			// The JSDoc blocks live in the TypeScript sources; tsc strips comments.
			apis: [join(PROJECT_ROOT, "src", "api", "*.ts")],
		});
		this.swaggerUiPath = dirname(
			esmRequire.resolve("swagger-ui-dist/package.json"),
		);
	}

	getSpec(): object {
		return this.spec;
	}

	getStaticAssetPath(name: string): string | null {
		if (!SWAGGER_UI_ASSETS.has(name)) {
			return null;
		}
		return join(this.swaggerUiPath, name);
	}

	getDocsHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>zturn API</title>
	<link rel="stylesheet" href="/docs/static/swagger-ui.css">
</head>
<body>
	<div id="swagger-ui"></div>
	<script src="/docs/static/swagger-ui-bundle.js"></script>
	<script>
		SwaggerUIBundle({
			url: "/docs/swagger.json",
			dom_id: "#swagger-ui",
			persistAuthorization: true,
		});
	</script>
</body>
</html>`;
	}
}
