import type React from 'react';
import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModalSize } from '@starter-template/types';
import { cn } from '@starter-template/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  closable?: boolean;
  maskClosable?: boolean;
  destroyOnClose?: boolean;
  className?: string;
}

const sizeStyles: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[calc(100vw-2rem)]',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closable = true,
  maskClosable = true,
  destroyOnClose = false,
  className,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closable) onClose();
    },
    [onClose, closable],
  );

  useEffect(() => {
    if (open) {
      setMounted(true);
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (destroyOnClose) setMounted(false);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown, destroyOnClose]);

  if (!open && !mounted) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200',
        open ? 'visible opacity-100' : 'invisible opacity-0',
      )}
      onClick={(e) => {
        if (maskClosable && e.target === overlayRef.current) onClose();
      }}
    >
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full rounded-2xl bg-white shadow-modal transition-all duration-200',
          sizeStyles[size],
          open ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
          className,
        )}
      >
        {/* Header */}
        {(title || closable) && (
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            {typeof title === 'string' ? (
              <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            ) : (
              title
            )}
            {closable && (
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
