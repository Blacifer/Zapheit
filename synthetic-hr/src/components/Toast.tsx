import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeToToasts, getToasts } from '../lib/toast';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  type: ToastVariant;
  message: string;
}

export interface Toast {
  id: string;
  type: ToastVariant;
  message: string;
  duration?: number;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeToToasts((newToasts) => {
      setToasts(newToasts);
    });
    setToasts(getToasts());
    return () => { unsubscribe(); };
  }, []);

  return (
    <>
      {children}
      <ToastContainer toasts={toasts} />
    </>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts }) => {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((toastItem) => (
          <ToastItem key={toastItem.id} toast={toastItem} />
        ))}
      </AnimatePresence>
    </div>
  );
};

interface ToastItemProps {
  toast: ToastMessage;
}

const STYLES: Record<ToastVariant, string> = {
  success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
  error:   'bg-red-500/10 border-red-500/30 text-red-300',
  warning: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  info:    'bg-cyan-500/10 border-cyan-500/30 text-cyan-300',
};

const GLOW: Record<ToastVariant, string> = {
  success: '0 0 20px rgba(16,185,129,0.18)',
  error:   '0 0 20px rgba(239,68,68,0.18)',
  warning: '0 0 20px rgba(245,158,11,0.18)',
  info:    '0 0 20px rgba(34,211,238,0.12)',
};

const ToastItem: React.FC<ToastItemProps> = ({ toast }) => {
  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const isError = toast.type === 'error';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 60, scale: 0.94 }}
      animate={isError
        ? { opacity: 1, x: [60, 0, -5, 4, -2, 0], scale: 1 }
        : { opacity: 1, x: 0, scale: 1 }
      }
      exit={{ opacity: 0, x: 40, scale: 0.94 }}
      transition={isError
        ? { duration: 0.45, ease: 'easeOut' }
        : { type: 'spring', stiffness: 380, damping: 28 }
      }
      style={{ boxShadow: GLOW[toast.type], pointerEvents: 'auto' }}
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm ${STYLES[toast.type]}`}
      role="alert"
    >
      <div className="mt-0.5">{getIcon()}</div>
      <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
    </motion.div>
  );
};

export default ToastProvider;
