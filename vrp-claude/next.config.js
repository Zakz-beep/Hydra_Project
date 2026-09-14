/** @type {import('next').NextConfig} */

// Default ke localhost, tapi bisa di-override lewat file .env
const BACKEND_IP = process.env.NEXT_PUBLIC_BACKEND_IP || "localhost";
const BACKEND_PROTOCOL = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || "http";

const getBackendUrl = (port) => `${BACKEND_PROTOCOL}://${BACKEND_IP}:${port}`;

const nextConfig = {
  experimental: {
    cpus: 1,
    workerThreads: false,
  },
  async rewrites() {
    return [
      {
        source: "/api/onchain/:path*",
        destination: `${getBackendUrl(8014)}/api/onchain/:path*`,
      },
      {
        source: "/api/crypto/:path*",
        destination: `${getBackendUrl(8013)}/api/crypto/:path*`,
      },
      {
        source: "/api/risk/:path*",
        destination: `${getBackendUrl(8002)}/api/risk/:path*`,
      },
      {
        source: "/api/regime/:path*",
        destination: `${getBackendUrl(8007)}/api/regime/:path*`,
      },
      {
        source: "/api/market/:path*", // For OHLCV endpoint in regime_api.py
        destination: `${getBackendUrl(8007)}/api/market/:path*`,
      },
      {
        source: "/api/dcc/:path*",
        destination: `${getBackendUrl(8004)}/api/dcc/:path*`,
      },
      {
        source: "/api/vol/:path*",
        destination: `${getBackendUrl(8006)}/api/vol/:path*`,
      },
      {
        source: "/api/cot/:path*",
        destination: `${getBackendUrl(8008)}/api/cot/:path*`,
      },
      {
        source: "/api/greeks/:path*",
        destination: `${getBackendUrl(8001)}/api/greeks/:path*`,
      },
      {
        source: "/api/dispersion/:path*",
        destination: `${getBackendUrl(8009)}/api/dispersion/:path*`,
      },
      {
        source: "/api/hrp/:path*",
        destination: `${getBackendUrl(8010)}/api/hrp/:path*`,
      },
      {
        source: "/api/beta/:path*",
        destination: `${getBackendUrl(8012)}/api/beta/:path*`,
      },
      // Fallback for VRP API
      {
        // Let the local dynamic macro proxy handle its own timeout/error responses.
        source: "/api/:path((?!(?:macro|agent-center)(?:/|$)).*)",
        destination: `${getBackendUrl(8000)}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
