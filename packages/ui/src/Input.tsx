import type React from 'react';
import type { InputSize } from '@starter-template/types';
import { cn } from '@starter-template/utils';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  fullWidth?: boolean;
  rows?: number;
}

const sizeStyles: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-sm min-h-touch',
  md: 'px-3.5 py-2.5 text-sm min-h-touch',
  lg: 'px-4 py-3 text-base',
};

const iconPadLeft: Record<InputSize, string> = {
  sm: 'pl-9',
  md: 'pl-10',
  lg: 'pl-11',
};

const inputBase =
  'block w-full rounded-lg border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 transition-colors duration-150 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none disabled:opacity-50 disabled:bg-gray-50';

export function Input({
  size = 'md',
  label,
  hint,
  error,
  leftIcon,
  rightIcon,
  fullWidth = true,
  className,
  id,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className={cn(fullWidth && 'w-full')}>
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{leftIcon}</span>
        )}
        <input
          id={inputId}
          className={cn(
            inputBase,
            sizeStyles[size],
            leftIcon && iconPadLeft[size],
            rightIcon && 'pr-10',
            error && 'border-danger focus:border-danger focus:ring-danger/20',
            className,
          )}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {rightIcon}
          </span>
        )}
      </div>
      {hint && !error && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Textarea({
  label,
  hint,
  error,
  fullWidth = true,
  className,
  rows = 3,
  id,
  ...props
}: TextareaProps) {
  const areaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className={cn(fullWidth && 'w-full')}>
      {label && (
        <label htmlFor={areaId} className="mb-1.5 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <textarea
        id={areaId}
        rows={rows}
        className={cn(
          inputBase,
          'px-3.5 py-2.5 text-sm resize-y',
          error && 'border-danger focus:border-danger focus:ring-danger/20',
          className,
        )}
        {...props}
      />
      {hint && !error && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
