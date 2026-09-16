import { type IApiDocsController } from "./types.js";
import { ApiDocsController } from "./src/index.js";
import { OPENAPI_DEFINITION, SWAGGER_UI_ASSETS } from "./src/definition.js";

export type { IApiDocsController };
export { ApiDocsController, OPENAPI_DEFINITION, SWAGGER_UI_ASSETS };
