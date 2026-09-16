import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import supertest from "supertest";
import { App } from "../app.js";

describe("web page", () => {
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

	it("serves the browser client at the root in every environment", async () => {
		const res = await request.get("/").expect(200);
		expect(res.type).to.equal("text/html");
		expect(res.text).to.include("<title>zturn</title>");
		expect(res.text).to.include('id="transcript"');
		expect(res.text).to.include("/sessions/${session.id}/turns");
	});
});
