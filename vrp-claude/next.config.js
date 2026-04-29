/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/risk/:path*",
        destination: `${process.env.RISK_API_URL ?? "http://localhost:8002"}/api/risk/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${process.env.PYTHON_API_URL ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
