import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  organizationName: string;
}

export interface AppContextType {
  user: AuthUser | null;
  loading: boolean;
  signUp: (email: string, password: string, orgName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

export const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
