/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/risk/:path*",
        destination: `${process.env.RISK_API_URL ?? "http://localhost:8002"}/api/risk/:path*`,
      },
      {
        source: "/api/regime/:path*",
        destination: `${process.env.REGIME_API_URL ?? "http://localhost:8007"}/api/regime/:path*`,
      },
      {
        source: "/api/cot/:path*",
        destination: `${process.env.COT_API_URL ?? "http://localhost:8008"}/api/cot/:path*`,
      },
      {
        source: "/api/greeks/:path*",
        destination: `${process.env.GREEKS_API_URL ?? "http://localhost:8001"}/api/greeks/:path*`,
      },
      {
        source: "/api/dispersion/:path*",
        destination: `${process.env.DISPERSION_API_URL ?? "http://localhost:8009"}/api/dispersion/:path*`,
      },
      {
        source: "/api/hrp/:path*",
        destination: `${process.env.HRP_API_URL ?? "http://localhost:8010"}/api/hrp/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${process.env.PYTHON_API_URL ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
