/**
 * # Types
 *
 * All public-facing TypeScript types for `@arctics/flex-db-hono`.
 * Re-exported from the root module — you rarely need to import from here directly.
 *
 * ```ts
 * import type { FlexDbEnv, FlexDbVariables, FlexDbRouterOptions } from "@arctics/flex-db-hono";
 * ```
 *
 * @module
 */

import type { Context } from "hono";
import type { FlexDBClient, FlexDBClientOptions } from "@arctics/flex-db-sdk";

// ── Context Variables ──────────────────────────────────────────────────────

/**
 * Shape of the Hono context variables injected by the {@link flexDb} middleware.
 *
 * Use this when composing your own Hono `Env` type alongside other context variables:
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, type FlexDbVariables } from "@arctics/flex-db-hono";
 *
 * type AppEnv = {
 *   Variables: FlexDbVariables & { currentUser: User };
 * };
 *
 * const app = new Hono<AppEnv>();
 * app.use(flexDb({ apiKey: "...", baseUrl: "..." }));
 * ```
 */
export interface FlexDbVariables {
  /** The shared {@link FlexDBClient} instance, available on every request after the middleware runs. */
  flexDb: FlexDBClient;
}

/**
 * Ready-made Hono `Env` type that includes {@link FlexDbVariables}.
 *
 * Pass this as the generic argument to `Hono` and your handler types when you do
 * not need additional context variables beyond the FlexDB client:
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, type FlexDbEnv } from "@arctics/flex-db-hono";
 *
 * const app = new Hono<FlexDbEnv>();
 * app.use(flexDb({ apiKey: Deno.env.get("FLEXDB_KEY")!, baseUrl: "https://..." }));
 * ```
 *
 * When your application also has its own context variables, compose the env using
 * {@link FlexDbVariables} instead:
 *
 * ```ts
 * type AppEnv = {
 *   Variables: FlexDbVariables & { currentUser: User };
 * };
 * ```
 */
export type FlexDbEnv = {
  Variables: FlexDbVariables;
};

// ── Middleware ─────────────────────────────────────────────────────────────

/**
 * Options accepted by the {@link flexDb} middleware factory.
 * Identical to {@link FlexDBClientOptions} — all SDK configuration goes here.
 */
export type FlexDbMiddlewareOptions = FlexDBClientOptions;

// ── Error Handler ──────────────────────────────────────────────────────────

/**
 * A custom error handler for FlexDB handler factories.
 *
 * Receives the thrown error and the active Hono `Context`. Must return a
 * `Response` (synchronously or via a `Promise`).
 *
 * @example
 * ```ts
 * import { FlexDBError } from "@arctics/flex-db-hono";
 *
 * const onError: FlexDbErrorHandler = (err, c) => {
 *   if (err instanceof FlexDBError && err.code === "ERR_NOT_FOUND") {
 *     return c.json({ message: "Resource not found" }, 404);
 *   }
 *   return c.json({ message: "Unexpected error" }, 500);
 * };
 *
 * app.get("/products/:key", flexDbGet("products", { onError }));
 * ```
 */
export type FlexDbErrorHandler = (err: unknown, c: Context) => Response | Promise<Response>;

// ── Base Handler Options ───────────────────────────────────────────────────

/** Base options shared by all FlexDB Hono handler factories. */
export interface FlexDbHandlerOptions {
  /**
   * Override the default error mapping.
   *
   * When omitted, {@link FlexDBError} status codes and codes are forwarded
   * verbatim, {@link FlexDBNetworkError} yields `503 Service Unavailable`,
   * and any other thrown value yields `500 Internal Server Error`.
   */
  onError?: FlexDbErrorHandler;
}

// ── Individual Handler Options ─────────────────────────────────────────────

/**
 * Options for {@link flexDbGet}.
 *
 * @template _T Phantom type for the stored object. Used only for type inference.
 */
export interface FlexDbGetHandlerOptions<_T = unknown> extends FlexDbHandlerOptions {
  /**
   * The Hono route parameter name that holds the object key.
   * Must match the placeholder used in your `app.get()` path.
   *
   * ```ts
   * // Route uses ":id" → tell the handler to read "id", not the default "key"
   * app.get("/products/:id", flexDbGet("products", { keyParam: "id" }));
   * ```
   *
   * @default "key"
   */
  keyParam?: string;
}

/**
 * Options for {@link flexDbSet}.
 *
 * @template _T Phantom type for the stored object.
 */
export interface FlexDbSetHandlerOptions<_T = unknown> extends FlexDbHandlerOptions {
  /**
   * The Hono route parameter name that holds the object key.
   * @default "key"
   */
  keyParam?: string;
}

/**
 * Options for {@link flexDbCreate}.
 *
 * @template _T Phantom type for the stored object.
 */
export type FlexDbCreateHandlerOptions<_T = unknown> = FlexDbHandlerOptions;

/**
 * Options for {@link flexDbDelete}.
 */
export interface FlexDbDeleteHandlerOptions extends FlexDbHandlerOptions {
  /**
   * The Hono route parameter name that holds the object key.
   * @default "key"
   */
  keyParam?: string;
}

/**
 * Options for {@link flexDbList}.
 *
 * @template _T Phantom type for list items when `?hydrate=true` is used.
 */
export interface FlexDbListHandlerOptions<_T = unknown> extends FlexDbHandlerOptions {
  /**
   * Default page size applied when the caller omits `?limit=`.
   * Clamped to the valid range 1–1000 by the SDK.
   * @default 50
   */
  defaultLimit?: number;
}

/**
 * Options for {@link flexDbSearch}.
 *
 * @template _T Phantom type for result items when `hydrate: true` is set in the request body.
 */
export type FlexDbSearchHandlerOptions<_T = unknown> = FlexDbHandlerOptions;

/**
 * Options for {@link flexDbBulkGet}.
 *
 * @template _T Phantom type for retrieved objects.
 */
export type FlexDbBulkGetHandlerOptions<_T = unknown> = FlexDbHandlerOptions;

/**
 * Options for {@link flexDbBulkSet}.
 *
 * @template _T Phantom type for stored objects.
 */
export type FlexDbBulkSetHandlerOptions<_T = unknown> = FlexDbHandlerOptions;

/**
 * Options for {@link flexDbBulkCreate}.
 *
 * @template _T Phantom type for stored objects.
 */
export type FlexDbBulkCreateHandlerOptions<_T = unknown> = FlexDbHandlerOptions;

/**
 * Options for {@link flexDbBulkDelete}.
 */
export type FlexDbBulkDeleteHandlerOptions = FlexDbHandlerOptions;

// ── Router Options ─────────────────────────────────────────────────────────

/**
 * Fine-grained configuration for {@link createNamespaceRouter}.
 *
 * Every toggle defaults to `true` (all routes enabled) except `enableBulk`
 * which is `false` by default because bulk routes accept arbitrary key arrays
 * and typically require additional authorization before being exposed.
 *
 * @template _T Phantom type for objects stored in the namespace.
 */
export interface FlexDbRouterOptions<_T = unknown> extends FlexDbHandlerOptions {
  /**
   * Mount `GET /:keyParam` — retrieve a single object by key.
   * @default true
   */
  enableGet?: boolean;
  /**
   * Mount `PUT /:keyParam` — create or replace an object at a caller-supplied key.
   * @default true
   */
  enableSet?: boolean;
  /**
   * Mount `POST /` — create an object with a server-generated nanoid(21) key.
   * @default true
   */
  enableCreate?: boolean;
  /**
   * Mount `DELETE /:keyParam` — remove an object idempotently.
   * @default true
   */
  enableDelete?: boolean;
  /**
   * Mount `GET /` — list keys (or full objects when `?hydrate=true`) in the namespace.
   * @default true
   */
  enableList?: boolean;
  /**
   * Mount `POST /search` — filter objects by indexed `sp` fields.
   * @default true
   */
  enableSearch?: boolean;
  /**
   * Mount bulk operation routes under a `/bulk/` sub-path:
   * - `POST /bulk/get`
   * - `POST /bulk/set`
   * - `POST /bulk/create`
   * - `POST /bulk/delete`
   *
   * @default false
   */
  enableBulk?: boolean;
  /**
   * Hono route parameter name used by all single-object routes.
   * Change this when your routing convention uses a name other than `key`.
   * @default "key"
   */
  keyParam?: string;
  /**
   * Default page limit for list and search routes.
   * @default 50
   */
  defaultLimit?: number;
}
