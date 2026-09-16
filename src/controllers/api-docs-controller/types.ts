export interface IApiDocsController {
	getSpec: () => object;
	getDocsHtml: () => string;
	getStaticAssetPath: (name: string) => string | null;
}
