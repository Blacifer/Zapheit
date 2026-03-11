/**
 * Local Storage Utilities
 * Safe, type-safe wrappers for localStorage operations
 */

export const STORAGE_KEYS = {
  AGENTS: 'synthetic_hr_agents',
  INCIDENTS: 'synthetic_hr_incidents',
  COST_DATA: 'synthetic_hr_cost_data',
  API_KEYS: 'synthetic_hr_api_keys',
  NOTIFICATIONS: 'synthetic_hr_notifications',
  RETENTION_DAYS: 'synthetic_hr_retention_days',
} as const;

/**
 * Load data from localStorage with type safety
 */
export const loadFromStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    // Check if we're in browser environment
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch (error) {
    console.error(`Failed to load from storage (${key}):`, error);
    return defaultValue;
  }
};

/**
 * Save data to localStorage with error handling
 */
export const saveToStorage = <T,>(key: string, data: T): void => {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('Storage quota exceeded. Please clear some data.');
    }
    console.error(`Failed to save to storage (${key}):`, error);
  }
};

/**
 * Remove data from localStorage
 */
export const removeFromStorage = (key: string): void => {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Failed to remove from storage (${key}):`, error);
  }
};

/**
 * Clear all RasiSyntheticHR data from localStorage
 */
export const clearAllStorage = (): void => {
  try {
    if (typeof window === 'undefined') {
      return;
    }

    Object.values(STORAGE_KEYS).forEach((key) => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('Failed to clear storage:', error);
  }
};
