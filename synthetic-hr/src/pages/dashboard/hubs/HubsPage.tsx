import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users, Building2, Shield, Receipt, Headset, Megaphone,
  Briefcase, Fingerprint, ShieldCheck, Layers,
} from 'lucide-react';
import { cn } from '../../../lib/utils';

const HRHubPage = lazy(() => import('../HRHubPage'));
const SalesHubPage = lazy(() => import('../SalesHubPage'));
const ITHubPage = lazy(() => import('../ITHubPage'));
const FinanceHubPage = lazy(() => import('../FinanceHubPage'));
const SupportHubPage = lazy(() => import('../SupportHubPage'));
const MarketingHubPage = lazy(() => import('../MarketingHubPage'));
const ComplianceHubPage = lazy(() => import('../ComplianceHubPage'));
const RecruitmentHubPage = lazy(() => import('../RecruitmentHubPage'));
const IdentityHubPage = lazy(() => import('../IdentityHubPage'));

const DOMAINS = [
  { id: 'hr', label: 'HR', icon: Users },
  { id: 'sales', label: 'Sales', icon: Building2 },
  { id: 'it', label: 'IT', icon: Shield },
  { id: 'finance', label: 'Finance', icon: Receipt },
  { id: 'support', label: 'Support', icon: Headset },
  { id: 'marketing', label: 'Marketing', icon: Megaphone },
  { id: 'recruitment', label: 'Recruitment', icon: Briefcase },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck },
  { id: 'identity', label: 'Identity', icon: Fingerprint },
] as const;

type DomainId = typeof DOMAINS[number]['id'];

function HubLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/15 border-t-cyan-300" />
    </div>
  );
}

const DOMAIN_COMPONENTS: Record<DomainId, React.LazyExoticComponent<React.ComponentType>> = {
  hr: HRHubPage,
  sales: SalesHubPage,
  it: ITHubPage,
  finance: FinanceHubPage,
  support: SupportHubPage,
  marketing: MarketingHubPage,
  recruitment: RecruitmentHubPage,
  compliance: ComplianceHubPage,
  identity: IdentityHubPage,
};

export default function HubsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const domainParam = searchParams.get('domain') as DomainId | null;
  const [activeDomain, setActiveDomain] = useState<DomainId>(
    domainParam && DOMAINS.some(d => d.id === domainParam) ? domainParam : 'hr',
  );

  const handleDomainChange = (domain: DomainId) => {
    setActiveDomain(domain);
    setSearchParams({ domain }, { replace: true });
  };

  const ActiveComponent = DOMAIN_COMPONENTS[activeDomain];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center">
          <Layers className="w-5 h-5 text-cyan-300" />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-white">Hubs</h1>
            <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-200">
              Beta
            </span>
          </div>
          <p className="text-sm text-slate-400">Department-facing workspaces stay visible here while the launch story stays centered on governance, approvals, audit, and cost control.</p>
        </div>
      </div>

      {/* Domain tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-thin -mx-1 px-1">
        {DOMAINS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => handleDomainChange(id)}
            className={cn(
              'flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-xl text-xs md:text-sm font-medium whitespace-nowrap transition-all',
              activeDomain === id
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 shadow-[0_0_12px_rgba(34,211,238,0.1)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent',
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Active hub content */}
      <Suspense fallback={<HubLoading />}>
        <ActiveComponent />
      </Suspense>
    </div>
  );
}
