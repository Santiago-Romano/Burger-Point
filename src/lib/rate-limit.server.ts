// Best-effort in-memory rate limiting for anonymous server functions.
// Netlify functions are ephemeral, so limits are per instance; this adds a
// cheap first layer against order spam and Geoapify quota exhaustion.
// Provider-level (WAF/Netlify) rate limiting should still be configured.
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

// Returns null when the caller cannot be identified; callers must fail open in
// that case so a missing header never blocks legitimate traffic wholesale.
export async function getClientKey(namespace: string): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const headers = request?.headers;
    if (!headers) return null;
    const forwarded = headers.get("x-forwarded-for");
    const ip =
      headers.get("x-nf-client-connection-ip") ??
      (forwarded ? forwarded.split(",")[0]?.trim() : null) ??
      null;
    if (!ip) return null;
    return `${namespace}:${ip}`;
  } catch {
    return null;
  }
}
