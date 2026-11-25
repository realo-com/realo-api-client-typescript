#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ENVIRONMENTS, PRODUCTION_ENVIRONMENT, RealoApi } from "./client.js";
import { RealoApiException } from "./exceptions.js";

export interface CliIo {
	stdout: (chunk: string | Uint8Array) => void;
	stderr: (chunk: string) => void;
}

const defaultIo: CliIo = {
	stdout: (chunk) => process.stdout.write(chunk),
	stderr: (chunk) => process.stderr.write(chunk),
};

const USAGE =
	"Usage: realo-api --public-key=KEY --private-key=KEY [-m METHOD] [-b JSON] [-f] [-e ENV] PATH\n";

function dump(data: unknown): string {
	return JSON.stringify(data, null, 4) + "\n";
}

/**
 * Runs the CLI and resolves to the exit code (0 ok, 1 error, 2 usage).
 * `api` lets tests inject a client, `io` captures output.
 */
export async function main(argv: string[], api?: RealoApi, io: CliIo = defaultIo): Promise<number> {
	let values;
	let positionals;
	try {
		({ values, positionals } = parseArgs({
			args: argv,
			allowPositionals: true,
			options: {
				"public-key": { type: "string" },
				"private-key": { type: "string" },
				"http-method": { type: "string", short: "m", default: "GET" },
				"http-body": { type: "string", short: "b" },
				force: { type: "boolean", short: "f", default: false },
				environment: { type: "string", short: "e", default: PRODUCTION_ENVIRONMENT },
				help: { type: "boolean", short: "h", default: false },
			},
		}));
	} catch (e) {
		io.stderr(`${(e as Error).message}\n${USAGE}`);
		return 2;
	}

	if (values.help) {
		io.stdout(USAGE + `Environments: ${Object.keys(ENVIRONMENTS).join(", ")}\n`);
		return 0;
	}
	const publicKey = values["public-key"];
	const privateKey = values["private-key"];
	if (!publicKey || !privateKey || positionals.length !== 1) {
		io.stderr(USAGE);
		return 2;
	}

	let body: unknown;
	if (values["http-body"] !== undefined) {
		try {
			body = JSON.parse(values["http-body"]);
		} catch (e) {
			io.stderr(`Invalid JSON body given: ${(e as Error).message}\n`);
			return 1;
		}
	}

	if (!api) {
		try {
			api = RealoApi.create(publicKey, privateKey, values.environment);
		} catch (e) {
			io.stderr(`${(e as Error).message}\n`);
			return 1;
		}
	}

	let response: unknown;
	try {
		response = await api.request(positionals[0], values["http-method"], body);
	} catch (e) {
		if (e instanceof RealoApiException) {
			if (e.errors !== null) {
				io.stdout(dump({ errors: e.errors }));
			} else {
				io.stderr(`Error ${e.code}: ${e.message}\n`);
			}
			return 1;
		}
		throw e;
	}

	if (response instanceof Uint8Array) {
		if (values.force) {
			io.stdout(response);
		} else {
			io.stderr(
				"Warning: the response is probably binary data, if you do want to continue re-run this command with -f.\n",
			);
		}
		return 0;
	}
	io.stdout(dump(response));
	return 0;
}

function isEntryPoint(): boolean {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
}

if (isEntryPoint()) {
	main(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}
