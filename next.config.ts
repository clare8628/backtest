import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Captured once per build/dev-server start so the UI can show when this
  // running version was actually built, not just its semver.
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
