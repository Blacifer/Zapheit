const en = {
  // ── Navigation ──────────────────────────────────────────────────────────────
  nav: {
    overview:        'Overview',
    agents:          'My AI Workforce',
    apps:            'Connected Apps',
    chat:            'Chat',
    agentStudio:     'Create an Assistant',
    rules:           'Rules',
    approvals:       'Human Review',
    incidents:       'Safety Alerts',
    auditLog:        'Activity History',
    costs:           'Usage & Spending',
    roi:             'Your ROI',
    usage:           'Usage & Plan',
    settings:        'Settings',
    developerSettings: 'Developer Settings',
    gettingStarted:  'Getting Started',
  },

  // ── Common ───────────────────────────────────────────────────────────────────
  common: {
    save:        'Save',
    cancel:      'Cancel',
    confirm:     'Confirm',
    delete:      'Delete',
    edit:        'Edit',
    add:         'Add',
    remove:      'Remove',
    refresh:     'Refresh',
    loading:     'Loading…',
    error:       'Something went wrong',
    retry:       'Try again',
    search:      'Search',
    filter:      'Filter',
    export:      'Export',
    close:       'Close',
    back:        'Back',
    next:        'Next',
    done:        'Done',
    learnMore:   'Learn more',
    viewAll:     'View all',
    noData:      'No data yet',
    noResults:   'No results found',
    copyId:      'Copy ID',
    copied:      'Copied!',
    signOut:     'Sign out',
    signIn:      'Sign in',
    signUp:      'Sign up',
  },

  // ── Home / Overview ──────────────────────────────────────────────────────────
  overview: {
    title:               'Overview',
    subtitle:            "What's running, what needs attention, and what to do next.",
    everythingGood:      'Everything running smoothly',
    problemsNeedAttention: '{{count}} problem needs attention',
    problemsNeedAttention_other: '{{count}} problems need attention',
    needsAttention:      'Needs your attention',
    killSwitch:          'Pause all',
    resumeAll:           'Resume all',
    allPaused:           'All AI assistants are paused',
    assistantsRunning:   '{{count}} AI assistant running',
    assistantsRunning_other: '{{count}} AI assistants running',
    messagesThisWeek:    '{{count}} messages this week',
    approvalsWaiting:    '{{count}} approval waiting',
    approvalsWaiting_other: '{{count}} approvals waiting',
    estimatedCost:       '{{amount}} this month',
  },

  // ── Agents ───────────────────────────────────────────────────────────────────
  agents: {
    title:        'My AI Workforce',
    addAgent:     'Add assistant',
    noAgents:     'No assistants yet',
    status: {
      active:      'Active',
      paused:      'Paused',
      terminated:  'Terminated',
    },
    goLive:       'Go live',
    pause:        'Pause',
    resume:       'Resume',
    delete:       'Delete assistant',
    healthScore:  'Health score',
  },

  // ── Approvals ─────────────────────────────────────────────────────────────────
  approvals: {
    title:          'Action Inbox',
    subtitle:       'Sensitive requests requiring your review.',
    queue:          'Queue',
    history:        'History',
    allow:          'Allow',
    block:          'Block',
    cancel:         'Cancel',
    snooze:         'Snooze',
    delegate:       'Delegate',
    addNote:        'Add note',
    autoBlocked:    'Auto-blocked after 24hrs if no response',
    wantsTo:        'Your AI wants to',
    riskScore:      'Risk {{score}}/100',
    emptyQueue:     'Queue is empty',
    noRequests:     'No pending approval requests',
    bulkApprove:    'Approve all {{count}} "{{action}}" requests',
    similarRequests: 'Similar requests — approve in bulk',
  },

  // ── Incidents / Safety Alerts ─────────────────────────────────────────────────
  incidents: {
    title:       'Safety Alerts',
    subtitle:    'Real-time detection of policy violations, PII leaks, and unusual activity.',
    open:        'Open',
    resolved:    'Resolved',
    critical:    'Critical',
    high:        'High',
    medium:      'Medium',
    low:         'Low',
    resolve:     'Resolve',
    investigate: 'Investigate',
    liveStream:  'Live stream connected',
    piiDetected: 'Private data was shared',
    hallucination: 'Possibly made-up answer flagged',
  },

  // ── Activity History (Audit Log) ─────────────────────────────────────────────
  auditLog: {
    title:    'Activity History',
    subtitle: 'Every action your AI workforce has taken, immutably recorded.',
    noEvents: 'No activity recorded yet',
  },

  // ── Usage & Spending (Costs) ──────────────────────────────────────────────────
  costs: {
    title:         'Usage & Spending',
    subtitle:      'Monitor what your AI workforce is spending and where.',
    messages:      '{{count}} message',
    messages_other: '{{count}} messages',
    thisMonth:     'This month',
    noData:        'No usage data yet',
    noDataDesc:    'Route your first request through Zapheit to start tracking.',
    connectApp:    'Connect an app',
    viewAgents:    'View assistants',
  },

  // ── Settings ──────────────────────────────────────────────────────────────────
  settings: {
    title:       'Settings',
    appearance:  'Appearance',
    darkMode:    'Dark mode',
    lightMode:   'Light mode',
    language:    'Language',
    techTerms:   'Show technical terms',
    techTermsDesc: 'Use original labels like "Audit Log", "Action Policies", "Fleet Management"',
    profile:     'Your Profile',
    memberSince: 'Member Since',
    accountId:   'Account ID',
    workspace:   'Workspace',
    teamAccess:  'Team & Access',
    alerts:      'Alerts',
    security:    'Security',
    billing:     'Billing & Data',
    advanced:    'Advanced',
    enterprise:  'Enterprise',
  },

  // ── Auth ──────────────────────────────────────────────────────────────────────
  auth: {
    welcomeBack:     'Welcome back',
    signInSubtitle:  'Sign in to your account',
    createAccount:   'Create your account',
    signUpSubtitle:  'Start governing your AI workforce today',
    forgotPassword:  'Forgot password?',
    noAccount:       "Don't have an account?",
    haveAccount:     'Already have an account?',
    email:           'Email address',
    password:        'Password',
    orgName:         'Organisation name',
  },

  // ── Landing page ──────────────────────────────────────────────────────────────
  landing: {
    heroTitle:   'Your AI agents are making decisions right now. Do you know what they\'re doing?',
    heroSub:     'See everything your AI does. Stop problems before they reach customers.',
    tryDemo:     'See it in action — no sign-up',
    getStarted:  'Get started free',
    talkToUs:    'Talk to us',
    footerTagline: 'The governance layer for your AI workforce.',
  },
} as const;

export type TranslationKeys = typeof en;
export default en;
