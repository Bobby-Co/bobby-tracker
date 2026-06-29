import type { NextConfig } from "next";

// Supabase origin (REST + realtime websocket) must be allowed in connect-src
// so the browser client can reach the API. Derived from the public env var so
// the CSP follows whatever project this builds against.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseHost = (() => {
  try { return new URL(supabaseUrl).host; } catch { return ""; }
})();
const supabaseConnect = supabaseHost ? ` https://${supabaseHost} wss://${supabaseHost}` : "";

// Content-Security-Policy. 'unsafe-inline' is retained for script/style because
// Next.js injects inline bootstrap/hydration scripts and framer-motion/Tailwind
// emit inline styles, and this app does not run a nonce middleware. CSP here is
// defense-in-depth: it still blocks injected external script sources, framing,
// base-uri hijacking, plugin content, and cross-origin form exfiltration.
// (Markdown XSS is independently mitigated — react-markdown without rehype-raw.)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  `connect-src 'self'${supabaseConnect}`,
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['devserver-development--bobby-tracker.netlify.app'],
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
