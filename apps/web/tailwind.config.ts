import type { Config } from 'tailwindcss';
import preset from '../../packages/ui/tailwind-preset';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}', '../../packages/ui/src/**/*.{js,ts,jsx,tsx}'],
};

export default config;
