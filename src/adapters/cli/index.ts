import { Cli, parseArgs } from "./src/cli.js";
import { ZturnClient } from "./src/client.js";

const DEFAULT_URL = "http://127.0.0.1:41732";

const argv = process.argv.slice(2);
const url = parseArgs(argv).options.get("url");
const baseUrl =
	typeof url === "string" ? url : (process.env.ZTURN_URL ?? DEFAULT_URL);

const cli = new Cli(new ZturnClient(baseUrl), {
	stdin: process.stdin,
	stdout: process.stdout,
	stderr: process.stderr,
});

process.exitCode = await cli.run(argv);
