// RBAC (Role-Based Access Control) Hook
// Enforces permission checking throughout the application

import { useMemo } from 'react';
import { Permission, ROLE_PERMISSIONS, hasPermission } from '../types';

// Hook to check if current user has a specific permission
export const usePermission = (
  userRole: string | null,
  requiredPermission: Permission
): boolean => {
  return useMemo(() => {
    if (!userRole) return false;
    const permissions = ROLE_PERMISSIONS[userRole] || [];
    return hasPermission(permissions, requiredPermission);
  }, [userRole, requiredPermission]);
};

// Hook to check multiple permissions (all must match)
export const usePermissions = (
  userRole: string | null,
  requiredPermissions: Permission[]
): boolean => {
  return useMemo(() => {
    if (!userRole) return false;
    const permissions = ROLE_PERMISSIONS[userRole] || [];
    return requiredPermissions.every(p => hasPermission(permissions, p));
  }, [userRole, requiredPermissions]);
};

// Hook to check if user has any of the specified permissions
export const useAnyPermission = (
  userRole: string | null,
  requiredPermissions: Permission[]
): boolean => {
  return useMemo(() => {
    if (!userRole) return false;
    const permissions = ROLE_PERMISSIONS[userRole] || [];
    return requiredPermissions.some(p => hasPermission(permissions, p));
  }, [userRole, requiredPermissions]);
};

// Higher-order component for permission-gated rendering
export const withPermission = <P extends object>(
  Component: React.ComponentType<P>,
  requiredPermission: Permission,
  userRole: string | null
) => {
  return function WrappedComponent(props: P) {
    const hasAccess = usePermission(userRole, requiredPermission);

    if (!hasAccess) {
      return null;
    }

    return <Component {...props} />;
  };
};

// Permission-gated component
interface PermissionGateProps {
  children: React.ReactNode;
  userRole: string | null;
  requiredPermission: Permission;
  fallback?: React.ReactNode;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  children,
  userRole,
  requiredPermission,
  fallback = null
}) => {
  const hasAccess = usePermission(userRole, requiredPermission);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

// Role-gated component
interface RoleGateProps {
  children: React.ReactNode;
  userRole: string | null;
  allowedRoles: string[];
  fallback?: React.ReactNode;
}

export const RoleGate: React.FC<RoleGateProps> = ({
  children,
  userRole,
  allowedRoles,
  fallback = null
}) => {
  const hasAccess = useMemo(() => {
    return userRole !== null && allowedRoles.includes(userRole);
  }, [userRole, allowedRoles]);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

// Get permission label for display
export const getPermissionLabel = (permission: Permission): string => {
  const labels: Record<Permission, string> = {
    'agents.create': 'Create Agents',
    'agents.read': 'View Agents',
    'agents.update': 'Edit Agents',
    'agents.delete': 'Delete Agents',
    'agents.kill': 'Use Kill Switch',
    'incidents.create': 'Create Incidents',
    'incidents.read': 'View Incidents',
    'incidents.update': 'Edit Incidents',
    'incidents.resolve': 'Resolve Incidents',
    'incidents.delete': 'Delete Incidents',
    'costs.create': 'Create Cost Entries',
    'costs.read': 'View Costs',
    'costs.update': 'Edit Costs',
    'costs.delete': 'Delete Costs',
    'dashboard.read': 'View Dashboard',
    'settings.read': 'View Settings',
    'settings.update': 'Modify Settings'
  };

  return labels[permission] || permission;
};

// Get role label for display
export const getRoleLabel = (role: string): string => {
  const labels: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    manager: 'Manager',
    viewer: 'Viewer'
  };

  return labels[role] || role;
};

// Check if role can invite team members
export const canInviteTeam = (role: string | null): boolean => {
  if (!role) return false;
  return ['super_admin', 'admin'].includes(role);
};

// Check if role can manage billing
export const canManageBilling = (role: string | null): boolean => {
  if (!role) return false;
  return role === 'super_admin';
};

// Check if role can delete data
export const canDeleteData = (role: string | null): boolean => {
  if (!role) return false;
  return role === 'super_admin';
};
