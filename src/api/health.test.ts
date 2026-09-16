import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import supertest from "supertest";
import { App } from "../app.js";

describe("GET /health", () => {
	let app: App;
	let request: ReturnType<typeof supertest>;

	before(() => {
		app = new App({
			env: "test",
			storyDir: "./stories",
			databasePath: ":memory:",
		});
		request = supertest(app.getCallback());
	});

	after(async () => {
		await app.stop();
	});

	it("reports ok", async () => {
		const res = await request.get("/health").expect(200);
		expect(res.body.status).to.equal("ok");
		expect(res.body.uptimeSeconds).to.be.a("number");
	});
});
