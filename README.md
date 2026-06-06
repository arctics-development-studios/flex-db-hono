# FlexDB Hono SDK

Hono middleware, handler factories, and a namespace router for **FlexDB** — a high-performance distributed key-value store. A thin Hono layer over [`@arctics/flex-db-sdk`](https://jsr.io/@arctics/flex-db-sdk). Mount the middleware once, then wire up full CRUD, search, and bulk endpoints with a single function call per route.

## Installation

```jsonc
// deno.json
{
  "imports": {
    "@arctics/flex-db-hono": "jsr:@arctics/flex-db-hono@^2.6.0",
    "hono": "npm:hono@^4"
  }
}
```

## Setup

Mount the `flexDb` middleware once — at the app level or on a route group — before any handler factories. It creates a single `FlexDBClient` at startup and makes it available on `c.var.flexDb` for every downstream handler.

```ts
import { Hono } from "hono";
import { flexDb } from "@arctics/flex-db-hono";

const app = new Hono();

app.use(flexDb({
  apiKey:  Deno.env.get("FLEXDB_KEY")!,
  baseUrl: "https://eu.flex.arctics.dev",
}));

Deno.serve(app.fetch);
```

> **Tip:** the client is created once when `flexDb()` is called, not on every request. Connection settings and retry config are shared across all requests — treat this exactly like a module-level singleton.

---

## Handlers at a glance

| Handler | HTTP | Operation |
|---|---|---|
| `flexDbGet` | `GET /:key` | Retrieve a single object |
| `flexDbSet` | `PUT /:key` | Create or replace an object |
| `flexDbCreate` | `POST /` | Create with a server-generated key |
| `flexDbDelete` | `DELETE /:key` | Remove an object (idempotent) |
| `flexDbList` | `GET /` | List keys or full objects (paginated) |
| `flexDbSearch` | `POST /search` | Filter objects by indexed fields |
| `flexDbBulkGet` | `POST /bulk/get` | Fetch multiple objects at once |
| `flexDbBulkSet` | `POST /bulk/set` | Set multiple objects at once |
| `flexDbBulkCreate` | `POST /bulk/create` | Create multiple with generated keys |
| `flexDbBulkDelete` | `POST /bulk/delete` | Delete multiple objects at once |

---

## Namespace router — zero-boilerplate CRUD

`createNamespaceRouter` wires up all standard routes for a namespace and returns a Hono sub-router you mount with `app.route()`.

```ts
import { Hono } from "hono";
import { flexDb, createNamespaceRouter } from "@arctics/flex-db-hono";

interface Product { name: string; price: number; stock: number }

const app = new Hono();

app.use(flexDb({
  apiKey:  Deno.env.get("FLEXDB_KEY")!,
  baseUrl: "https://eu.flex.arctics.dev",
}));

app.route("/products", createNamespaceRouter<Product>("products"));

// Mounts:
//   GET    /products          → list keys
//   POST   /products          → create (server-generated key)
//   GET    /products/:key     → get by key
//   PUT    /products/:key     → set (create or replace)
//   DELETE /products/:key     → delete
//   POST   /products/search   → search by sp fields

Deno.serve(app.fetch);
```

### Router options

All toggles default to `true` except `enableBulk` (`false`) because bulk routes accept arbitrary key arrays and typically need additional authorization.

```ts
const orders = createNamespaceRouter<Order>("orders", {
  enableGet:    true,    // GET /:key
  enableSet:    true,    // PUT /:key
  enableCreate: true,    // POST /
  enableDelete: true,    // DELETE /:key
  enableList:   true,    // GET /
  enableSearch: true,    // POST /search
  enableBulk:   true,    // POST /bulk/get, /bulk/set, /bulk/create, /bulk/delete
  keyParam:     "id",    // change ":key" to ":id" in single-object routes
  defaultLimit: 25,      // default page size for list and search
});

app.route("/orders", orders);
```

### Read-only router

```ts
const catalog = createNamespaceRouter<Product>("products", {
  enableSet:    false,
  enableCreate: false,
  enableDelete: false,
});

app.route("/catalog", catalog);
```

---

## Cherry-picking individual handlers

Use individual handler factories when you need only specific routes or want to mix them with custom logic.

```ts
import {
  flexDb,
  flexDbGet,
  flexDbCreate,
  flexDbSet,
  flexDbDelete,
  flexDbList,
  flexDbSearch,
} from "@arctics/flex-db-hono";

app.use(flexDb({ apiKey: "...", baseUrl: "..." }));

app.get("/users/:key",    flexDbGet<User>("users"));
app.post("/users",        flexDbCreate<User>("users"));
app.put("/users/:key",    flexDbSet<User>("users"));
app.delete("/users/:key", flexDbDelete("users"));
app.get("/users",         flexDbList<User>("users", { defaultLimit: 20 }));
app.post("/users/search", flexDbSearch<User>("users"));
```

---

## Handler reference

### `flexDbGet` — retrieve a single object

Reads the key from the route parameter (default `:key`) and fetches the object from FlexDB. Reads follow the L1 → L2 → KV → Cold waterfall — always up-to-date, no list/search lag.

```ts
app.get("/products/:key", flexDbGet<Product>("products"));

// Custom route parameter name
app.get("/products/:id", flexDbGet<Product>("products", { keyParam: "id" }));
```

**Response — 200 OK:**
```json
{ "ok": true, "data": { "data": { "name": "Widget", "price": 9.99 } } }
```

**Error — 404:**
```json
{ "ok": false, "error": { "code": "ERR_NOT_FOUND", "message": "..." } }
```

---

### `flexDbCreate` — create with a server-generated key

Stores a new object and returns the nanoid(21) key the server assigned. The caller never supplies a key.

```ts
app.post("/products", flexDbCreate<Product>("products"));
```

**Request body:**
```json
{
  "data": { "name": "Widget", "price": 9.99 },
  "sp":   { "price": 9.99, "category": "tools" }
}
```

The `sp` (search properties) map is optional. Any scalar fields (`string`, `number`, `boolean`) set here become filterable via `flexDbSearch`. They are stored separately and do **not** appear in `flexDbGet` responses.

**Response — 201 Created:**
```json
{ "ok": true, "data": { "key": "V1StGXR8_Z5jdHi6B-myT" } }
```

---

### `flexDbSet` — create or replace at a caller-supplied key

Upserts an object at the key in the route parameter. The entire stored value is replaced on every call.

```ts
app.put("/products/:key", flexDbSet<Product>("products"));
```

**Request body:**
```json
{
  "data": { "name": "Widget Pro", "price": 19.99 },
  "sp":   { "price": 19.99, "category": "tools" }
}
```

**Response — 200 OK:**
```json
{ "ok": true, "data": { "key": "my-product-key" } }
```

---

### `flexDbDelete` — remove an object

Deletes the object from all storage tiers. Idempotent — deleting a key that does not exist returns success.

```ts
app.delete("/products/:key", flexDbDelete("products"));
```

**Response — 200 OK:**
```json
{ "ok": true, "data": {} }
```

---

### `flexDbList` — paginated key list

Lists all keys in a namespace. Supports pagination via cursor and optional hydration to return full objects instead of just keys.

```ts
app.get("/products", flexDbList<Product>("products", { defaultLimit: 20 }));
```

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | `defaultLimit` option (50) | Items per page. Clamped to 1–1000. |
| `cursor` | string | — | Opaque token from a previous response. Omit to start from the beginning. |
| `hydrate` | `"true"` | — | Return full objects instead of just keys. |

**Response — keys only (hydrate omitted):**
```json
{
  "ok": true,
  "data": {
    "keys":   ["key1", "key2", "key3"],
    "cursor": "next-page-token-or-null"
  }
}
```

**Response — hydrated (`?hydrate=true`):**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "key": "key1", "data": { "name": "Widget", "price": 9.99 } }
    ],
    "cursor": null
  }
}
```

> **Write-buffer lag:** newly written objects appear in `flexDbGet` immediately but may not appear in list results for up to ~60 seconds while FlexDB's write-buffer flushes to DynamoDB. See [Write-buffer visibility lag](#write-buffer-visibility-lag).

---

### `flexDbSearch` — filter by indexed fields

Searches objects by their `sp` (search properties) fields. All filters are AND-ed. At least one filter is required.

```ts
app.post("/products/search", flexDbSearch<Product>("products"));
```

**Request body:**
```json
{
  "filters": {
    "category": { "eq": "electronics" },
    "price":    { "gte": 10, "lte": 100 }
  },
  "limit":   50,
  "cursor":  null,
  "hydrate": false
}
```

The filter format uses the ergonomic SDK shape — field names as keys, operator objects as values — not the raw API wire format.

**Filter operators:**

| Operator | Meaning |
|---|---|
| `eq` | Exact match |
| `ne` | Not equal |
| `gt` / `gte` | Greater than / greater than or equal |
| `lt` / `lte` | Less than / less than or equal |
| `starts_with` | String starts with prefix |
| `contains` | String contains substring |

**Response — keys only:**
```json
{
  "ok": true,
  "data": {
    "keys":   ["key1", "key2"],
    "cursor": null
  }
}
```

**Response — hydrated (`"hydrate": true`):**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "key": "key1", "data": { "name": "Widget Pro", "price": 19.99 } }
    ],
    "cursor": null
  }
}
```

---

## Bulk operations

Bulk handlers are available as individual factories or via `createNamespaceRouter` with `enableBulk: true`. They are disabled by default in the router because they expose powerful batch operations that often require additional authorization logic.

```ts
app.post("/products/bulk/get",    flexDbBulkGet<Product>("products"));
app.post("/products/bulk/set",    flexDbBulkSet<Product>("products"));
app.post("/products/bulk/create", flexDbBulkCreate<Product>("products"));
app.post("/products/bulk/delete", flexDbBulkDelete("products"));
```

### `flexDbBulkGet` — fetch multiple objects

Missing keys are included in the response with `ok: false`. Response order matches input order.

**Request body:**
```json
{ "keys": ["key1", "key2", "key3"] }
```

**Response — 200 OK:**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "key": "key1", "ok": true,  "data": { "name": "Widget" } },
      { "key": "key2", "ok": false },
      { "key": "key3", "ok": true,  "data": { "name": "Gadget" } }
    ]
  }
}
```

### `flexDbBulkSet` — set multiple objects

Each item is processed independently via the write-buffer path. Response order matches input order. Quota is charged before any writes — partial per-item failures still consume quota.

**Request body:**
```json
{
  "items": [
    { "key": "key1", "data": { "name": "Widget" }, "sp": { "price": 9.99 } },
    { "key": "key2", "data": { "name": "Gadget" } }
  ]
}
```

**Response — 200 OK:**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "ok": true },
      { "ok": false, "error": "ERR_REQUEST_TOO_LARGE" }
    ]
  }
}
```

### `flexDbBulkCreate` — create multiple with generated keys

Each item receives a unique nanoid(21) key. Slightly cheaper than `flexDbBulkSet` per item because no L2 invalidation is needed for new keys.

**Request body:**
```json
{
  "items": [
    { "data": { "name": "Widget" }, "sp": { "category": "tools" } },
    { "data": { "name": "Gadget" } }
  ]
}
```

**Response — 201 Created:**
```json
{
  "ok": true,
  "data": {
    "items": [
      { "ok": true,  "id": "V1StGXR8_Z5jdHi6B-myT" },
      { "ok": false, "error": "..." }
    ]
  }
}
```

### `flexDbBulkDelete` — delete multiple objects

Non-existent keys are silently ignored — idempotent per key.

**Request body:**
```json
{ "keys": ["key1", "key2"] }
```

**Response — 200 OK:**
```json
{ "ok": true, "data": {} }
```

---

## Custom handlers — escape hatch

When the handler factories do not cover your exact logic, use `getFlexDB` or `getNamespace` to access the underlying `FlexDBClient` directly inside your own Hono handlers.

### `getFlexDB` — raw client access

```ts
import { Hono } from "hono";
import { flexDb, getFlexDB, type FlexDbEnv } from "@arctics/flex-db-hono";

const app = new Hono<FlexDbEnv>();

app.use(flexDb({ apiKey: "...", baseUrl: "..." }));

// Atomic move between namespaces
app.post("/migrate/:fromNs/:toNs/:key", async (c) => {
  const db    = getFlexDB(c);
  const fromNs = c.req.param("fromNs");
  const toNs   = c.req.param("toNs");
  const key    = c.req.param("key");

  const { data } = await db.get(key, { namespace: fromNs });
  await db.set(key, data, { namespace: toNs });
  await db.delete(key, { namespace: fromNs });

  return c.json({ ok: true });
});
```

### `getNamespace` — namespace-bound client

`getNamespace(c, ns)` is shorthand for `getFlexDB(c).namespace(ns)`. Every operation on the returned client automatically uses the fixed namespace — no need to pass `namespace` on each call.

```ts
import { getNamespace } from "@arctics/flex-db-hono";

app.post("/inventory/move/:from/:to", async (c) => {
  const inv = getNamespace(c, "inventory");

  const { data } = await inv.get(c.req.param("from"));
  await inv.set(c.req.param("to"), data);
  await inv.delete(c.req.param("from"));

  return c.json({ ok: true });
});
```

---

## Type-safe context

Use `FlexDbEnv` directly when no other context variables are needed. Merge `FlexDbVariables` into your own env type when your app has additional context:

```ts
import { type FlexDbEnv, type FlexDbVariables } from "@arctics/flex-db-hono";

// Simple — FlexDB only
const app = new Hono<FlexDbEnv>();

// Extended — FlexDB + your own variables
interface CurrentUser { id: string; role: "admin" | "member" }

type AppEnv = {
  Variables: FlexDbVariables & { currentUser: CurrentUser };
};

const app = new Hono<AppEnv>();

app.use(flexDb({ apiKey: "...", baseUrl: "..." }));

// Auth middleware populates currentUser
app.use(async (c, next) => {
  const user = await verifyToken(c.req.header("Authorization"));
  c.set("currentUser", user);
  await next();
});

// Custom handler can access both
app.get("/orders/:key", async (c) => {
  const db   = getFlexDB(c);
  const user = c.var.currentUser;

  if (user.role !== "admin") {
    return c.json({ ok: false, error: { code: "ERR_FORBIDDEN" } }, 403);
  }

  const result = await db.get(c.req.param("key"), { namespace: "orders" });
  return c.json({ ok: true, data: result });
});
```

---

## Error handling

All handler factories map FlexDB errors to JSON responses automatically. Override the default behaviour per-handler or per-router with `onError`.

### Default error mapping

| Error type | HTTP status | Response code |
|---|---|---|
| `FlexDBError` | Forwarded from the server (`err.status`) | Forwarded (`err.code`) |
| `FlexDBNetworkError` | `503 Service Unavailable` | `ERR_NETWORK` |
| Any other thrown value | `500 Internal Server Error` | `ERR_INTERNAL` |

**Default error response shape:**
```json
{ "ok": false, "error": { "code": "ERR_NOT_FOUND", "message": "..." } }
```

### Custom `onError` per handler

```ts
import { FlexDBError } from "@arctics/flex-db-hono";

app.get("/products/:key", flexDbGet<Product>("products", {
  onError: (err, c) => {
    if (err instanceof FlexDBError) {
      if (err.code === "ERR_NOT_FOUND") {
        return c.json({ message: "Product not found" }, 404);
      }
      return c.json({ message: err.message }, err.status as never);
    }
    return c.json({ message: "Unexpected server error" }, 500);
  },
}));
```

### Shared `onError` across a namespace router

```ts
import { FlexDBError, FlexDBNetworkError } from "@arctics/flex-db-hono";

const errorHandler = (err: unknown, c: Context) => {
  if (err instanceof FlexDBError) {
    return c.json({ error: err.code }, err.status as never);
  }
  if (err instanceof FlexDBNetworkError) {
    return c.json({ error: "Service temporarily unavailable" }, 503);
  }
  return c.json({ error: "Internal server error" }, 500);
};

app.route("/products", createNamespaceRouter<Product>("products", {
  onError: errorHandler,
}));
```

### FlexDB error codes reference

| Code | HTTP | When |
|---|---|---|
| `ERR_MISSING_AUTH` | 401 | No `Authorization` header |
| `ERR_UNAUTHORIZED` | 401 | Token invalid, expired, or revoked |
| `ERR_PERMISSION_DENIED` | 403 | Token lacks required permission bit |
| `ERR_NOT_FOUND` | 404 | Object does not exist at any tier |
| `ERR_INVALID_KEY` | 400 | Key fails nanoid constraint |
| `ERR_MISSING_FILTER` | 400 | Search called with empty `filters` |
| `ERR_RATE_LIMIT_SECOND` | 429 | Per-second RPS cap exceeded |
| `ERR_RATE_LIMIT_MONTH` | 429 | Monthly budget exhausted |
| `ERR_REQUEST_TOO_LARGE` | 413 | Object exceeds size limit |
| `ERR_BULK_TOO_LARGE` | 413 | Bulk item count exceeds limit |
| `ERR_UNPROCESSABLE_ENTITY` | 422 | Request body invalid or wrong shape |
| `ERR_INTERNAL` | 500 | Unexpected server error |

---

## Scoping middleware to a route group

Use a sub-app to limit the FlexDB middleware to a specific prefix, or to use different API keys for different route groups:

```ts
const api = new Hono();
api.use(flexDb({ apiKey: Deno.env.get("FLEXDB_KEY")!, baseUrl: "https://..." }));
api.get("/:key",    flexDbGet("items"));
api.post("/",       flexDbCreate("items"));
api.delete("/:key", flexDbDelete("items"));

app.route("/api/items", api);
```

---

## Retry configuration

By default the SDK retries failed requests up to **3 times** with a **10 ms** delay between attempts. Retries apply to network failures and HTTP `5xx` responses. Client errors (`4xx`) are thrown immediately without retrying.

```ts
// Aggressive retry
app.use(flexDb({
  apiKey:  Deno.env.get("FLEXDB_KEY")!,
  baseUrl: "https://eu.flex.arctics.dev",
  retry:   { times: 5, delay: 50 },
}));

// Disable retries entirely (useful in development)
app.use(flexDb({
  apiKey:  Deno.env.get("FLEXDB_KEY")!,
  baseUrl: "https://eu.flex.arctics.dev",
  retry:   false,
}));
```

---

## Write-buffer visibility lag

FlexDB writes land in the in-memory (L2/Valkey) tier immediately. The `WriteBufferFlushJob` commits them to permanent storage (DynamoDB) every ~60 seconds.

| Operation | Visibility |
|---|---|
| `flexDbGet` | Immediate — reads from L1/L2 |
| `flexDbDelete` | Immediate — deregisters from write-buffer |
| `flexDbList` | Up to ~60 s lag for newly written objects |
| `flexDbSearch` | Up to ~60 s lag for newly written objects |

This is intentional server behaviour, not a bug. If your API exposes list or search endpoints to end users, document this lag in your own API responses where appropriate.

---

## License

Apache 2.0 © Arctics Development Studios
