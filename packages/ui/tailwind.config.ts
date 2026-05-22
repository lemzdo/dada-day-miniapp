import type { Config } from 'tailwindcss';
import preset from './tailwind-preset';

const config: Config = {
  presets: [preset],
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
};

export default config;
