import { hasPermission, Role, Permission } from '../rbac';

describe('RBAC Middleware', () => {
  describe('Permission Checking', () => {
    it('should allow super_admin all permissions', () => {
      expect(hasPermission('super_admin', 'agents.kill')).toBe(true);
      expect(hasPermission('super_admin', 'agents.delete')).toBe(true);
      expect(hasPermission('super_admin', 'settings.update')).toBe(true);
    });

    it('should allow admin most permissions except some super_admin ones', () => {
      expect(hasPermission('admin', 'agents.kill')).toBe(true);
      expect(hasPermission('admin', 'agents.create')).toBe(true);
      expect(hasPermission('admin', 'settings.update')).toBe(true);
    });

    it('should restrict manager permissions', () => {
      expect(hasPermission('manager', 'agents.read')).toBe(true);
      expect(hasPermission('manager', 'agents.create')).toBe(true);
      expect(hasPermission('manager', 'agents.delete')).toBe(false);
      expect(hasPermission('manager', 'agents.kill')).toBe(false);
    });

    it('should restrict viewer to read-only', () => {
      expect(hasPermission('viewer', 'agents.read')).toBe(true);
      expect(hasPermission('viewer', 'incidents.read')).toBe(true);
      expect(hasPermission('viewer', 'agents.create')).toBe(false);
      expect(hasPermission('viewer', 'agents.kill')).toBe(false);
      expect(hasPermission('viewer', 'settings.update')).toBe(false);
    });

    it('should return false for undefined role', () => {
      expect(hasPermission(undefined, 'agents.read')).toBe(false);
    });
  });
});
