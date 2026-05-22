import { cn } from '@starter-template/utils';

// ── Spinner ──

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const spinnerSizes = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin text-primary-600', spinnerSizes[size], className)}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Page Loading ──

export interface PageLoadingProps {
  message?: string;
  className?: string;
}

export function PageLoading({ message = 'Loading...', className }: PageLoadingProps) {
  return (
    <div className={cn('flex min-h-64 flex-col items-center justify-center gap-4', className)}>
      <Spinner size="lg" />
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}

// ── Skeleton ──

export interface SkeletonProps {
  className?: string;
  /** 预设形状 */
  variant?: 'text' | 'circle' | 'rect';
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className, variant = 'text', width, height }: SkeletonProps) {
  const variantStyles = {
    text: 'h-4 w-full rounded',
    circle: 'rounded-full',
    rect: 'rounded-lg',
  };

  return (
    <div
      className={cn('animate-pulse bg-gray-200', variantStyles[variant], className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

// ── Skeleton Group ──

export interface SkeletonGroupProps {
  count?: number;
  className?: string;
}

export function SkeletonGroup({ count = 3, className }: SkeletonGroupProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton variant="circle" width={40} height={40} />
          <div className="flex-1 space-y-2">
            <Skeleton width="60%" />
            <Skeleton width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}
