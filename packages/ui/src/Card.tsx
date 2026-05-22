import type React from 'react';
import type { CardPadding } from '@starter-template/types';
import { cn } from '@starter-template/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
  hover?: boolean;
  bordered?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

const paddingMap: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
};

export function Card({
  padding = 'md',
  hover = false,
  bordered = true,
  header,
  footer,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white',
        bordered ? 'border border-gray-200' : 'shadow-card',
        hover && 'transition-shadow duration-200 hover:shadow-dropdown',
        className,
      )}
      {...props}
    >
      {header && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          {typeof header === 'string' ? (
            <h3 className="text-base font-semibold text-gray-900">{header}</h3>
          ) : (
            header
          )}
        </div>
      )}
      <div
        className={cn(
          header && !footer ? paddingMap[padding] : '',
          !header && !footer ? paddingMap[padding] : '',
        )}
      >
        {children}
      </div>
      {footer && (
        <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3 text-sm text-gray-500">
          {footer}
        </div>
      )}
    </div>
  );
}
