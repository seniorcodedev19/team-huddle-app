/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lint runs in the build script before `next build`.
  eslint: { ignoreDuringBuilds: true },
  /* The interviews page became /calendar. Keep the old path working so
     bookmarks and any link already shared do not 404. Permanent, because
     the move is not going to be undone. */
  async redirects() {
    return [{ source: "/interviews", destination: "/calendar", permanent: true }];
  },
};
export default nextConfig;
