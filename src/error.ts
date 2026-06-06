/**
 * # Error utilities
 *
 * Internal helpers that map FlexDB SDK errors to Hono JSON responses.
 * The default error handler is used by all handler factories unless overridden
 * via the `onError` option.
 *
 * @module
 */

import type { Context } from "hono";
import { FlexDBError, FlexDBNetworkError } from "@arctics/flex-db-sdk";

/**
 * Maps a thrown value from the FlexDB SDK to a Hono JSON error response.
 *
 * | Error type              | HTTP status                    | Response code            |
 * |-------------------------|--------------------------------|--------------------------|
 * | {@link FlexDBError}     | Forwarded from `err.status`    | Forwarded from `err.code` |
 * | {@link FlexDBNetworkError} | `503 Service Unavailable`   | `ERR_NETWORK`            |
 * | Anything else           | `500 Internal Server Error`    | `ERR_INTERNAL`           |
 *
 * Internal error messages are **not** forwarded for unknown errors to avoid
 * leaking implementation details.
 *
 * @internal
 */
export function defaultErrorHandler(err: unknown, c: Context): Response {
  if (err instanceof FlexDBError) {
    return c.json(
      { ok: false, error: { code: err.code ?? "ERR_UNKNOWN", message: err.message } },
      // deno-lint-ignore no-explicit-any
      (err.status ?? 500) as any,
    );
  }

  if (err instanceof FlexDBNetworkError) {
    return c.json(
      { ok: false, error: { code: "ERR_NETWORK", message: "Network error connecting to FlexDB." } },
      503,
    );
  }

  return c.json(
    { ok: false, error: { code: "ERR_INTERNAL", message: "Internal server error." } },
    500,
  );
}
