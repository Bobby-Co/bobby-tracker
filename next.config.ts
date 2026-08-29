import type { NextConfig } from "next";

// Supabase origin (REST + realtime websocket) must be allowed in connect-src
// so the browser client can reach the API. Derived from the public env var so
// the CSP follows whatever project this builds against.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseHost = (() => {
  try { return new URL(supabaseUrl).host; } catch { return ""; }
})();
const supabaseConnect = supabaseHost ? ` https://${supabaseHost} wss://${supabaseHost}` : "";

// Zoo embed images are loaded by <img>, so the Zoo origin has to be allowed in
// img-src. In production it already is: Zoo is https, and img-src permits any
// https host. A LOCAL Zoo is not — `http://127.0.0.1:8787` matches neither
// 'self' (different port is a different origin) nor https:, so every embed is
// blocked by CSP with the signature, the key and the route all working
// perfectly. This adds the configured origin only when it is not https, which
// in practice means loopback during development.
//
// Read at BUILD time, like the Supabase host above — which is fine precisely
// because the only case it covers is the dev server, where .env is loaded
// before next dev starts. Deployed builds take the https: branch and need
// nothing from the Worker's runtime secret.
const zooEmbedImg = (() => {
  const raw = (process.env.ZOO_EMBED_HOST || "").trim();
  if (!raw) return "";
  try {
    const { protocol, origin } = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return protocol === "https:" ? "" : ` ${origin}`;   // https is already covered
  } catch { return ""; }
})();

// Content-Security-Policy. 'unsafe-inline' is retained for script/style because
// Next.js injects inline bootstrap/hydration scripts and framer-motion/Tailwind
// emit inline styles, and this app does not run a nonce middleware. CSP here is
// defense-in-depth: it still blocks injected external script sources, framing,
// base-uri hijacking, plugin content, and cross-origin form exfiltration.
// (Markdown XSS is independently mitigated — react-markdown without rehype-raw.)
// HSTS + `upgrade-insecure-requests` force the browser onto HTTPS. That's
// correct in production (real TLS via Cloudflare) but breaks `next dev`, which
// serves plain HTTP on localhost — the browser would refuse to connect and
// try https://localhost:3000. So apply both only in production.
const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' only in dev: Turbopack + React dev-mode need eval() for HMR
  // and debug callstacks. Production React never uses eval, so it stays out.
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https:${zooEmbedImg}`,
  `connect-src 'self'${supabaseConnect}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  // form-action governs where a form may submit AND, in browsers, where a
  // submission may be REDIRECTED to. 'self' alone silently breaks the OAuth
  // consent screen: the Approve form posts to /api/oauth/authorize (same origin,
  // fine) and the server answers 303 to the client's redirect_uri — which the
  // browser then blocks, with no navigation and no error the user can see.
  //
  // Widened to exactly the redirect targets the OAuth server already accepts
  // (see modules/mcp-oauth/domain/RedirectUris): any https, or http on loopback
  // for a native client's callback (RFC 8252 §7.3). That policy — an exact match
  // against the client's registered URIs — is the real gate; this header can only
  // ever be a coarser echo of it.
  //
  // Scoping this to /oauth/consent alone was considered and rejected: it needs a
  // negative-lookahead source on the catch-all entry, and if that pattern is even
  // slightly wrong EVERY page silently loses its security headers. A fail-open
  // failure mode is not worth trading for, particularly when `img-src https:`
  // above already leaves an injected script a perfectly good exfiltration path,
  // so form-action is not the binding constraint in this app's threat model.
  //
  // (CSP's host grammar has no formal syntax for an IPv6 literal, so a browser
  // may ignore the `[::1]` source. Harmless — a client registering an IPv6
  // loopback callback is vanishingly rare, and it is no worse than omitting it.)
  "form-action 'self' https: http://127.0.0.1:* http://[::1]:* http://localhost:*",
  "object-src 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['devserver-development--bobby-tracker.netlify.app','192.168.1.134'],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
