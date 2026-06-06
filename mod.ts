/**
 * # FlexDB Hono SDK
 *
 * Hono middleware, handler factories, and a namespace router for **FlexDB** —
 * a high-performance distributed key-value store with automatic storage tiering.
 * Built as a thin Hono layer over
 * {@link https://jsr.io/@arctics/flex-db-sdk | @arctics/flex-db-sdk}.
 *
 * ## Installation
 *
 * ```jsonc
 * // deno.json
 * {
 *   "imports": {
 *     "@arctics/flex-db-hono": "jsr:@arctics/flex-db-hono@^2.6.0",
 *     "hono": "npm:hono@^4"
 *   }
 * }
 * ```
 *
 * ## Quick start — full CRUD in four lines
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, createNamespaceRouter } from "@arctics/flex-db-hono";
 *
 * interface Product { name: string; price: number }
 *
 * const app = new Hono();
 *
 * // 1. Mount the middleware once — creates the FlexDB client
 * app.use(flexDb({
 *   apiKey:  Deno.env.get("FLEXDB_KEY")!,
 *   baseUrl: "https://eu.flex.arctics.dev",
 * }));
 *
 * // 2. Mount a namespace router — six REST endpoints, zero boilerplate
 * app.route("/products", createNamespaceRouter<Product>("products"));
 * //   GET /products           → list keys
 * //   POST /products          → create (server-generated key)
 * //   GET /products/:key      → get by key
 * //   PUT /products/:key      → set (create or replace)
 * //   DELETE /products/:key   → delete
 * //   POST /products/search   → search by sp fields
 *
 * Deno.serve(app.fetch);
 * ```
 *
 * ## Cherry-picking individual handlers
 *
 * ```ts
 * import { Hono } from "hono";
 * import {
 *   flexDb,
 *   flexDbGet, flexDbCreate, flexDbSet, flexDbDelete,
 *   flexDbList, flexDbSearch,
 * } from "@arctics/flex-db-hono";
 *
 * const app = new Hono();
 * app.use(flexDb({ apiKey: "...", baseUrl: "..." }));
 *
 * app.get("/users/:key",    flexDbGet<User>("users"));
 * app.post("/users",        flexDbCreate<User>("users"));
 * app.put("/users/:key",    flexDbSet<User>("users"));
 * app.delete("/users/:key", flexDbDelete("users"));
 * app.get("/users",         flexDbList<User>("users"));
 * app.post("/users/search", flexDbSearch<User>("users"));
 * ```
 *
 * ## Bulk operations
 *
 * Bulk routes are disabled by default in {@link createNamespaceRouter} because they
 * expose powerful batch writes and typically require additional authorization.
 * Enable them explicitly or mount them individually:
 *
 * ```ts
 * // Via router option:
 * app.route("/orders", createNamespaceRouter<Order>("orders", { enableBulk: true }));
 *
 * // Or individually:
 * app.post("/orders/bulk/get",    flexDbBulkGet<Order>("orders"));
 * app.post("/orders/bulk/set",    flexDbBulkSet<Order>("orders"));
 * app.post("/orders/bulk/create", flexDbBulkCreate<Order>("orders"));
 * app.post("/orders/bulk/delete", flexDbBulkDelete("orders"));
 * ```
 *
 * ## Custom (imperative) handlers — escape hatch
 *
 * ```ts
 * import { getFlexDB, getNamespace, type FlexDbEnv } from "@arctics/flex-db-hono";
 *
 * const app = new Hono<FlexDbEnv>();
 * app.use(flexDb({ apiKey: "...", baseUrl: "..." }));
 *
 * // Multi-step atomic operation
 * app.post("/transfer/:from/:to", async (c) => {
 *   const items = getNamespace(c, "inventory");
 *   const { data } = await items.get(c.req.param("from"));
 *   await items.set(c.req.param("to"), data);
 *   await items.delete(c.req.param("from"));
 *   return c.json({ ok: true });
 * });
 * ```
 *
 * ## Type-safe context
 *
 * Use {@link FlexDbEnv} directly when no additional context variables are needed.
 * Merge {@link FlexDbVariables} into your own env type when you do:
 *
 * ```ts
 * import { type FlexDbEnv, type FlexDbVariables } from "@arctics/flex-db-hono";
 *
 * // Simple case — FlexDB only
 * const app = new Hono<FlexDbEnv>();
 *
 * // Extended case — FlexDB + your own variables
 * type AppEnv = {
 *   Variables: FlexDbVariables & { currentUser: User };
 * };
 * const app2 = new Hono<AppEnv>();
 * ```
 *
 * ## Custom error handling
 *
 * Every handler factory accepts an `onError` callback that completely replaces
 * the default error mapping:
 *
 * ```ts
 * import { FlexDBError } from "@arctics/flex-db-hono";
 *
 * app.get("/products/:key", flexDbGet<Product>("products", {
 *   onError: (err, c) => {
 *     if (err instanceof FlexDBError && err.code === "ERR_NOT_FOUND") {
 *       return c.json({ message: "Product not found" }, 404);
 *     }
 *     return c.json({ message: "Unexpected server error" }, 500);
 *   },
 * }));
 * ```
 *
 * Share one `onError` across an entire namespace router:
 *
 * ```ts
 * app.route("/products", createNamespaceRouter<Product>("products", {
 *   onError: myErrorHandler,
 * }));
 * ```
 *
 * ## Write-buffer visibility lag
 *
 * Newly written objects are **immediately readable** via `GET /:key` but may
 * not appear in `GET /` (list) or `POST /search` results for up to ~60 seconds
 * while the FlexDB write-buffer flushes to DynamoDB. This is intentional
 * server-side behaviour — document it in your own API as needed.
 *
 * @module
 */

// ── Middleware ─────────────────────────────────────────────────────────────
export { flexDb } from "./src/middleware.ts";

// ── Context helpers ────────────────────────────────────────────────────────
export { getFlexDB, getNamespace } from "./src/context.ts";

// ── Handler factories ──────────────────────────────────────────────────────
export {
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
} from "./src/handlers.ts";

// ── Router factory ─────────────────────────────────────────────────────────
export { createNamespaceRouter } from "./src/router.ts";

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  // Context
  FlexDbVariables,
  FlexDbEnv,
  // Middleware
  FlexDbMiddlewareOptions,
  // Error
  FlexDbErrorHandler,
  FlexDbHandlerOptions,
  // Individual handlers
  FlexDbGetHandlerOptions,
  FlexDbSetHandlerOptions,
  FlexDbCreateHandlerOptions,
  FlexDbDeleteHandlerOptions,
  FlexDbListHandlerOptions,
  FlexDbSearchHandlerOptions,
  FlexDbBulkGetHandlerOptions,
  FlexDbBulkSetHandlerOptions,
  FlexDbBulkCreateHandlerOptions,
  FlexDbBulkDeleteHandlerOptions,
  // Router
  FlexDbRouterOptions,
} from "./src/types.ts";

// ── Base SDK re-exports ────────────────────────────────────────────────────
// Re-exported so users can handle errors and access the raw client without
// a separate @arctics/flex-db-sdk import.

export { FlexDBClient, NamespacedClient, createClient } from "@arctics/flex-db-sdk";
export { FlexDBError, FlexDBNetworkError } from "@arctics/flex-db-sdk";

export type {
  // Config
  FlexDBClientOptions,
  RetryConfig,
  // Operation options
  OperationOptions,
  CreateOptions,
  SetOptions,
  GetOptions,
  DeleteOptions,
  ListOptions,
  SearchOptions,
  // Search / filter types
  SearchParams,
  Filters,
  FilterOperators,
  // Bulk item inputs
  BulkCreateItem,
  BulkSetItem,
  // Results
  HealthResult,
  CreateResult,
  SetResult,
  GetResult,
  DeleteResult,
  ListIdsResult,
  ListItemsResult,
  ListResult,
  BulkGetItem,
  BulkGetResult,
  BulkCreateResultItem,
  BulkCreateResult,
  BulkSetResultItem,
  BulkSetResult,
  BulkDeleteResult,
} from "@arctics/flex-db-sdk";
