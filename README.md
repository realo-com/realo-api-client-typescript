# Realo API TypeScript Library

The official TypeScript/JavaScript library for using [the Realo REST API](https://api.realo.com/docs).

Before using this library, you must have a valid API Key. To get an API Key, please contact your Realo customer success manager.

Also available for [PHP](https://github.com/realo-com/realo-api-client-php), [Python](https://github.com/realo-com/realo-api-client-python) and [C#](https://github.com/realo-com/realo-api-client-csharp).

Requires Node.js 18+. No runtime dependencies (uses the built-in `fetch` and `node:crypto`). Ships as an ES module with type declarations. Server-side only: requests are signed with your private key, which must never reach a browser.

## Installation

The package is not on npm yet; install it straight from GitHub (npm builds `dist/` on install through the `prepare` script):

```bash
npm install github:realo-com/realo-api-client-typescript
```

## Initialization
#### RealoApi.create(publicKey, privateKey, environment)
* `publicKey` (`string`): API public key
* `privateKey` (`string`): API private key
* `environment` (`string`, default `production`): either `production` or `sandbox`. Anything else throws a `TypeError`.

#### RealoApi.createWithTransport(publicKey, privateKey, transport, environment)
Same as `create`, but requests are sent through your own `transport`, an async function
`({ method, url, headers, body }) => Promise<{ status, headers, body: Uint8Array }>`. Use it to proxy requests, add timeouts or retries, or to test without network.

## Methods
### request(path, method = "GET", payload?, headers = {})
* `path` (`string`): the path of the resource
* `method` (`string`): HTTP method
* `payload` (JSON-serializable, optional): request body, encoded as JSON
* `headers` (`Record<string, string>`, optional): custom headers

Resolves to the parsed JSON when the response `Content-Type` starts with `application/json`, otherwise to the raw body as a `Uint8Array`. Pass a type argument to type the JSON: `api.request<{ data: Agency[] }>("/agencies")` resolves to `{ data: Agency[] } | Uint8Array`; narrow with `instanceof Uint8Array` before reading it.

## Examples

### Use The Bundled CLI Tool
```bash
$ npx realo-api --public-key=xxx --private-key=xxx /valuations/xxx/data/mobility
{
    "data": {
        "mobilityScore": 0.88,
        "distanceToCityCenter": 3130
    }
}
```

Options: `-m/--http-method`, `-b/--http-body` (JSON), `-f/--force` (print non-JSON responses), `-e/--environment`. Exit code is 1 on errors, 2 on wrong usage.

### Send An API Call Using The Request Function
```ts
import { RealoApi, RealoApiException } from "@realo/api-client";

const api = RealoApi.create("YOUR_PUBLIC_KEY", "YOUR_PRIVATE_KEY");
try {
	const response = await api.request("/agencies", "GET");
	console.log(response);
} catch (e) {
	if (e instanceof RealoApiException) {
		console.error(`Error ${e.code}: ${e.message}`);
	} else {
		throw e;
	}
}
```

## Exceptions
`RealoApiException` is thrown when there is a problem with the request or the server returns a status code of `400` or higher.

* `code`: the HTTP status code (`0` when no response was received)
* `message`: `"<type>: <message>"` of the first error when available
* `errors`: the list of errors from a JSON response body, otherwise `null`
* `type`: the type of the first error, otherwise `null`
* `cause`: the underlying error for transport and JSON parse failures

## Development

```bash
npm install
npm test   # builds with tsc, then runs node --test
```

## License
MIT
