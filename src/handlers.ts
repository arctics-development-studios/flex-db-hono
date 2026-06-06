/**
 * # Handler factories
 *
 * Pre-built Hono route handlers for every FlexDB operation.
 * Mount them directly on `app.get()`, `app.post()`, etc., or use
 * {@link createNamespaceRouter} to wire up an entire namespace at once.
 *
 * All handlers:
 * - Read `c.var.flexDb` (injected by the {@link flexDb} middleware).
 * - Return JSON in the shape `{ ok: true, data: <result> }` on success.
 * - Map {@link FlexDBError} codes and status codes to the response on failure.
 * - Accept an `onError` option to replace default error handling.
 *
 * ## Write-buffer visibility lag
 *
 * {@link flexDbList} and {@link flexDbSearch} query DynamoDB metadata, which is
 * only updated after the FlexDB write-buffer flushes (~60 s after a write).
 * {@link flexDbGet} is unaffected — it reads from the in-memory / Valkey tier.
 *
 * @module
 */

import type { Context, Handler } from "hono";
import type {
  FlexDBClient,
  SearchParams,
  Filters,
  BulkCreateItem,
  BulkSetItem,
} from "@arctics/flex-db-sdk";
import type {
  FlexDbEnv,
  FlexDbVariables,
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
} from "./types.ts";
import { defaultErrorHandler } from "./error.ts";

// ── Internal ───────────────────────────────────────────────────────────────

function resolveClient<E extends FlexDbEnv>(c: Context<E>): FlexDBClient {
  const client = c.var.flexDb as FlexDBClient | undefined;
  if (!client) {
    throw new Error(
      "[FlexDB] No client found in Hono context. " +
      "Ensure the flexDb() middleware is mounted before this handler.",
    );
  }
  return client;
}

function clampLimit(n: number): number {
  return Math.max(1, Math.min(1000, Math.trunc(n)));
}

// ── Get ────────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that retrieves a single object from FlexDB.
 *
 * The object key is read from the Hono route parameter named by `options.keyParam`
 * (default: `"key"`). The stored value is returned inside the standard
 * `{ ok, data }` envelope.
 *
 * Reads follow the L1 → L2 → KV → Cold waterfall, so the response is always
 * up-to-date with the last write (no list/search visibility lag).
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of the stored object. Aids IDE type inference downstream.
 * @template E - Hono `Env` type. Defaults to {@link FlexDbEnv}; extend when you
 *   have additional context variables.
 * @param ns - The FlexDB namespace to read from.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.get()`.
 *
 * @example Basic usage
 * ```ts
 * app.get("/products/:key", flexDbGet<Product>("products"));
 * ```
 *
 * @example Custom route parameter name
 * ```ts
 * app.get("/products/:id", flexDbGet<Product>("products", { keyParam: "id" }));
 * ```
 *
 * @example Custom error response
 * ```ts
 * app.get("/products/:key", flexDbGet<Product>("products", {
 *   onError: (err, c) => {
 *     if (err instanceof FlexDBError && err.code === "ERR_NOT_FOUND") {
 *       return c.json({ message: "Product not found" }, 404);
 *     }
 *     return c.json({ message: "Server error" }, 500);
 *   },
 * }));
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * { "ok": true, "data": { "data": <stored value> } }
 * ```
 *
 * **Error response — e.g. 404:**
 * ```json
 * { "ok": false, "error": { "code": "ERR_NOT_FOUND", "message": "..." } }
 * ```
 */
export function flexDbGet<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbGetHandlerOptions<T>,
): Handler<E> {
  const keyParam = options?.keyParam ?? "key";
  const onError  = options?.onError  ?? defaultErrorHandler;

  return async function getHandler(c) {
    const key = c.req.param(keyParam)!;
    try {
      const result = await resolveClient(c).get<T>(key, { namespace: ns });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Set ────────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that creates or replaces an object in FlexDB
 * at a caller-supplied key.
 *
 * Expects a JSON request body with a required `data` field and an optional
 * `sp` (search properties) map. The key is read from the route parameter
 * named by `options.keyParam` (default: `"key"`).
 *
 * The object is immediately readable via {@link flexDbGet} but may not appear
 * in {@link flexDbList} or {@link flexDbSearch} results for up to ~60 seconds
 * (write-buffer flush lag).
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of the stored object.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to write to.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.put()`.
 *
 * @example
 * ```ts
 * // PUT /products/:key
 * // Body: { "data": { "name": "Widget", "price": 9.99 }, "sp": { "price": 9.99 } }
 * app.put("/products/:key", flexDbSet<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * { "data": <any JSON value>, "sp": { "fieldName": <scalar> } }
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * { "ok": true, "data": { "key": "product-key" } }
 * ```
 */
export function flexDbSet<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbSetHandlerOptions<T>,
): Handler<E> {
  const keyParam = options?.keyParam ?? "key";
  const onError  = options?.onError  ?? defaultErrorHandler;

  return async function setHandler(c) {
    const key = c.req.param(keyParam)!;
    try {
      const body   = await c.req.json<{ data: T; sp?: SearchParams }>();
      const result = await resolveClient(c).set<T>(key, body.data, { namespace: ns, sp: body.sp });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Create ─────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that stores a new object with a server-generated key.
 *
 * The FlexDB server generates a nanoid(21) key and returns it in the response.
 * The caller never supplies a key. Equivalent to `POST /v2/o/:ns` on the FlexDB API.
 *
 * The object is immediately readable via {@link flexDbGet} but may not appear
 * in {@link flexDbList} or {@link flexDbSearch} for up to ~60 seconds.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of the stored object.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to write to.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products
 * // Body: { "data": { "name": "Widget" }, "sp": { "category": "tools" } }
 * app.post("/products", flexDbCreate<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * { "data": <any JSON value>, "sp": { "fieldName": <scalar> } }
 * ```
 *
 * **Response — 201 Created:**
 * ```json
 * { "ok": true, "data": { "key": "V1StGXR8_Z5jdHi6B-myT" } }
 * ```
 */
export function flexDbCreate<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbCreateHandlerOptions<T>,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function createHandler(c) {
    try {
      const body   = await c.req.json<{ data: T; sp?: SearchParams }>();
      const result = await resolveClient(c).create<T>(body.data, { namespace: ns, sp: body.sp });
      // deno-lint-ignore no-explicit-any
      return c.json({ ok: true, data: result }, 201 as any);
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Delete ─────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that removes an object from FlexDB.
 *
 * Deletes are **idempotent** — removing a key that does not exist returns
 * `{ ok: true }` without error.
 *
 * The delete is applied immediately across all storage tiers (L2, KV, Cold)
 * and also deregisters any unflushed write-buffer entry.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to delete from.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.delete()`.
 *
 * @example
 * ```ts
 * app.delete("/products/:key", flexDbDelete("products"));
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * { "ok": true, "data": {} }
 * ```
 */
export function flexDbDelete<E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbDeleteHandlerOptions,
): Handler<E> {
  const keyParam = options?.keyParam ?? "key";
  const onError  = options?.onError  ?? defaultErrorHandler;

  return async function deleteHandler(c) {
    const key = c.req.param(keyParam)!;
    try {
      const result = await resolveClient(c).delete(key, { namespace: ns });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── List ───────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that lists keys (or full objects) in a namespace.
 *
 * Reads pagination and hydration settings from query parameters:
 *
 * | Parameter  | Type      | Default                           | Description                        |
 * |------------|-----------|-----------------------------------|------------------------------------|
 * | `limit`    | `integer` | `options.defaultLimit ?? 50`     | Items per page (clamped to 1–1000) |
 * | `cursor`   | `string`  | `undefined` (first page)          | Opaque token from previous response |
 * | `hydrate`  | `"true"`  | `false`                           | Return full objects instead of keys |
 *
 * **Write-buffer lag:** only objects that have been flushed from the write-buffer
 * (~60 seconds after a write) appear in list results.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of objects when `?hydrate=true` is requested.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to list.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.get()`.
 *
 * @example
 * ```ts
 * // GET /products?limit=20&cursor=<token>&hydrate=true
 * app.get("/products", flexDbList<Product>("products", { defaultLimit: 20 }));
 * ```
 *
 * **Response (keys only, `hydrate` omitted or `false`) — 200 OK:**
 * ```json
 * { "ok": true, "data": { "keys": ["key1", "key2"], "cursor": "next-token-or-null" } }
 * ```
 *
 * **Response (hydrated, `?hydrate=true`) — 200 OK:**
 * ```json
 * {
 *   "ok": true,
 *   "data": {
 *     "items": [{ "key": "key1", "data": <value> }],
 *     "cursor": null
 *   }
 * }
 * ```
 */
export function flexDbList<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbListHandlerOptions<T>,
): Handler<E> {
  const defaultLimit = options?.defaultLimit ?? 50;
  const onError      = options?.onError      ?? defaultErrorHandler;

  return async function listHandler(c) {
    try {
      const rawLimit = c.req.query("limit");
      const cursor   = c.req.query("cursor") ?? undefined;
      const hydrate  = c.req.query("hydrate") === "true";
      const limit    = rawLimit ? clampLimit(Number(rawLimit)) : defaultLimit;

      const client = resolveClient(c);

      if (hydrate) {
        const result = await client.list<T>({ namespace: ns, limit, cursor, hydrate: true });
        return c.json({ ok: true, data: result });
      }

      const result = await client.list({ namespace: ns, limit, cursor });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that searches objects by their indexed `sp` fields.
 *
 * Expects a JSON request body with `filters` (required) and optional pagination /
 * hydration fields. All filters in a single request are AND-ed together. At least
 * one filter is required (`400 ERR_MISSING_FILTER` otherwise).
 *
 * The filter format mirrors the SDK's ergonomic object syntax, not the raw API wire
 * format, so callers use `{ "price": { "gte": 10 } }` rather than an array of
 * `{ field, op, value }` objects.
 *
 * **Write-buffer lag:** only objects flushed from the write-buffer (~60 s) appear.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of objects when `"hydrate": true` is set in the request body.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to search.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products/search
 * app.post("/products/search", flexDbSearch<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * {
 *   "filters": {
 *     "category": { "eq": "electronics" },
 *     "price":    { "lte": 100 }
 *   },
 *   "limit":   50,
 *   "cursor":  null,
 *   "hydrate": false
 * }
 * ```
 *
 * **Supported filter operators:** `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`
 *
 * **Response (keys only) — 200 OK:**
 * ```json
 * { "ok": true, "data": { "keys": ["key1", "key2"], "cursor": null } }
 * ```
 *
 * **Response (hydrated) — 200 OK:**
 * ```json
 * { "ok": true, "data": { "items": [{ "key": "key1", "data": <value> }], "cursor": null } }
 * ```
 */
export function flexDbSearch<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbSearchHandlerOptions<T>,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function searchHandler(c) {
    try {
      const body = await c.req.json<{
        filters: Filters;
        limit?:  number;
        cursor?: string;
        hydrate?: boolean;
      }>();

      const client = resolveClient(c);

      if (body.hydrate) {
        const result = await client.search<T>({
          namespace: ns,
          filters:   body.filters,
          limit:     body.limit,
          cursor:    body.cursor,
          hydrate:   true,
        });
        return c.json({ ok: true, data: result });
      }

      const result = await client.search({
        namespace: ns,
        filters:   body.filters,
        limit:     body.limit,
        cursor:    body.cursor,
      });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Bulk Get ───────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that fetches multiple objects in a single request.
 *
 * Missing keys are included in the response array with `ok: false`. Response
 * order always matches the input key order. All keys must pass nanoid validation;
 * one invalid key rejects the entire request with `400 ERR_INVALID_KEY`.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of retrieved objects.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to read from.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products/bulk/get
 * app.post("/products/bulk/get", flexDbBulkGet<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * { "keys": ["key1", "key2", "key3"] }
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * {
 *   "ok": true,
 *   "data": {
 *     "items": [
 *       { "key": "key1", "ok": true,  "data": <value> },
 *       { "key": "key2", "ok": false }
 *     ]
 *   }
 * }
 * ```
 */
export function flexDbBulkGet<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbBulkGetHandlerOptions<T>,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function bulkGetHandler(c) {
    try {
      const body   = await c.req.json<{ keys: string[] }>();
      const result = await resolveClient(c).bulkGet<T>(body.keys, { namespace: ns });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Bulk Set ───────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that creates or replaces multiple objects.
 *
 * Each item is processed independently via the write-buffer path (same ~60 s
 * flush lag as {@link flexDbSet}). Items are processed concurrently up to the
 * server's `BULK_SET_CONCURRENCY` limit. Response order matches input order.
 *
 * **Cost note:** Total quota cost is charged *before* any writes. Partial
 * per-item failures still consume quota for the items that were attempted.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of stored objects.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to write to.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products/bulk/set
 * app.post("/products/bulk/set", flexDbBulkSet<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * {
 *   "items": [
 *     { "key": "key1", "data": <value>, "sp": { "price": 9.99 } },
 *     { "key": "key2", "data": <value> }
 *   ]
 * }
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * {
 *   "ok": true,
 *   "data": {
 *     "items": [{ "ok": true }, { "ok": false, "error": "..." }]
 *   }
 * }
 * ```
 */
export function flexDbBulkSet<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbBulkSetHandlerOptions<T>,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function bulkSetHandler(c) {
    try {
      const body   = await c.req.json<{ items: BulkSetItem<T>[] }>();
      const result = await resolveClient(c).bulkSet<T>(body.items, { namespace: ns });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Bulk Create ────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that stores multiple objects with server-generated keys.
 *
 * Each item receives a unique nanoid(21) key generated server-side. Slightly
 * cheaper than {@link flexDbBulkSet} per item because no L2 invalidation is needed
 * (keys are guaranteed new). Response order matches input order.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template T - Shape of stored objects.
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to write to.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products/bulk/create
 * app.post("/products/bulk/create", flexDbBulkCreate<Product>("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * {
 *   "items": [
 *     { "data": <value>, "sp": { "category": "tools" } },
 *     { "data": <value> }
 *   ]
 * }
 * ```
 *
 * **Response — 201 Created:**
 * ```json
 * {
 *   "ok": true,
 *   "data": {
 *     "items": [
 *       { "ok": true,  "id": "V1StGXR8_Z5jdHi6B-myT" },
 *       { "ok": false, "error": "..." }
 *     ]
 *   }
 * }
 * ```
 */
export function flexDbBulkCreate<T = unknown, E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbBulkCreateHandlerOptions<T>,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function bulkCreateHandler(c) {
    try {
      const body   = await c.req.json<{ items: BulkCreateItem<T>[] }>();
      const result = await resolveClient(c).bulkCreate<T>(body.items, { namespace: ns });
      // deno-lint-ignore no-explicit-any
      return c.json({ ok: true, data: result }, 201 as any);
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}

// ── Bulk Delete ────────────────────────────────────────────────────────────

/**
 * Creates a Hono route handler that removes multiple objects in a single request.
 *
 * Non-existent keys are silently ignored — the operation is idempotent per key.
 * All keys must pass nanoid validation; one invalid key rejects the entire request.
 *
 * **Requires** the {@link flexDb} middleware to be mounted upstream.
 *
 * @template E - Hono `Env` type.
 * @param ns - The FlexDB namespace to delete from.
 * @param options - Optional handler configuration.
 * @returns A Hono `Handler` ready for `app.post()`.
 *
 * @example
 * ```ts
 * // POST /products/bulk/delete
 * app.post("/products/bulk/delete", flexDbBulkDelete("products"));
 * ```
 *
 * **Request body:**
 * ```json
 * { "keys": ["key1", "key2"] }
 * ```
 *
 * **Response — 200 OK:**
 * ```json
 * { "ok": true, "data": {} }
 * ```
 */
export function flexDbBulkDelete<E extends FlexDbEnv = FlexDbEnv>(
  ns: string,
  options?: FlexDbBulkDeleteHandlerOptions,
): Handler<E> {
  const onError = options?.onError ?? defaultErrorHandler;

  return async function bulkDeleteHandler(c) {
    try {
      const body   = await c.req.json<{ keys: string[] }>();
      const result = await resolveClient(c).bulkDelete(body.keys, { namespace: ns });
      return c.json({ ok: true, data: result });
    } catch (err) {
      return onError(err, c as Context);
    }
  };
}
