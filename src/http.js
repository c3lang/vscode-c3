const USER_AGENT = "vscode-c3";

// Thin wrappers over the global `fetch` (Node 18+). Replaces axios so the bundle
// never touches the `navigator` global, which crashes on newer VSCode/VSCodium
// (Node 22). See https://github.com/c3lang/vscode-c3/issues/48
//
// A User-Agent is set explicitly because the GitHub API rejects requests without
// one. `fetch` follows redirects automatically (release downloads go via a CDN).

/** GET a URL and parse the response body as JSON. */
export async function getJson(url, headers = {}) {
	const res = await fetch(url, {
		headers: { "User-Agent": USER_AGENT, ...headers },
	});
	if (!res.ok) {
		throw new Error(`Request to ${url} failed with status ${res.status}`);
	}
	return res.json();
}

/**
 * GET a URL and return the response body as a Buffer.
 * `onProgress` receives `{ received, total, chunk }` for each chunk read
 * (`total` is 0 when the server doesn't send a Content-Length).
 */
export async function getBuffer(url, { headers = {}, onProgress } = {}) {
	const res = await fetch(url, {
		headers: { "User-Agent": USER_AGENT, ...headers },
	});
	if (!res.ok) {
		throw new Error(`Request to ${url} failed with status ${res.status}`);
	}

	if (!onProgress || !res.body) {
		return Buffer.from(await res.arrayBuffer());
	}

	const total = Number(res.headers.get("content-length")) || 0;
	let received = 0;
	const chunks = [];
	for await (const chunk of res.body) {
		chunks.push(chunk);
		received += chunk.length;
		onProgress({ received, total, chunk: chunk.length });
	}
	return Buffer.concat(chunks);
}
