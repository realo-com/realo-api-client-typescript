/** One entry of the `errors` list in a JSON error body. */
export interface RealoApiError {
	type?: string;
	message?: string;
	[key: string]: unknown;
}

export interface RealoApiExceptionOptions {
	code?: number;
	errors?: unknown[] | null;
	type?: string | null;
	cause?: unknown;
}

/** Thrown when a request fails or the server answers with a status >= 400. */
export class RealoApiException extends Error {
	/** HTTP status code (0 when no response was received). */
	readonly code: number;
	/** The `errors` list of a JSON error body, otherwise `null`. */
	readonly errors: unknown[] | null;
	/** `errors[0].type` when present, otherwise `null`. */
	readonly type: string | null;

	constructor(message: string, options: RealoApiExceptionOptions = {}) {
		super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
		this.name = "RealoApiException";
		this.code = options.code ?? 0;
		this.errors = options.errors ?? null;
		this.type = options.type ?? null;
	}

	static fromResponse(
		code: number,
		contentType: string | undefined,
		body: Uint8Array,
		defaultMessage: string,
	): RealoApiException {
		let errors: unknown[] | null = null;
		if (contentType?.startsWith("application/json")) {
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(new TextDecoder().decode(body));
			} catch {
				parsed = null;
			}
			if (isRecord(parsed) && Array.isArray(parsed.errors)) {
				errors = parsed.errors;
			}
		}

		let type: string | null = null;
		let message = defaultMessage;
		const first = errors?.[0];
		if (isRecord(first)) {
			type = typeof first.type === "string" ? first.type : null;
			const parts = [type, typeof first.message === "string" ? first.message : null].filter(Boolean);
			if (parts.length > 0) {
				message = parts.join(": ");
			}
		}
		return new RealoApiException(message, { code, errors, type });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
