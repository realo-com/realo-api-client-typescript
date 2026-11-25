import { createHmac } from "node:crypto";
import { RealoApiException } from "./exceptions.js";

export const VERSION = "1.0.0";
export const DEFAULT_USER_AGENT = `RealoApiClient-TypeScript/${VERSION}`;

export const PRODUCTION_ENVIRONMENT = "production";
export const SANDBOX_ENVIRONMENT = "sandbox";

export const ENVIRONMENTS = {
	[PRODUCTION_ENVIRONMENT]: "https://api.realo.com/1.0/",
	[SANDBOX_ENVIRONMENT]: "https://api-sandbox.realo.com/1.0/",
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

/** One request as handed to a transport. */
export interface TransportRequest {
	method: string;
	url: string;
	headers: Record<string, string>;
	/** The JSON request body exactly as signed, or `null` when there is none. */
	body: string | null;
}

/** What a transport returns. A status >= 400 is not an error at this level. */
export interface TransportResponse {
	status: number;
	headers: Record<string, string>;
	body: Uint8Array;
}

/** Sends one request. May throw (reject) for connection problems. */
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** Default transport built on the global `fetch` (Node 18+, no dependencies). */
export const fetchTransport: Transport = async ({ method, url, headers, body }) => {
	const response = await fetch(url, { method, headers, body: body ?? undefined });
	const responseHeaders: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		responseHeaders[key.toLowerCase()] = value;
	});
	return {
		status: response.status,
		headers: responseHeaders,
		body: new Uint8Array(await response.arrayBuffer()),
	};
};

/**
 * Client for the Realo REST API. Build it with {@link RealoApi.create} or
 * {@link RealoApi.createWithTransport}.
 */
export class RealoApi {
	readonly publicKey: string;
	readonly baseUrl: string;
	readonly #privateKey: string;
	readonly #transport: Transport;

	protected constructor(publicKey: string, privateKey: string, baseUrl: string, transport: Transport) {
		this.publicKey = publicKey;
		this.#privateKey = privateKey;
		this.baseUrl = baseUrl;
		this.#transport = transport;
	}

	/** Throws a `TypeError` for an environment other than `production` or `sandbox`. */
	static create(publicKey: string, privateKey: string, environment: string = PRODUCTION_ENVIRONMENT): RealoApi {
		return RealoApi.createWithTransport(publicKey, privateKey, fetchTransport, environment);
	}

	/** Like {@link RealoApi.create} but sends requests through your own transport (a proxy, a test fake). */
	static createWithTransport(
		publicKey: string,
		privateKey: string,
		transport: Transport,
		environment: string = PRODUCTION_ENVIRONMENT,
	): RealoApi {
		if (!Object.hasOwn(ENVIRONMENTS, environment)) {
			throw new TypeError(
				`Unsupported environment '${environment}', please use any of [${Object.keys(ENVIRONMENTS).join(", ")}]`,
			);
		}
		return new RealoApi(publicKey, privateKey, ENVIRONMENTS[environment as Environment], transport);
	}

	/** Returns the Authorization header value for a request. */
	sign(method: string, url: string, body = ""): string {
		const baseString = `${method.toUpperCase()}&${url}&${body}`;
		const signature = createHmac("sha256", this.#privateKey).update(baseString, "utf8").digest("base64");
		return `Realo key="${this.publicKey}", version="1.0", signature="${signature}"`;
	}

	/**
	 * Sends a signed request.
	 *
	 * Resolves to the parsed JSON when the response Content-Type starts with
	 * `application/json`, otherwise to the raw response body as a `Uint8Array`.
	 * Rejects with {@link RealoApiException} on status >= 400 or transport errors.
	 */
	async request<T = unknown>(
		path: string,
		method = "GET",
		payload?: unknown,
		headers: Record<string, string> = {},
	): Promise<T | Uint8Array> {
		const upperMethod = method.toUpperCase();
		const url = this.baseUrl + path.replace(/^\/+/, "");
		const body = payload === undefined || payload === null ? null : JSON.stringify(payload);

		const allHeaders: Record<string, string> = {
			"User-Agent": DEFAULT_USER_AGENT,
			...withoutReservedHeaders(headers),
			"Content-Type": "application/json",
			Authorization: this.sign(upperMethod, url, body ?? ""),
		};

		let response: TransportResponse;
		try {
			response = await this.#transport({ method: upperMethod, url, headers: allHeaders, body });
		} catch (e) {
			throw new RealoApiException(e instanceof Error ? e.message : String(e), { cause: e });
		}

		const contentType = headerValue(response.headers, "content-type");
		if (response.status >= 400) {
			throw RealoApiException.fromResponse(
				response.status,
				contentType,
				response.body,
				`HTTP error ${response.status}`,
			);
		}
		if (contentType?.startsWith("application/json")) {
			try {
				return JSON.parse(new TextDecoder().decode(response.body)) as T;
			} catch (e) {
				throw new RealoApiException(`Invalid JSON in response: ${(e as Error).message}`, {
					code: response.status,
					cause: e,
				});
			}
		}
		return response.body;
	}
}

const RESERVED_HEADERS = new Set(["authorization", "content-type"]);

/** Drops caller headers the client sets itself, whatever their case, so none is sent twice. */
function withoutReservedHeaders(headers: Record<string, string>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).filter(([key]) => !RESERVED_HEADERS.has(key.toLowerCase())));
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) return value;
	}
	return undefined;
}
