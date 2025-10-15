/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },

  // Разрешаем встраивание страниц /embed/* в iframe на внешних доменах.
  async headers() {
    return [
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https: http:;",
          },
          {
            key: 'X-Frame-Options',
            value: 'ALLOWALL',
          },
        ],
      },
    ];
  },

  webpack: (config, { dev }) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /[\\/]@next[\\/]react-refresh-utils[\\/]/,
        message: /source map/i,
      },
      { message: /Failed to parse source map|Could not read source map/i },
    ];
    if (dev) {
      config.devtool = false;
    }

    return config;
  },
};

module.exports = nextConfig;
