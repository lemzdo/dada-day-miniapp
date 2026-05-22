import type React from 'react';
import type { ButtonVariant, ButtonSize } from '@starter-template/types';
import { cn } from '@starter-template/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconOnly?: boolean;
  block?: boolean;
  pill?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 shadow-sm',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200 active:bg-gray-300',
  outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100',
  ghost: 'text-gray-600 hover:bg-gray-100 active:bg-gray-200',
  danger: 'bg-danger text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5 rounded-md min-h-touch min-w-touch',
  md: 'px-4 py-2.5 text-sm gap-2 rounded-lg min-h-touch min-w-touch',
  lg: 'px-6 py-3 text-base gap-2.5 rounded-lg',
};

const iconOnlySizes: Record<ButtonSize, string> = {
  sm: 'p-1.5',
  md: 'p-2.5',
  lg: 'p-3',
};

const base =
  'inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:ring-offset-1 disabled:opacity-40 disabled:pointer-events-none select-none';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconOnly = false,
  block = false,
  pill = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        base,
        variantStyles[variant],
        iconOnly ? iconOnlySizes[size] : sizeStyles[size],
        block && 'w-full',
        pill && 'rounded-full',
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : icon ? <span className="shrink-0">{icon}</span> : null}
      {!iconOnly && children}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
