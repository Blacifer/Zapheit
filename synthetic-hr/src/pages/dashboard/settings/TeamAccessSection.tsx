import { Edit3, Eye, Lock, Mail, RefreshCw, Save, Send, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from '../../../lib/toast';
import type { TeamEditorState, TeamMember } from './types';

export function TeamAccessSection({
  teamMembers,
  setTeamMembers,
  showInviteModal,
  setShowInviteModal,
  inviteEmail,
  setInviteEmail,
  inviteRole,
  setInviteRole,
  inviting,
  handleInvite,
  dirty,
  handleSaveTeamAccess,
  handleResendInvite,
  handleToggleMemberAccess,
  teamEditor,
  setTeamEditor,
}: {
  teamMembers: TeamMember[];
  setTeamMembers: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  showInviteModal: boolean;
  setShowInviteModal: React.Dispatch<React.SetStateAction<boolean>>;
  inviteEmail: string;
  setInviteEmail: React.Dispatch<React.SetStateAction<string>>;
  inviteRole: 'editor' | 'viewer';
  setInviteRole: React.Dispatch<React.SetStateAction<'editor' | 'viewer'>>;
  inviting: boolean;
  handleInvite: () => void;
  dirty: boolean;
  handleSaveTeamAccess: () => void;
  handleResendInvite: (member: TeamMember) => void;
  handleToggleMemberAccess: (memberId: string) => void;
  teamEditor: TeamEditorState;
  setTeamEditor: React.Dispatch<React.SetStateAction<TeamEditorState>>;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Active operators', value: String(teamMembers.filter((m) => m.status === 'active').length), note: 'People with current workspace access' },
          { label: 'Pending invites', value: String(teamMembers.filter((m) => m.status === 'pending').length), note: 'Invite flow not yet completed' },
          { label: 'Suspended access', value: String(teamMembers.filter((m) => m.status === 'suspended').length), note: 'Access removed without deleting the member' },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-bold text-white">{item.value}</p>
            <p className="mt-1 text-sm text-slate-400">{item.note}</p>
          </div>
        ))}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Team &amp; Access</h2>
          <p className="text-slate-400 text-sm">Control who can operate the workspace, who is waiting on access, and who should be limited.</p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20 text-sm"
        >
          <UserPlus className="w-4 h-4" /> Invite Member
        </button>
      </div>

      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl overflow-hidden">
        <div className="hidden sm:grid grid-cols-12 px-5 py-3 border-b border-slate-700/50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div className="col-span-5">Member</div>
          <div className="col-span-3">Role</div>
          <div className="col-span-3">Status</div>
          <div className="col-span-1"></div>
        </div>

        <div className="divide-y divide-slate-700/30">
          {teamMembers.map((member) => (
            <div key={member.id} className="grid grid-cols-1 sm:grid-cols-12 px-5 py-4 hover:bg-slate-700/20 transition-colors gap-3 sm:gap-0 items-center">
              <div className="col-span-5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                  {member.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{member.name}</p>
                  <p className="text-xs text-slate-500">{member.email}</p>
                </div>
              </div>
              <div className="col-span-3">
                {member.role === 'admin' ? (
                  <span className="px-2.5 py-1 text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded-full">Admin</span>
                ) : (
                  <button
                    onClick={() => setTeamEditor({ memberId: member.id, role: member.role, status: member.status })}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-cyan-500/30 hover:text-white transition-colors"
                  >
                    {member.role === 'editor' ? 'Operator' : 'Viewer'}
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="col-span-3">
                <span className={`px-2.5 py-1 text-[11px] font-bold rounded-full border ${
                  member.status === 'active'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : member.status === 'pending'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-slate-500/10 text-slate-300 border-slate-500/20'
                }`}>
                  {member.status === 'active' ? 'Active' : member.status === 'pending' ? 'Pending invite' : 'Suspended'}
                </span>
              </div>
              <div className="col-span-1 flex justify-end gap-1">
                {member.status === 'pending' && (
                  <button onClick={() => handleResendInvite(member)} className="p-1.5 text-slate-500 hover:text-cyan-300 transition-colors rounded-lg hover:bg-cyan-500/10" title="Resend invite">
                    <Send className="w-4 h-4" />
                  </button>
                )}
                {member.role !== 'admin' && (
                  <button onClick={() => handleToggleMemberAccess(member.id)} className="p-1.5 text-slate-500 hover:text-amber-300 transition-colors rounded-lg hover:bg-amber-500/10" title={member.status === 'suspended' ? 'Restore access' : 'Suspend access'}>
                    <Lock className="w-4 h-4" />
                  </button>
                )}
                {member.role !== 'admin' && (
                  <button onClick={() => setTeamMembers((prev) => prev.filter((m) => m.id !== member.id))} className="p-1.5 text-slate-600 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end">
          <button onClick={handleSaveTeamAccess} className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold rounded-xl flex items-center gap-2 hover:from-cyan-400 hover:to-blue-400 transition-all shadow-lg shadow-cyan-500/20">
            <Save className="w-4 h-4" />
            Save Access Changes
          </button>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-slate-300 mb-3">Role Permissions</h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {[
            { role: 'Admin', color: 'text-purple-400', desc: 'Full access — manage all settings, team, and agents.' },
            { role: 'Operator', color: 'text-cyan-400', desc: 'Can manage agents, incidents, and operational workflows without full admin power.' },
            { role: 'Viewer', color: 'text-slate-300', desc: 'Read-only access to fleet, incidents, and analytics.' },
          ].map((r) => (
            <div key={r.role} className="bg-slate-900/50 rounded-lg p-3">
              <p className={`font-bold mb-1 ${r.color}`}>{r.role}</p>
              <p className="text-slate-500 leading-relaxed">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold text-white">Invite Team Member</h3>
              <button onClick={() => setShowInviteModal(false)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Email Address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  className="w-full px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-cyan-500 transition-all"
                  onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-3">Access Level</label>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { val: 'editor', icon: Edit3, title: 'Editor', sub: 'Can edit agents & settings' },
                    { val: 'viewer', icon: Eye, title: 'Viewer', sub: 'Read-only access' },
                  ] as const).map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => setInviteRole(opt.val)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        inviteRole === opt.val
                          ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400'
                          : 'bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <opt.icon className="w-5 h-5 mb-2" />
                      <p className="font-semibold text-sm">{opt.title}</p>
                      <p className="text-xs mt-0.5 opacity-70">{opt.sub}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2 border-t border-slate-700/50">
                <button onClick={() => setShowInviteModal(false)} className="px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors">Cancel</button>
                <button onClick={handleInvite} disabled={inviting || !inviteEmail} className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-xl hover:from-cyan-400 hover:to-blue-400 disabled:opacity-50 transition-all flex items-center justify-center gap-2">
                  {inviting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  {inviting ? 'Sending…' : 'Send Invitation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {teamEditor && (() => {
        const member = teamMembers.find((entry) => entry.id === teamEditor.memberId);
        if (!member) return null;
        return (
          <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-white">Edit Access</h3>
                  <p className="text-sm text-slate-400 mt-1">{member.email}</p>
                </div>
                <button onClick={() => setTeamEditor(null)} className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-700 transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">Role</label>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { value: 'admin', title: 'Admin', desc: 'Full workspace control' },
                      { value: 'editor', title: 'Operator', desc: 'Runs day-to-day operations' },
                      { value: 'viewer', title: 'Viewer', desc: 'Read-only visibility' },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        disabled={member.role === 'admin' && option.value !== 'admin'}
                        onClick={() => setTeamEditor((current) => (current ? { ...current, role: option.value } : current))}
                        className={`rounded-xl border p-3 text-left transition-all ${teamEditor.role === option.value ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'} disabled:opacity-50`}
                      >
                        <p className="text-sm font-semibold">{option.title}</p>
                        <p className="text-xs mt-1 text-slate-400">{option.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-3">Access state</label>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { value: 'active', title: 'Active' },
                      { value: 'pending', title: 'Pending' },
                      { value: 'suspended', title: 'Suspended' },
                    ] as const).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setTeamEditor((current) => (current ? { ...current, status: option.value } : current))}
                        className={`rounded-xl border p-3 text-sm font-semibold transition-all ${teamEditor.status === option.value ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600'}`}
                      >
                        {option.title}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2 border-t border-slate-700/50">
                  <button onClick={() => setTeamEditor(null)} className="px-5 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors">Cancel</button>
                  <button
                    onClick={() => {
                      setTeamMembers((prev) => prev.map((entry) => entry.id === teamEditor.memberId ? { ...entry, role: teamEditor.role, status: teamEditor.status } : entry));
                      setTeamEditor(null);
                      toast.success('Member access updated.');
                    }}
                    className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-xl hover:from-cyan-400 hover:to-blue-400 transition-all"
                  >
                    Save changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
