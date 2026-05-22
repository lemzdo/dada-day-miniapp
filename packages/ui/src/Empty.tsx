import type React from 'react';
import { cn } from '@starter-template/utils';

export interface EmptyProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function Empty({ icon, title = 'No data', description, action, className }: EmptyProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      {icon ? <div className="mb-4 text-gray-300">{icon}</div> : <DefaultIcon />}
      <h3 className="text-base font-semibold text-gray-700">{title}</h3>
      {description && <p className="mt-1.5 max-w-xs text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg
      className="mb-4 h-16 w-16 text-gray-200"
      fill="none"
      viewBox="0 0 64 64"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <rect x="8" y="10" width="48" height="44" rx="4" />
      <line x1="20" y1="28" x2="44" y2="28" />
      <line x1="20" y1="36" x2="36" y2="36" />
    </svg>
  );
}
