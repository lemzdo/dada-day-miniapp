import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@starter-template/ui',
    '@starter-template/api',
    '@starter-template/types',
    '@starter-template/utils',
    '@starter-template/hooks',
    '@starter-template/auth',
    '@starter-template/ai',
  ],

  // 图片文件通过 /uploads/[...path] Route Handler 提供服务（见 src/app/uploads/）
  // 不需要额外配置
};

export default nextConfig;
