import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // concord/ has its own package-lock.json, so Next/Turbopack auto-detects
  // it as the project root and refuses to resolve imports reaching outside
  // it (e.g. "../crdt/src/rga"). Widen the root to the actual repo root.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
