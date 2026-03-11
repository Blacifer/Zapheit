// Global Toast Utilities
// A simple toast system that doesn't require React context

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

let toasts: ToastMessage[] = [];
let listeners: ((toasts: ToastMessage[]) => void)[] = [];

const createToast = (type: ToastType, message: string): ToastMessage => {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const toast: ToastMessage = { id, type, message };

  // Auto-remove after duration
  const duration = type === 'error' ? 6000 : 4000;
  setTimeout(() => {
    removeToast(id);
  }, duration);

  return toast;
};

const addToast = (toast: ToastMessage) => {
  toasts = [...toasts, toast];
  listeners.forEach(listener => listener(toasts));
};

const removeToast = (id: string) => {
  toasts = toasts.filter(t => t.id !== id);
  listeners.forEach(listener => listener(toasts));
};

export const toast = {
  success: (message: string) => addToast(createToast('success', message)),
  error: (message: string) => addToast(createToast('error', message)),
  warning: (message: string) => addToast(createToast('warning', message)),
  info: (message: string) => addToast(createToast('info', message)),
};

// Subscribe to toast changes
export const subscribeToToasts = (listener: (toasts: ToastMessage[]) => void) => {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
};

// Get current toasts
export const getToasts = () => toasts;
