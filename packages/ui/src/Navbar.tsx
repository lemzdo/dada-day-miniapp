import type React from 'react';
import { cn } from '@starter-template/utils';

export interface NavbarProps {
  /** 左侧区域 */
  left?: React.ReactNode;
  /** 标题（字符串或自定义元素） */
  title?: React.ReactNode;
  /** 右侧区域 */
  right?: React.ReactNode;
  /** 是否固定顶部 */
  fixed?: boolean;
  /** 是否显示底部边框 */
  bordered?: boolean;
  /** 背景是否透明 */
  transparent?: boolean;
  className?: string;
}

export function Navbar({
  left,
  title,
  right,
  fixed = false,
  bordered = true,
  transparent = false,
  className,
}: NavbarProps) {
  return (
    <nav
      className={cn(
        'flex h-14 items-center justify-between px-4',
        fixed && 'fixed inset-x-0 top-0 z-50',
        bordered && 'border-b border-gray-200',
        transparent ? 'bg-transparent' : 'bg-white/80 backdrop-blur-md',
        className,
      )}
    >
      {/* Left */}
      <div className="flex min-w-0 items-center gap-2">{left ?? <div className="w-10" />}</div>

      {/* Title */}
      <div className="flex-1 truncate text-center">
        {typeof title === 'string' ? (
          <h1 className="truncate text-base font-semibold text-gray-900">{title}</h1>
        ) : (
          title
        )}
      </div>

      {/* Right */}
      <div className="flex min-w-0 items-center justify-end gap-1">
        {right ?? <div className="w-10" />}
      </div>
    </nav>
  );
}

// ── Back Button Helper ──

export interface NavbarBackProps {
  onClick: () => void;
  label?: string;
}

export function NavbarBack({ onClick, label }: NavbarBackProps) {
  return (
    <button
      onClick={onClick}
      className="-ml-2 flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 transition-colors hover:bg-gray-100"
      aria-label={label ?? 'Back'}
    >
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
