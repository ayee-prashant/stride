import { request as httpRequest } from "node:http";

/**
 * Probe an agent denial through an HTTP listener using its canonical authority.
 * Node's fetch does not preserve a supplied Host header. This probe sends only
 * a deliberately invalid token, never the human verification session.
 * @param {URL} target Already validated private destination (loopback in tests).
 * @param {string} origin Canonical application origin.
 * @param {"/mcp" | "/api/agent-companion"} path
 * @returns {Promise<{status: number, headers: Headers}>}
 */
export function probeAgentHttp(target, origin, path) {
  if (target.protocol !== "http:" || target.username || target.password || !["/mcp", "/api/agent-companion"].includes(path)) throw new Error("Invalid private probe destination");
  const method = path === "/mcp" ? "POST" : "GET";
  return new Promise((resolve, reject) => {
    const request = httpRequest(new URL(path, target), {
      method, agent: false, signal: AbortSignal.timeout(10000),
      headers: {
        host: new URL(origin).host, origin,
        authorization: "Bearer invalid-release-verification",
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
    }, response => {
      const headers = new Headers();
      for (const [name, values] of Object.entries(response.headers)) {
        for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values]) headers.append(name, value);
      }
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > 32768) request.destroy(new Error("Probe response exceeds its bound"));
      });
      response.once("error", reject);
      response.once("aborted", () => reject(new Error("Probe response was interrupted")));
      response.once("end", () => resolve({ status: response.statusCode ?? 0, headers }));
    });
    request.once("error", reject);
    request.end(method === "POST" ? "{}" : undefined);
  });
}
