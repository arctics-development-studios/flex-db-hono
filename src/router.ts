/**
 * # Namespace Router Factory
 *
 * {@link createNamespaceRouter} builds a complete Hono sub-router that exposes
 * all FlexDB CRUD, search, and (optionally) bulk operations for a single namespace.
 * Mount the result on your app with `app.route()`.
 *
 * @module
 */

import { Hono } from "hono";
import type { FlexDbEnv, FlexDbRouterOptions } from "./types.ts";
import {
  flexDbGet,
  flexDbSet,
  flexDbCreate,
  flexDbDelete,
  flexDbList,
  flexDbSearch,
  flexDbBulkGet,
  flexDbBulkSet,
  flexDbBulkCreate,
  flexDbBulkDelete,
} from "./handlers.ts";

/**
 * Builds a complete Hono sub-router that exposes all FlexDB CRUD, search,
 * and optionally bulk operations for a single namespace.
 *
 * Mount the returned router on your app with `app.route(prefix, router)`.
 * The router does **not** create or hold a FlexDB client — it inherits the
 * one injected by the {@link flexDb} middleware on the parent app.
 *
 * ## Mounted routes (defaults)
 *
 * | Method   | Path           | Operation                          |
 * |----------|----------------|------------------------------------|
 * | `GET`    | `/`            | List keys (+ optional hydration)   |
 * | `POST`   | `/`            | Create with a server-generated key |
 * | `GET`    | `/:key`        | Retrieve single object             |
 * | `PUT`    | `/:key`        | Create or replace object           |
 * | `DELETE` | `/:key`        | Remove object (idempotent)         |
 * | `POST`   | `/search`      | Search by indexed `sp` fields      |
 *
 * When `enableBulk: true` is set, four additional routes are mounted:
 *
 * | Method   | Path           | Operation                          |
 * |----------|----------------|------------------------------------|
 * | `POST`   | `/bulk/get`    | Fetch multiple objects             |
 * | `POST`   | `/bulk/set`    | Create or replace multiple objects |
 * | `POST`   | `/bulk/create` | Create multiple (generated keys)   |
 * | `POST`   | `/bulk/delete` | Delete multiple objects            |
 *
 * ## Write-buffer visibility lag
 *
 * `GET /` (list) and `POST /search` query DynamoDB metadata, which is updated
 * ~60 seconds after each write. `GET /:key` reads from L1/L2 and is always
 * up-to-date. Document this in your own API layer where appropriate.
 *
 * @template T - Shape of objects stored in this namespace. Flows through to
 *   all handler factories for better IDE type inference.
 * @param ns - The FlexDB namespace all mounted routes operate on.
 * @param options - Fine-grained route toggles and shared options.
 *   See {@link FlexDbRouterOptions} for the full list.
 * @returns A `Hono<FlexDbEnv>` sub-router ready to pass to `app.route()`.
 *
 * @example Minimal CRUD — mount and go
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, createNamespaceRouter } from "@arctics/flex-db-hono";
 *
 * interface Product { name: string; price: number }
 *
 * const app = new Hono();
 * app.use(flexDb({ apiKey: Deno.env.get("FLEXDB_KEY")!, baseUrl: "https://..." }));
 *
 * // Mounts GET/PUT/DELETE /:key, POST /, GET /, POST /search
 * app.route("/products", createNamespaceRouter<Product>("products"));
 *
 * Deno.serve(app.fetch);
 * ```
 *
 * @example With bulk routes and a custom limit
 * ```ts
 * const orders = createNamespaceRouter<Order>("orders", {
 *   enableBulk:   true,
 *   defaultLimit: 25,
 * });
 * app.route("/orders", orders);
 * ```
 *
 * @example Read-only public catalog
 * ```ts
 * const catalog = createNamespaceRouter<Product>("products", {
 *   enableSet:    false,
 *   enableCreate: false,
 *   enableDelete: false,
 * });
 * app.route("/catalog", catalog);
 * ```
 *
 * @example Custom key parameter name
 * ```ts
 * // Routes become GET /:id, PUT /:id, DELETE /:id instead of /:key
 * const users = createNamespaceRouter<User>("users", { keyParam: "id" });
 * app.route("/users", users);
 * ```
 *
 * @example Shared error handler across all routes
 * ```ts
 * import { FlexDBError } from "@arctics/flex-db-hono";
 *
 * const products = createNamespaceRouter<Product>("products", {
 *   onError: (err, c) => {
 *     if (err instanceof FlexDBError) {
 *       return c.json({ error: err.code }, err.status as never);
 *     }
 *     return c.json({ error: "ERR_INTERNAL" }, 500);
 *   },
 * });
 * app.route("/products", products);
 * ```
 */
export function createNamespaceRouter<T = unknown>(
  ns: string,
  options?: FlexDbRouterOptions<T>,
): Hono<FlexDbEnv> {
  const {
    enableGet    = true,
    enableSet    = true,
    enableCreate = true,
    enableDelete = true,
    enableList   = true,
    enableSearch = true,
    enableBulk   = false,
    keyParam     = "key",
    defaultLimit,
    onError,
  } = options ?? {};

  const router = new Hono<FlexDbEnv>();
  const shared = { onError };

  // Register exact paths before parameterised ones so Hono's router gives them
  // higher priority and /:key does not swallow POST /search or GET /.
  if (enableList)   router.get("/",        flexDbList<T>(ns, { defaultLimit, ...shared }));
  if (enableCreate) router.post("/",       flexDbCreate<T>(ns, shared));
  if (enableSearch) router.post("/search", flexDbSearch<T>(ns, shared));

  if (enableBulk) {
    router.post("/bulk/get",    flexDbBulkGet<T>(ns, shared));
    router.post("/bulk/set",    flexDbBulkSet<T>(ns, shared));
    router.post("/bulk/create", flexDbBulkCreate<T>(ns, shared));
    router.post("/bulk/delete", flexDbBulkDelete(ns, shared));
  }

  // Parameterised routes last — matched only when no exact path took over.
  if (enableGet)    router.get(`/:${keyParam}`,    flexDbGet<T>(ns, { keyParam, ...shared }));
  if (enableSet)    router.put(`/:${keyParam}`,    flexDbSet<T>(ns, { keyParam, ...shared }));
  if (enableDelete) router.delete(`/:${keyParam}`, flexDbDelete(ns, { keyParam, ...shared }));

  return router;
}
