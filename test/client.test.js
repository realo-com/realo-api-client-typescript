import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_USER_AGENT, RealoApi, RealoApiException } from "../dist/index.js";

// Same vectors as the Python client, generated with the OpenSSL CLI:
//   printf '<base string>' | openssl dgst -sha256 -hmac secret -binary | base64
// which is exactly PHP's base64_encode(hash_hmac('sha256', $base, $key, true)).
const GET_SIG = "/7DN6s0o9ArdMT5Rfud4VSf0IbfAEIfb9/ekJD90mBM=";
const POST_SIG = "F2u5RYPhFW6asRMNls0cZ2lTbJ8vZgf6M46+zQ003Yg=";

const enc = (s) => new TextEncoder().encode(s);

function fake({ status = 200, contentType = "application/json", body = enc("{}") } = {}) {
	const calls = [];
	const transport = async (req) => {
		calls.push(req);
		return { status, headers: { "Content-Type": contentType }, body };
	};
	return { transport, calls };
}

function make(opts) {
	const t = fake(opts);
	return { api: RealoApi.createWithTransport("pub", "secret", t.transport), calls: t.calls };
}

test("GET without body: url, signature and headers", async () => {
	const { api, calls } = make();
	assert.deepEqual(await api.request("/agencies"), {});
	const { method, url, headers, body } = calls[0];
	assert.deepEqual([method, url, body], ["GET", "https://api.realo.com/1.0/agencies", null]);
	assert.equal(headers.Authorization, `Realo key="pub", version="1.0", signature="${GET_SIG}"`);
	assert.equal(headers["Content-Type"], "application/json");
	assert.equal(headers["User-Agent"], DEFAULT_USER_AGENT);
	assert.match(DEFAULT_USER_AGENT, /^RealoApiClient-TypeScript\//);
});

test("POST with body signs the exact sent body; custom headers pass through", async () => {
	const { api, calls } = make();
	await api.request("agencies", "post", { a: 1 }, { "X-Custom": "1" });
	const { method, headers, body } = calls[0];
	assert.equal(method, "POST");
	assert.equal(body, '{"a":1}');
	assert.ok(headers.Authorization.endsWith(`signature="${POST_SIG}"`));
	assert.equal(headers["X-Custom"], "1");
});

test("custom headers cannot override Content-Type or Authorization", async () => {
	const { api, calls } = make();
	await api.request("x", "GET", undefined, {
		Authorization: "bad",
		"Content-Type": "text/plain",
		authorization: "bad",
		"content-type": "text/plain",
	});
	const keys = Object.keys(calls[0].headers).map((k) => k.toLowerCase());
	assert.equal(keys.filter((k) => k === "authorization").length, 1);
	assert.equal(keys.filter((k) => k === "content-type").length, 1);
	assert.equal(calls[0].headers["Content-Type"], "application/json");
	assert.ok(calls[0].headers.Authorization.startsWith('Realo key="pub"'));
});

test("signature matches the sent body with unicode", async () => {
	const { api, calls } = make();
	await api.request("x", "POST", { name: "Zoë/é" });
	const { url, headers, body } = calls[0];
	assert.equal(api.sign("POST", url, body), headers.Authorization);
	assert.deepEqual(JSON.parse(body), { name: "Zoë/é" });
});

test("sandbox environment", async () => {
	const t = fake();
	const api = RealoApi.createWithTransport("p", "s", t.transport, "sandbox");
	await api.request("/a");
	assert.equal(t.calls[0].url, "https://api-sandbox.realo.com/1.0/a");
});

test("invalid environment", () => {
	assert.throws(() => RealoApi.create("p", "s", "nope"), /production, sandbox/);
	assert.throws(() => RealoApi.create("p", "s", "toString"), TypeError);
});

test("private key is not exposed on the instance", () => {
	const api = RealoApi.create("pub", "secret");
	assert.ok(!JSON.stringify(api).includes("secret"));
	assert.ok(!Object.values(api).includes("secret"));
});

test("JSON response parsed", async () => {
	const { api } = make({ contentType: "application/json; charset=utf-8", body: enc('{"data": [1]}') });
	assert.deepEqual(await api.request("a"), { data: [1] });
});

test("non-JSON response returned as bytes", async () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
	const { api } = make({ contentType: "image/png", body: png });
	assert.deepEqual(await api.request("a"), png);
});

test("invalid JSON in a 200 response", async () => {
	const { api } = make({ body: enc("not json") });
	await assert.rejects(api.request("a"), (e) => e instanceof RealoApiException && e.code === 200);
});

test("error with errors body", async () => {
	const { api } = make({ status: 404, body: enc(JSON.stringify({ errors: [{ type: "NotFound", message: "nope" }] })) });
	await assert.rejects(api.request("a"), (e) => {
		assert.ok(e instanceof RealoApiException);
		assert.equal(e.code, 404);
		assert.equal(e.type, "NotFound");
		assert.deepEqual(e.errors, [{ type: "NotFound", message: "nope" }]);
		assert.equal(e.message, "NotFound: nope");
		return true;
	});
});

for (const raw of ["{}", '{"errors": []}', "not json", ""]) {
	test(`error without usable errors: ${JSON.stringify(raw)}`, async () => {
		const { api } = make({ status: 500, body: enc(raw) });
		await assert.rejects(api.request("a"), (e) => {
			assert.equal(e.code, 500);
			assert.ok(!e.errors?.length);
			assert.equal(e.type, null);
			assert.equal(e.message, "HTTP error 500");
			return true;
		});
	});
}

test("error with only a message has no type prefix", async () => {
	const { api } = make({ status: 400, body: enc('{"errors":[{"message":"bad input"}]}') });
	await assert.rejects(api.request("a"), (e) => e.message === "bad input" && e.type === null);
});

test("error with non-JSON content type", async () => {
	const { api } = make({ status: 502, contentType: "text/html", body: enc("<html>") });
	await assert.rejects(api.request("a"), (e) => e.errors === null && e.code === 502);
});

test("transport error", async () => {
	const api = RealoApi.createWithTransport("p", "s", async () => {
		throw new Error("down");
	});
	await assert.rejects(api.request("a"), (e) => {
		assert.ok(e instanceof RealoApiException);
		assert.match(e.message, /down/);
		assert.equal(e.code, 0);
		assert.equal(e.errors, null);
		return true;
	});
});
