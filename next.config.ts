import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Packaging (Unit G). `standalone` makes `next build` emit a self-contained server plus a
   * traced `node_modules` holding only what the application actually imports — which is what
   * lets Market OS run from a staged directory outside this checkout, on a machine with no npm
   * and no source tree.
   *
   * It is NOT sufficient on its own, and the staging builder does not assume it is: Next does not
   * copy `.next/static` or `public` into the standalone folder, and the Prisma migration
   * toolchain is not an import of the server so nothing traces it. `scripts/stage-runtime.ts`
   * copies those explicitly and verifies each one arrived.
   */
  output: "standalone",
};

export default nextConfig;
