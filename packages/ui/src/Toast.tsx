import type React from 'react';
import { createContext, useContext, useState, useCallback } from 'react';
import type { Toast, ToastOptions, ToastType } from '@starter-template/types';
import { cn } from '@starter-template/utils';

// ── Context ──

interface ToastContextValue {
  toasts: Toast[];
  add: (options: ToastOptions) => string;
  remove: (id: string) => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

// ── Provider ──

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback(
    (options: ToastOptions): string => {
      const id = options.id ?? `toast-${++toastId}`;
      const toast: Toast = {
        id,
        type: options.type ?? 'info',
        message: options.message,
        duration: options.duration ?? 3000,
        position: options.position ?? 'top-center',
        closable: options.closable ?? true,
        createdAt: Date.now(),
      };
      setToasts((prev) => [...prev, toast]);
      if (toast.duration > 0) {
        setTimeout(() => remove(id), toast.duration);
      }
      return id;
    },
    [remove],
  );

  const factory = useCallback(
    (type: ToastType) => (message: string, duration?: number) => add({ type, message, duration }),
    [add],
  );

  return (
    <ToastContext.Provider
      value={{
        toasts,
        add,
        remove,
        success: factory('success'),
        error: factory('error'),
        info: factory('info'),
        warning: factory('warning'),
      }}
    >
      {children}
      <ToastContainer toasts={toasts} remove={remove} />
    </ToastContext.Provider>
  );
}

// ── Hook ──

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ── Container ──

const positionStyles: Record<string, string> = {
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
};

const iconMap: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
  loading: '◌',
};

const colorStyles: Record<ToastType, string> = {
  success: 'border-green-500 bg-green-50 text-green-800',
  error: 'border-red-500 bg-red-50 text-red-800',
  warning: 'border-yellow-500 bg-yellow-50 text-yellow-800',
  info: 'border-blue-500 bg-blue-50 text-blue-800',
  loading: 'border-gray-400 bg-gray-50 text-gray-700',
};

function ToastContainer({ toasts, remove }: { toasts: Toast[]; remove: (id: string) => void }) {
  const grouped = toasts.reduce(
    (acc, t) => {
      (acc[t.position] ??= []).push(t);
      return acc;
    },
    {} as Record<string, Toast[]>,
  );

  return (
    <>
      {Object.entries(grouped).map(([pos, items]) => (
        <div
          key={pos}
          className={cn('fixed z-50 flex flex-col gap-2', positionStyles[pos] ?? 'top-center')}
        >
          {items.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                'flex min-w-72 items-center gap-2.5 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300',
                toast.type === 'loading' && 'animate-pulse',
                colorStyles[toast.type],
              )}
              role="alert"
            >
              <span className="text-lg font-bold">{iconMap[toast.type]}</span>
              <span className="flex-1 text-sm font-medium">{toast.message}</span>
              {toast.closable && (
                <button
                  onClick={() => remove(toast.id)}
                  className="ml-1 rounded p-0.5 text-current opacity-60 hover:opacity-100"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
