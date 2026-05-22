import type { Metadata } from 'next';
import { AuthProvider } from '@starter-template/auth';
import { ToastProvider } from '@starter-template/ui';
import './globals.css';

export const metadata: Metadata = {
  title: 'Starter Template',
  description: 'Modern monorepo frontend starter',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
