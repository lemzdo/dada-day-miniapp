'use client';

import { Button, Card } from '@starter-template/ui';
import { useAuth } from '@starter-template/auth';

export default function HomePage() {
  const { isAuthenticated, user, login, logout, isLoading } = useAuth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Starter Template</h1>
      <p className="text-lg text-gray-600">Next.js + Taro + TailwindCSS + TurboRepo Monorepo</p>

      <Card className="w-full max-w-md">
        {isAuthenticated ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-500">
              Logged in as <strong>{user?.name}</strong>
            </p>
            <Button variant="outline" onClick={logout}>
              Logout
            </Button>
          </div>
        ) : (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-500">Not logged in</p>
            <Button
              onClick={() => login({ code: 'web-demo' }).catch(() => {})}
              loading={isLoading}
            >
              Login (Demo)
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
