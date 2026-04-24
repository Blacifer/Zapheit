import { useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Briefcase, Send, Activity, Bot, Loader2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';

const CandidateList       = lazy(() => import('./CandidateList'));
const JobPostings         = lazy(() => import('./JobPostings'));
const OutreachTab         = lazy(() => import('./OutreachTab'));
const RecruitmentActivity = lazy(() => import('./RecruitmentActivityTab'));
const RecruitmentAutomation = lazy(() => import('./RecruitmentAutomationTab'));

type Tab = 'candidates' | 'jobs' | 'outreach' | 'activity' | 'automation';

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: 'candidates', label: 'Candidates',   Icon: Users },
  { id: 'jobs',       label: 'Job Postings', Icon: Briefcase },
  { id: 'outreach',   label: 'Outreach',     Icon: Send },
  { id: 'activity',   label: 'Activity',     Icon: Activity },
  { id: 'automation', label: 'Automation',   Icon: Bot },
];

const TabFallback = () => (
  <div className="flex-1 flex items-center justify-center text-slate-500">
    <Loader2 className="w-5 h-5 animate-spin" />
  </div>
);

export default function RecruitmentWorkspace() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('candidates');

  return (
    <div className="flex flex-col h-full bg-[#080b12]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-white/8 shrink-0">
        <button
          onClick={() => navigate('/dashboard/apps')}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <Briefcase className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-white">Recruitment Workspace</h1>
          <p className="text-[11px] text-slate-500">LinkedIn Recruiter · Naukri · governed hiring actions</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-white/5 shrink-0 overflow-x-auto">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              activeTab === id
                ? 'bg-white/10 text-white'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <Suspense fallback={<TabFallback />}>
          {activeTab === 'candidates'  && <CandidateList />}
          {activeTab === 'jobs'        && <JobPostings />}
          {activeTab === 'outreach'    && <OutreachTab />}
          {activeTab === 'activity'    && <RecruitmentActivity />}
          {activeTab === 'automation'  && <RecruitmentAutomation />}
        </Suspense>
      </div>
    </div>
  );
}
