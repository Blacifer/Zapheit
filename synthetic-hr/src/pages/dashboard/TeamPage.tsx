import { useContext } from 'react';
import { AppContext } from '../../context/AppContext';

export default function TeamPage() {
  const context = useContext(AppContext);
  const user = context?.user;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Team Management</h1>
        <p className="text-slate-400 mt-2">Manage your organization</p>
      </div>

      <div className="bg-slate-800/30 border border-slate-700 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Your Organization</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Organization Name</span>
            <span className="text-white font-medium">{user?.organizationName}</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Plan</span>
            <span className="text-white font-medium">Starter</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-lg">
            <span className="text-slate-400">Members</span>
            <span className="text-white font-medium">1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
