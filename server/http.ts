import type { Request } from 'express';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function body<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
    throw new HttpError(400, msg);
  }
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${name}`);
  return n;
}

/** The signed-in user; routes behind requireRole always have one. */
export function me(req: Request) {
  if (!req.user) throw new HttpError(401, 'Not signed in');
  return req.user;
}
