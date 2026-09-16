import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import supertest from "supertest";
import { App } from "../app.js";

function makeApp(env: string): App {
	return new App({ env, storyDir: "./stories", databasePath: ":memory:" });
}

describe("API docs", () => {
	describe("in a development environment", () => {
		let app: App;
		let request: ReturnType<typeof supertest>;

		before(() => {
			app = makeApp("local");
			request = supertest(app.getCallback());
		});

		after(async () => {
			await app.stop();
		});

		it("serves the Swagger UI page", async () => {
			const res = await request.get("/docs").expect(200);
			expect(res.type).to.equal("text/html");
			expect(res.text).to.include("SwaggerUIBundle");
		});

		it("serves a spec that includes the documented routes", async () => {
			const res = await request.get("/docs/swagger.json").expect(200);
			expect(res.body.openapi).to.equal("3.0.3");
			expect(res.body.paths).to.have.property("/health");
		});

		it("serves the allowlisted Swagger UI assets", async () => {
			const css = await request.get("/docs/static/swagger-ui.css").expect(200);
			expect(css.type).to.equal("text/css");
			await request.get("/docs/static/swagger-ui-bundle.js").expect(200);
		});

		it("refuses any other file under the static path", async () => {
			await request.get("/docs/static/package.json").expect(404);
			await request.get("/docs/static/..%2Fpackage.json").expect(404);
		});
	});

	describe("outside development", () => {
		let app: App;
		let request: ReturnType<typeof supertest>;

		before(() => {
			app = makeApp("test");
			request = supertest(app.getCallback());
		});

		after(async () => {
			await app.stop();
		});

		it("does not exist", async () => {
			await request.get("/docs").expect(404);
			await request.get("/docs/swagger.json").expect(404);
		});
	});
});
