import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RealoApi } from "../dist/index.js";
import { main } from "../dist/cli.js";

const BASE = ["--public-key", "p", "--private-key", "s"];
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function capture() {
	const out = [];
	const err = [];
	return {
		io: { stdout: (c) => out.push(typeof c === "string" ? c : Buffer.from(c).toString()), stderr: (c) => err.push(c) },
		out: () => out.join(""),
		err: () => err.join(""),
	};
}

function apiFor(status, contentType, body) {
	const calls = [];
	const api = RealoApi.createWithTransport("p", "s", async (req) => {
		calls.push([req.method, req.url, req.body]);
		return { status, headers: { "content-type": contentType }, body: new TextEncoder().encode(body) };
	});
	return { api, calls };
}

test("JSON output", async () => {
	const { api, calls } = apiFor(200, "application/json", '{"a": "é/"}');
	const c = capture();
	assert.equal(await main([...BASE, "-m", "POST", "-b", '{"x": 1}', "/things"], api, c.io), 0);
	assert.deepEqual(calls, [["POST", "https://api.realo.com/1.0/things", '{"x":1}']]);
	assert.deepEqual(JSON.parse(c.out()), { a: "é/" });
});

test("non-JSON needs --force", async () => {
	const { api } = apiFor(200, "image/png", "BIN");
	let c = capture();
	assert.equal(await main([...BASE, "/x"], api, c.io), 0);
	assert.equal(c.out(), "");
	assert.match(c.err(), /-f/);
	c = capture();
	assert.equal(await main([...BASE, "-f", "/x"], api, c.io), 0);
	assert.equal(c.out(), "BIN");
});

test("error with errors prints them on stdout", async () => {
	const { api } = apiFor(400, "application/json", '{"errors":[{"type":"T","message":"m"}]}');
	const c = capture();
	assert.equal(await main([...BASE, "/x"], api, c.io), 1);
	assert.deepEqual(JSON.parse(c.out()), { errors: [{ type: "T", message: "m" }] });
});

test("error without errors prints on stderr", async () => {
	const { api } = apiFor(500, "text/plain", "boom");
	const c = capture();
	assert.equal(await main([...BASE, "/x"], api, c.io), 1);
	assert.match(c.err(), /^Error 500: /);
});

test("invalid body and environment", async () => {
	const c = capture();
	assert.equal(await main([...BASE, "-b", "{bad", "/x"], undefined, c.io), 1);
	assert.equal(await main([...BASE, "-e", "nope", "/x"], undefined, c.io), 1);
	assert.match(c.err(), /production, sandbox/);
});

test("missing args and unknown options exit 2", async () => {
	const c = capture();
	assert.equal(await main(["/x"], undefined, c.io), 2);
	assert.equal(await main([...BASE, "--nope", "/x"], undefined, c.io), 2);
	assert.match(c.err(), /Usage:/);
});

test("bin runs as a process", () => {
	assert.match(execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }), /Usage: realo-api/);
	const r = spawnSync(process.execPath, [CLI, "/x"], { encoding: "utf8" });
	assert.equal(r.status, 2);
});
