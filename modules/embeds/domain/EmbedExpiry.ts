// Expiry for a signed embed URL — QUANTIZED, not `now + ttl`.
//
// Upstream contract §4. This is a caching decision as much as a security one:
// a per-request `exp` makes every URL unique, so the browser and any CDN miss
// on every page load and re-download every image. Bucketing means every viewer
// of the same issue inside a bucket gets a byte-identical URL.
//
// The `+2` is why we don't just round up: `ceil(now/BUCKET)*BUCKET` hands a
// nearly-expired URL to anyone who loads the page just before a boundary. With
// `+2` the validity window is always between one and two buckets (15–30 min),
// which is also comfortably inside Zoo's hard `exp - now <= 3600` ceiling.

/** 15 minutes. Zoo's quantum, not ours — do not tune this side alone. */
export const EMBED_EXP_BUCKET_SECONDS = 900

/** Zoo rejects any URL whose `exp` is further out than this, whatever we sign. */
export const EMBED_MAX_TTL_SECONDS = 3600

export function embedExpiry(nowSec: number, bucketSeconds = EMBED_EXP_BUCKET_SECONDS): number {
    return (Math.floor(nowSec / bucketSeconds) + 2) * bucketSeconds
}
