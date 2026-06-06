/**
 * # Context helpers
 *
 * Convenience functions for accessing the FlexDB client and namespace-scoped
 * sub-clients directly from a Hono route handler.
 *
 * Use these when the pre-built handler factories do not cover your exact logic
 * and you need imperative access to the SDK — chaining multiple calls, conditional
 * writes, or custom transactions.
 *
 * ```ts
 * import { Hono } from "hono";
 * import { flexDb, getFlexDB, getNamespace, type FlexDbEnv } from "@arctics/flex-db-hono";
 *
 * const app = new Hono<FlexDbEnv>();
 * app.use(flexDb({ apiKey: "...", baseUrl: "..." }));
 *
 * app.post("/transfer/:from/:to", async (c) => {
 *   const items = getNamespace(c, "items");
 *   const { data } = await items.get(c.req.param("from"));
 *   await items.set(c.req.param("to"), data);
 *   await items.delete(c.req.param("from"));
 *   return c.json({ ok: true });
 * });
 * ```
 *
 * @module
 */

import type { Context } from "hono";
import type { FlexDBClient, NamespacedClient, SearchParams } from "@arctics/flex-db-sdk";
import type { FlexDbVariables } from "./types.ts";

// ── getFlexDB ──────────────────────────────────────────────────────────────

/**
 * Retrieves the shared {@link FlexDBClient} instance from the Hono request context.
 *
 * The client is placed there by the {@link flexDb} middleware. If the middleware has
 * not run for the current request, this function throws a descriptive error to help
 * you diagnose the missing middleware mount.
 *
 * Prefer the purpose-built handler factories ({@link flexDbGet}, {@link flexDbCreate},
 * etc.) for standard CRUD operations. Use `getFlexDB` only for custom logic that
 * chains multiple SDK calls or needs the full client API.
 *
 * @param c - The active Hono `Context`. Must be typed with {@link FlexDbVariables}
 *   or {@link FlexDbEnv} so TypeScript knows `flexDb` is present.
 * @returns The {@link FlexDBClient} instance.
 * @throws `Error` if the {@link flexDb} middleware has not run for this request.
 *
 * @example Imperative multi-step operation
 * ```ts
 * app.post("/migrate/:fromNs/:toNs", async (c) => {
 *   const db = getFlexDB(c);
 *   const fromNs = c.req.param("fromNs");
 *   const toNs   = c.req.param("toNs");
 *
 *   const { keys } = await db.list({ namespace: fromNs });
 *   for (const key of keys) {
 *     const { data } = await db.get(key, { namespace: fromNs });
 *     await db.set(key, data, { namespace: toNs });
 *   }
 *   return c.json({ ok: true, migrated: keys.length });
 * });
 * ```
 */
export function getFlexDB(c: Context<{ Variables: FlexDbVariables }>): FlexDBClient {
  const client = c.var.flexDb as FlexDBClient | undefined;
  if (!client) {
    throw new Error(
      "[FlexDB] getFlexDB() found no client in the Hono context. " +
      "Make sure the flexDb() middleware is mounted before this handler.",
    );
  }
  return client;
}

// ── getNamespace ───────────────────────────────────────────────────────────

/**
 * Returns a {@link NamespacedClient} bound to the given namespace from the
 * Hono request context.
 *
 * Equivalent to `getFlexDB(c).namespace(ns)`. Every operation on the returned
 * client automatically uses the fixed namespace — you never need to pass
 * `namespace` in individual call options.
 *
 * @param c - The active Hono `Context`.
 * @param ns - The namespace to bind. Must be a non-empty string.
 * @returns A {@link NamespacedClient} with `ns` pre-bound to every operation.
 *
 * @example Atomic move within a namespace
 * ```ts
 * app.post("/inventory/move/:from/:to", async (c) => {
 *   const inv = getNamespace(c, "inventory");
 *
 *   const { data } = await inv.get(c.req.param("from"));
 *   await inv.set(c.req.param("to"), data);
 *   await inv.delete(c.req.param("from"));
 *
 *   return c.json({ ok: true });
 * });
 * ```
 *
 * @example With a typed SearchParams shape
 * ```ts
 * interface ProductSP { price: number; category: string }
 *
 * app.get("/products/cheap", async (c) => {
 *   const products = getNamespace<ProductSP>(c, "products");
 *   const { keys } = await products.search({
 *     filters: { price: { lte: 10 }, category: { eq: "tools" } },
 *   });
 *   return c.json({ ok: true, data: { keys } });
 * });
 * ```
 */
export function getNamespace<SP extends SearchParams = SearchParams>(
  c: Context<{ Variables: FlexDbVariables }>,
  ns: string,
): NamespacedClient<SP> {
  return getFlexDB(c).namespace<SP>(ns);
}
