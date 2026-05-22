import type React from 'react';
import { cn } from '@starter-template/utils';

export interface TabbarItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
  badge?: string | number;
}

export interface TabbarProps {
  items: TabbarItem[];
  activeKey: string;
  onChange: (key: string) => void;
  fixed?: boolean;
  bordered?: boolean;
  className?: string;
}

export function Tabbar({
  items,
  activeKey,
  onChange,
  fixed = true,
  bordered = true,
  className,
}: TabbarProps) {
  return (
    <nav
      className={cn(
        'flex h-14 items-stretch bg-white/80 backdrop-blur-md',
        fixed && 'fixed inset-x-0 bottom-0 z-50',
        bordered && 'border-t border-gray-200',
        className,
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 transition-colors duration-150',
              isActive ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600',
            )}
          >
            <span className="relative">
              {isActive && item.activeIcon ? item.activeIcon : item.icon}
              {item.badge !== undefined && (
                <span className="absolute -right-3 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-2xs font-bold text-white">
                  {typeof item.badge === 'number' && item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </span>
            <span className="text-2xs font-medium">{item.label}</span>
            {isActive && (
              <span className="absolute bottom-0 h-0.5 w-8 rounded-full bg-primary-600" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
