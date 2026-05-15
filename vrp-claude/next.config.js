/** @type {import('next').NextConfig} */

// Default ke localhost, tapi bisa di-override lewat file .env
const BACKEND_IP = process.env.NEXT_PUBLIC_BACKEND_IP || "localhost";
const BACKEND_PROTOCOL = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || "http";

const getBackendUrl = (port) => `${BACKEND_PROTOCOL}://${BACKEND_IP}:${port}`;

const nextConfig = {
  async rewrites() {
    return [
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
      // Fallback for VRP API
      {
        source: "/api/:path*",
        destination: `${getBackendUrl(8000)}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
