import jwt from "jsonwebtoken";

/** The claims pbandj puts in its JWTs (see pbandj's server/index.js). */
export interface AuthClaims {
  userId: string;
  email: string;
  username: string;
  role: string;
}

/**
 * Verifies a token issued by pbandj's own login, using the same SESSION_SECRET —
 * there is no separate login here, cwb-foundry just recognizes pbandj's accounts.
 * Returns null for any failure (missing secret, expired, tampered, wrong shape)
 * rather than throwing, so callers can treat "no valid user" as one simple case.
 */
export function verifyToken(token: string): AuthClaims | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload !== "object" || payload === null) return null;
    const { userId, email, username, role } = payload as Record<string, unknown>;
    if (typeof userId !== "string" || typeof email !== "string" || typeof username !== "string") return null;
    return { userId, email, username, role: typeof role === "string" ? role : "PLAYER" };
  } catch {
    return null;
  }
}

/** Extracts and verifies the bearer token from a request's Authorization header. */
export function authenticate(request: Request): AuthClaims | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyToken(header.slice(7));
}
