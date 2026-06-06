/**
 * # Middleware
 *
 * The {@link flexDb} middleware is the entry point for the FlexDB Hono SDK.
 * It creates a single {@link FlexDBClient} per application startup and injects
 * it into the Hono context as `c.var.flexDb` for every downstream handler.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb } from "@arctics/flex-db-hono";
 *
 * const app = new Hono();
 * app.use(flexDb({ apiKey: Deno.env.get("FLEXDB_KEY")!, baseUrl: "https://..." }));
 * ```
 *
 * @module
 */

import type { MiddlewareHandler } from "hono";
import { FlexDBClient } from "@arctics/flex-db-sdk";
import type { FlexDbMiddlewareOptions, FlexDbEnv } from "./types.ts";

/**
 * Hono middleware that creates a {@link FlexDBClient} and injects it into the
 * request context as `c.var.flexDb`.
 *
 * The client is instantiated **once** when the middleware factory is called —
 * not on every request. This means the HTTP connection pool, retry config, and
 * authentication header are shared efficiently across all requests, exactly like
 * a module-level singleton.
 *
 * Mount this middleware before any FlexDB handler factories or calls to
 * {@link getFlexDB}. You can scope it to the whole app or to a specific route group.
 *
 * ## Application-level (recommended for most apps)
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, flexDbGet, flexDbCreate } from "@arctics/flex-db-hono";
 *
 * const app = new Hono();
 *
 * app.use(flexDb({
 *   apiKey:  Deno.env.get("FLEXDB_KEY")!,
 *   baseUrl: "https://eu.flex.arctics.dev",
 * }));
 *
 * app.get("/products/:key", flexDbGet("products"));
 * app.post("/products",     flexDbCreate("products"));
 *
 * Deno.serve(app.fetch);
 * ```
 *
 * ## Route-group scoping
 *
 * ```ts
 * const api = new Hono();
 * api.use(flexDb({ apiKey: "...", baseUrl: "..." }));
 * api.get("/:key", flexDbGet("users"));
 * api.post("/",    flexDbCreate("users"));
 *
 * app.route("/api/users", api);
 * ```
 *
 * ## With default namespace and disabled retries
 *
 * ```ts
 * app.use(flexDb({
 *   apiKey:    Deno.env.get("FLEXDB_KEY")!,
 *   baseUrl:   "https://eu.flex.arctics.dev",
 *   namespace: "global-default",
 *   retry:     import.meta.env?.DEV ? false : { times: 3, delay: 10 },
 * }));
 * ```
 *
 * @param options - Client configuration. All {@link FlexDBClientOptions} fields are accepted.
 * @returns A Hono middleware handler that sets `flexDb` on `c.var` for every request.
 */
export function flexDb(options: FlexDbMiddlewareOptions): MiddlewareHandler<FlexDbEnv> {
  const client = new FlexDBClient(options);

  return async function flexDbMiddleware(c, next) {
    c.set("flexDb", client);
    await next();
  };
}
