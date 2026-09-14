import { HTTPException } from "hono/http-exception";

export function notFound(message = "Not found"): never {
  throw new HTTPException(404, { message });
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

export function unauthorized(message = "Unauthorized"): never {
  throw new HTTPException(401, { message });
}

export function forbidden(message = "Forbidden"): never {
  throw new HTTPException(403, { message });
}

export function tooManyRequests(message = "Too many requests"): never {
  throw new HTTPException(429, { message });
}

export function conflict(message = "Conflict"): never {
  throw new HTTPException(409, { message });
}
