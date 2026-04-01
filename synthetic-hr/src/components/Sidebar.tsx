import { useState } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

function dispatchSearch() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'k',
    metaKey: isMac,
    ctrlKey: !isMac,
    bubbles: true,
  }));
}
import { motion, AnimatePresence } from 'framer-motion';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  Brain, BarChart3, Users, AlertTriangle, MessageSquare, DollarSign,
  Layers, Settings, Sparkles, Zap, Bot, CheckSquare, Shield, ScrollText,
  Key, PlugZap, FileText, ClipboardList, Database, Server,
  User, LogOut, Sun, Moon, Bell, ChevronRight, Search,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  incidentBadge: number;
  unreadCount: number;
  needsOnboarding: boolean;
  isDemoMode?: boolean;
  isLightMode: boolean;
  onToggleTheme: () => void;
  onToggleNotifications: () => void;
  onSignOut: () => void;
  orgName?: string | null;
  email?: string | null;
  role?: string;
}

type NavItem = {
  id: string;
  icon: React.ElementType;
  label: string;
  badge?: number | null;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const CORE_ITEMS: NavItem[] = [
  { id: 'overview', icon: BarChart3, label: 'Overview' },
  { id: 'agents', icon: Users, label: 'Agents' },
  { id: 'incidents', icon: AlertTriangle, label: 'Incidents' },
  { id: 'apps', icon: Layers, label: 'Apps' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

const GROUPS: NavGroup[] = [
  {
    label: 'Advanced',
    items: [
      { id: 'templates', icon: Zap, label: 'Templates' },
      { id: 'agent-library', icon: Bot, label: 'Agent Library' },
      { id: 'playbooks', icon: FileText, label: 'Playbooks' },
      { id: 'action-policies', icon: Shield, label: 'Action Policies' },
      { id: 'conversations', icon: MessageSquare, label: 'Conversations' },
      { id: 'costs', icon: DollarSign, label: 'Costs' },
      { id: 'approvals', icon: CheckSquare, label: 'Approvals' },
      { id: 'audit-log', icon: ScrollText, label: 'Audit Log' },
      { id: 'api-access', icon: Key, label: 'API Access' },
      { id: 'developer', icon: PlugZap, label: 'Developer' },
      { id: 'jobs', icon: ClipboardList, label: 'Run History' },
      { id: 'blackbox', icon: Database, label: 'Black Box' },
      { id: 'runtime-workers', icon: Server, label: 'Runtime Workers' },
    ],
  },
];

const ALL_NON_CORE = new Set(GROUPS.flatMap((g) => g.items.map((i) => i.id)));

function NavBtn({
  item,
  isActive,
  expanded,
  onClick,
}: {
  item: NavItem;
  isActive: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  const btn = (
    <motion.button
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'relative flex items-center rounded-xl transition-colors duration-150 group',
        expanded ? 'w-full gap-3 px-3 py-2.5' : 'w-10 h-10 justify-center mx-auto',
        isActive
          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25'
          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05] border border-transparent',
      )}
    >
      {isActive && (
        <motion.span
          layoutId="sidebar-active-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-cyan-400"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        />
      )}
      <Icon className={cn('shrink-0', expanded ? 'w-4 h-4' : 'w-5 h-5')} aria-hidden />
      {expanded && (
        <span className="flex-1 text-left text-sm font-medium truncate">{item.label}</span>
      )}
      {item.badge != null && item.badge > 0 && (
        <span className={cn(
          'tabular-nums font-semibold text-[10px] rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/25',
          expanded ? 'px-1.5 py-0.5' : 'absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-rose-500 text-white border-0',
        )}>
          {item.badge > 9 ? '9+' : item.badge}
        </span>
      )}
    </motion.button>
  );

  if (expanded) return btn;

  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>{btn}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-[100] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-white shadow-xl"
        >
          {item.label}
          {item.badge != null && item.badge > 0 && (
            <span className="ml-1.5 text-rose-300">({item.badge})</span>
          )}
          <Tooltip.Arrow className="fill-slate-800" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function Sidebar({
  currentPage,
  onNavigate,
  incidentBadge,
  unreadCount,
  needsOnboarding,
  isDemoMode,
  isLightMode,
  onToggleTheme,
  onToggleNotifications,
  onSignOut,
  orgName,
  email,
  role,
}: SidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    if (ALL_NON_CORE.has(currentPage)) {
      return GROUPS.find((g) => g.items.some((i) => i.id === currentPage))?.label ?? null;
    }
    return null;
  });

  const coreWithBadge: NavItem[] = CORE_ITEMS.map((item) =>
    item.id === 'incidents' ? { ...item, badge: incidentBadge } : item,
  );

  return (
    <Tooltip.Provider>
      <motion.aside
        initial={false}
        animate={{ width: expanded ? 224 : 64 }}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
        className="hidden md:flex sidebar-surface flex-col min-h-screen overflow-hidden shrink-0"
      >
        {/* Logo + toggle */}
        <div className={cn('flex items-center mb-5 px-3 pt-4', expanded ? 'justify-between' : 'justify-center')}>
          {expanded ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
                <Brain className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-base font-bold text-white leading-none">RASI</span>
                <span className="text-[10px] text-blue-300 block leading-none mt-0.5">Synthetic HR</span>
              </div>
            </div>
          ) : (
            <div className="w-8 h-8 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center">
              <Brain className="w-5 h-5 text-white" />
            </div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded-lg text-slate-500 hover:text-white hover:bg-white/[0.05] transition-colors"
            aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="w-4 h-4" />
            </motion.div>
          </button>
        </div>

        {/* Search trigger */}
        {expanded ? (
          <button
            onClick={dispatchSearch}
            className="mx-2 mb-3 flex items-center gap-2 w-full px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-500 text-xs hover:border-slate-600 hover:text-slate-400 transition-colors"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-left">Search...</span>
            <kbd className="font-mono text-[10px] bg-slate-700/60 border border-slate-600/50 rounded px-1">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
          </button>
        ) : (
          <Tooltip.Root delayDuration={300}>
            <Tooltip.Trigger asChild>
              <button
                onClick={dispatchSearch}
                className="mx-auto mb-3 w-10 h-10 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-300 hover:bg-white/[0.05] transition-colors"
              >
                <Search className="w-4 h-4" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={10} className="z-[100] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-white shadow-xl">
                Search <kbd className="font-mono ml-1">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
                <Tooltip.Arrow className="fill-slate-800" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}

        {/* Getting Started */}
        {needsOnboarding && (
          <div className={cn('mb-1', expanded ? 'px-2' : 'px-1.5')}>
            <NavBtn
              item={{ id: 'getting-started', icon: Sparkles, label: 'Getting Started' }}
              isActive={currentPage === 'getting-started'}
              expanded={expanded}
              onClick={() => onNavigate('getting-started')}
            />
          </div>
        )}

        {/* Core nav */}
        <nav className={cn('flex-none space-y-0.5', expanded ? 'px-2' : 'px-1.5')} role="navigation" aria-label="Main navigation">
          {coreWithBadge.map((item) => (
            <NavBtn
              key={item.id}
              item={item}
              isActive={currentPage === item.id}
              expanded={expanded}
              onClick={() => onNavigate(item.id)}
            />
          ))}
        </nav>

        {/* Divider */}
        <div className="my-3 mx-3 border-t border-white/[0.06]" />

        {/* Grouped nav */}
        <div className={cn('flex-1 overflow-y-auto space-y-0.5', expanded ? 'px-2' : 'px-1.5')}>
          {GROUPS.map((group) => {
            const isGroupOpen = openGroup === group.label;
            const hasActive = group.items.some((i) => i.id === currentPage);

            if (!expanded) {
              // Collapsed: show all group items as icon-only buttons
              return (
                <div key={group.label} className="space-y-0.5 mb-2">
                  {group.items.map((item) => (
                    <NavBtn
                      key={item.id}
                      item={item}
                      isActive={currentPage === item.id}
                      expanded={false}
                      onClick={() => onNavigate(item.id)}
                    />
                  ))}
                </div>
              );
            }

            return (
              <div key={group.label}>
                <button
                  onClick={() => setOpenGroup(isGroupOpen ? null : group.label)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-[0.14em] transition-colors',
                    hasActive ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400',
                  )}
                >
                  <span className="flex-1 text-left">{group.label}</span>
                  <motion.div
                    animate={{ rotate: isGroupOpen ? 90 : 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {isGroupOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-0.5 pb-1">
                        {group.items.map((item) => (
                          <NavBtn
                            key={item.id}
                            item={item}
                            isActive={currentPage === item.id}
                            expanded={true}
                            onClick={() => onNavigate(item.id)}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className={cn('pt-3 pb-4 border-t border-white/[0.06]', expanded ? 'px-3' : 'px-1.5')}>
          {expanded ? (
            <>
              {/* Demo badge */}
              {isDemoMode && (
                <div className="mb-2 px-1">
                  <span className="px-2 py-0.5 rounded text-xs bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-400 border border-purple-500/30">
                    Demo
                  </span>
                </div>
              )}
              {/* Role badge */}
              {role && (
                <div className="mb-2 px-1">
                  <span className={cn('px-2 py-0.5 rounded text-xs', role === 'super_admin' ? 'bg-purple-400/10 text-purple-400' : role === 'ops_manager' ? 'bg-blue-400/10 text-blue-400' : 'bg-slate-400/10 text-slate-400')}>
                    {role === 'super_admin' ? 'Admin' : role === 'ops_manager' ? 'Manager' : 'Auditor'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white truncate">{orgName}</p>
                  <p className="text-[10px] text-slate-400 truncate">{email}</p>
                </div>
                <button
                  onClick={onToggleTheme}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.05]"
                  title={isLightMode ? 'Switch to dark mode' : 'Switch to dim mode'}
                >
                  {isLightMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={onToggleNotifications}
                  className="relative p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.05]"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                      {unreadCount > 9 ? '9' : unreadCount}
                    </span>
                  )}
                </button>
              </div>
              <button
                onClick={onSignOut}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/[0.03]"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={onToggleNotifications}
                    className="relative p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.05]"
                  >
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
                        {unreadCount > 9 ? '9' : unreadCount}
                      </span>
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="right" sideOffset={10} className="z-[100] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-white shadow-xl">
                    Notifications
                    <Tooltip.Arrow className="fill-slate-800" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={onToggleTheme}
                    className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/[0.05]"
                  >
                    {isLightMode ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="right" sideOffset={10} className="z-[100] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-white shadow-xl">
                    Toggle theme
                    <Tooltip.Arrow className="fill-slate-800" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={onSignOut}
                    className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/[0.03]"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="right" sideOffset={10} className="z-[100] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-white shadow-xl">
                    Sign Out
                    <Tooltip.Arrow className="fill-slate-800" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </div>
          )}
        </div>
      </motion.aside>
    </Tooltip.Provider>
  );
}
