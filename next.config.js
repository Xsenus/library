/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },

  async headers() {
    const allowOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || '*';

    return [
      {
        source: '/static/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,HEAD,OPTIONS' },
          { key: 'Timing-Allow-Origin', value: allowOrigin },
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
