import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

export type Role = 'super_admin' | 'admin' | 'manager' | 'viewer';
export type Permission =
  | 'agents.create'
  | 'agents.read'
  | 'agents.update'
  | 'agents.delete'
  | 'agents.kill'
  | 'incidents.create'
  | 'incidents.read'
  | 'incidents.update'
  | 'incidents.resolve'
  | 'incidents.escalate'
  | 'incidents.delete'
  | 'costs.create'
  | 'costs.read'
  | 'costs.update'
  | 'costs.delete'
  | 'policies.manage'
  | 'compliance.export'
  | 'compliance.log'
  | 'connectors.read'
  | 'connectors.manage'
  | 'team.invite'
  | 'team.manage'
  | 'dashboard.read'
  | 'settings.read'
  | 'settings.update';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'agents.create', 'agents.read', 'agents.update', 'agents.delete', 'agents.kill',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve', 'incidents.escalate', 'incidents.delete',
    'costs.create', 'costs.read', 'costs.update', 'costs.delete',
    'policies.manage',
    'compliance.export', 'compliance.log',
    'connectors.read',
    'connectors.manage',
    'team.invite', 'team.manage',
    'dashboard.read', 'settings.read', 'settings.update',
  ],
  admin: [
    'agents.create', 'agents.read', 'agents.update', 'agents.delete', 'agents.kill',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve', 'incidents.escalate',
    'costs.create', 'costs.read', 'costs.update',
    'policies.manage',
    'compliance.export', 'compliance.log',
    'connectors.read',
    'connectors.manage',
    'team.invite', 'team.manage',
    'dashboard.read', 'settings.read', 'settings.update',
  ],
  manager: [
    'agents.create', 'agents.read', 'agents.update',
    'incidents.create', 'incidents.read', 'incidents.update', 'incidents.resolve', 'incidents.escalate',
    'costs.read',
    'policies.manage',
    'compliance.export', 'compliance.log',
    'connectors.read',
    'dashboard.read', 'settings.read',
  ],
  viewer: [
    'agents.read',
    'incidents.read',
    'costs.read',
    'compliance.log',
    'connectors.read',
    'dashboard.read',
  ],
};

export function hasPermission(role: Role | undefined | string, permission: Permission): boolean {
  if (!role) return false;

  // Fallback to viewer for unknown roles
  const effectiveRole = ROLE_PERMISSIONS[role as Role] ? (role as Role) : 'viewer';

  return ROLE_PERMISSIONS[effectiveRole]?.includes(permission) || false;
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const userRole = (req.user.role || 'viewer') as Role;

    if (!hasPermission(userRole, permission)) {
      logger.warn('Permission denied', {
        user_id: req.user.id,
        role: userRole,
        required_permission: permission,
        endpoint: req.path,
      });

      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        required_permission: permission,
      });
      return;
    }

    next();
  };
}

export function requireRole(roles: Role | Role[]) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const userRole = (req.user.role || 'viewer') as Role;

    if (!allowedRoles.includes(userRole)) {
      logger.warn('Role check failed', {
        user_id: req.user.id,
        user_role: userRole,
        required_roles: allowedRoles,
        endpoint: req.path,
      });

      res.status(403).json({
        success: false,
        error: 'Insufficient role privileges',
        required_roles: allowedRoles,
      });
      return;
    }

    next();
  };
}
