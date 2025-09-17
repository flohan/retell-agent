import { ZodError } from "zod";

export function fail(res, err) {
  const status =
    err?.status ?? err?.statusCode ?? (err instanceof ZodError ? 400 : 500);
  const payload =
    err instanceof ZodError
      ? { error: "validation_error", details: err.issues }
      : { error: err?.code || "internal_error", message: err?.message || "Internal Server Error" };

  res.status(status).json(payload);
}
