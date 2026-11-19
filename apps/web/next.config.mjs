/* Sent with every response. They tell the browser what this site never
   needs, so a mistake elsewhere has less to work with.

   There is no script policy here on purpose: the theme script and Next's own
   bootstrap are inline, so one that allowed them would allow anything, and
   one that did not would need a nonce per request. */
const securityHeaders = [
  // A response is the type it says it is, never guessed.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Other sites learn which site a visitor came from, not which page.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app uses none of these.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  // No plugins, and no <base> tag pointing links somewhere else.
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'" },
];

/* Production only. Refusing to be shown inside a frame stops another site
   from overlaying this one to steal clicks, but an editor's built-in preview
   is itself a frame, so local development keeps working in one. HSTS makes a
   browser that has visited once insist on HTTPS, which localhost does not have. */
const productionHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const headersToSend =
  process.env.NODE_ENV === "production"
    ? [...securityHeaders.filter((h) => h.key !== "Content-Security-Policy"), ...productionHeaders]
    : securityHeaders;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint runs in the build script before `next build`.
  eslint: { ignoreDuringBuilds: true },
  // Do not announce the framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: headersToSend }];
  },
  /* The interviews page became /calendar. Keep the old path working so
     bookmarks and any link already shared do not 404. Permanent, because
     the move is not going to be undone. */
  async redirects() {
    return [{ source: "/interviews", destination: "/calendar", permanent: true }];
  },
};
export default nextConfig;
