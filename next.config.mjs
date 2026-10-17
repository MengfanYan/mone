/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir:
    process.env.WALLET_UI_MODE === "demo"
      ? ".next-demo"
      : process.env.WALLET_UI_MODE === "cloud"
        ? ".next-cloud"
        : ".next",
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(self), on-device-speech-recognition=(self), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
