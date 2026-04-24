import type { ConnectorExecution } from './types';

// ─── Finance (Cashfree / Paytm) ────────────────────────────────────────────

export function financeActionGuidance(mode: 'cashfree' | 'paytm', action: string) {
  if (mode === 'cashfree') {
    if (action === 'finance.refund.create') return 'Use for customer refunds after checking payment state, refund reason, and approval threshold.';
    if (action === 'finance.settlement.check') return 'Use during reconciliation when finance needs to trace settlement lag, status, or mismatch.';
    if (action === 'finance.payment.list') return 'Use for payment investigation, refund eligibility review, and exception triage.';
  }
  if (mode === 'paytm') {
    if (action === 'finance.refund.create') return 'Use for controlled refund initiation with amount thresholds and reviewer rationale.';
    if (action === 'finance.payout.initiate') return 'Use only for approved disbursements; beneficiary and amount should be reviewed before release.';
    if (action === 'finance.payment.status') return 'Use to verify customer payment state before issuing refunds or escalating payment incidents.';
  }
  return null;
}

export function financeExecutionSummary(mode: 'cashfree' | 'paytm', execution: ConnectorExecution) {
  const result = execution.result && typeof execution.result === 'object' ? execution.result : {};
  const beforeState = execution.before_state && typeof execution.before_state === 'object' ? execution.before_state : {};
  const afterState = execution.after_state && typeof execution.after_state === 'object' ? execution.after_state : {};
  const params = execution.params && typeof execution.params === 'object' ? execution.params : {};

  if (mode === 'cashfree') {
    if (execution.action === 'finance.refund.create') {
      const amount = (afterState as any).amount ?? (result as any).amount ?? (params as any).amount ?? null;
      const paymentId = (beforeState as any).payment_id ?? (result as any).payment_id ?? (params as any).payment_id ?? null;
      return {
        title: 'Refund trail',
        lines: [
          paymentId ? `Payment: ${paymentId}` : null,
          amount != null ? `Refund amount: ${amount}` : null,
          execution.approval_required ? 'Approval-gated finance action' : 'Direct finance action',
        ].filter(Boolean),
      };
    }
    if (execution.action === 'finance.settlement.check') {
      const settlementId = (result as any).id ?? (params as any).settlement_id ?? null;
      const status = (result as any).status ?? (afterState as any).status ?? null;
      return {
        title: 'Settlement context',
        lines: [
          settlementId ? `Settlement: ${settlementId}` : null,
          status ? `Status: ${status}` : null,
          'Use this when closing reconciliation exceptions.',
        ].filter(Boolean),
      };
    }
  }

  if (mode === 'paytm') {
    if (execution.action === 'finance.payout.initiate') {
      const beneficiaryId = (params as any).beneficiary_id ?? (afterState as any).beneficiary_id ?? null;
      const amount = (afterState as any).amount ?? (result as any).amount ?? (params as any).amount ?? null;
      return {
        title: 'Payout release',
        lines: [
          beneficiaryId ? `Beneficiary: ${beneficiaryId}` : null,
          amount != null ? `Amount: ${amount}` : null,
          execution.approval_required ? 'Dual-approval candidate' : 'Payout executed without extra approval',
        ].filter(Boolean),
      };
    }
    if (execution.action === 'finance.refund.create') {
      const paymentId = (params as any).payment_id ?? (afterState as any).payment_id ?? null;
      const amount = (afterState as any).amount ?? (result as any).amount ?? (params as any).amount ?? null;
      return {
        title: 'Refund request',
        lines: [
          paymentId ? `Payment: ${paymentId}` : null,
          amount != null ? `Amount: ${amount}` : null,
          'Cross-check against customer communication before release.',
        ].filter(Boolean),
      };
    }
  }

  return null;
}

// ─── Tally ──────────────────────────────────────────────────────────────────

export function tallyActionGuidance(action: string) {
  if (action === 'finance.ledger.read') return 'Use for fast ledger review before reconciliation, posting checks, or exception handling.';
  if (action === 'finance.voucher.reconcile') return 'Use when finance needs a governed reconciliation step with evidence of mismatches and reviewer notes.';
  if (action === 'finance.voucher.post') return 'Use only after journal details, amounts, and approval path are confirmed.';
  return null;
}

export function tallyExecutionSummary(execution: ConnectorExecution) {
  const result = execution.result && typeof execution.result === 'object' ? execution.result : {};
  const beforeState = execution.before_state && typeof execution.before_state === 'object' ? execution.before_state : {};
  const afterState = execution.after_state && typeof execution.after_state === 'object' ? execution.after_state : {};
  const params = execution.params && typeof execution.params === 'object' ? execution.params : {};

  if (execution.action === 'finance.voucher.post') {
    return {
      title: 'Voucher posting evidence',
      lines: [
        (params as any).voucher_number ? `Voucher: ${(params as any).voucher_number}` : null,
        (afterState as any).status ?? (result as any).status ? `Status: ${String((afterState as any).status ?? (result as any).status)}` : null,
        execution.approval_required ? 'Approval-gated accounting write' : 'Direct accounting write',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'finance.voucher.reconcile') {
    const mismatchCount = (afterState as any).mismatch_count ?? (result as any).mismatch_count ?? null;
    return {
      title: 'Reconciliation context',
      lines: [
        mismatchCount != null ? `Mismatches: ${mismatchCount}` : null,
        Object.keys(beforeState).length > 0 ? 'Before-state captured for reconciliation review' : null,
        'Use this to close voucher exceptions with evidence.',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'finance.ledger.read') {
    return {
      title: 'Ledger review',
      lines: [
        Object.keys(result).length > 0 ? 'Ledger snapshot returned for finance review' : null,
        'Useful as the first step before posting or reconciliation changes.',
      ].filter(Boolean),
    };
  }
  return null;
}

// ─── ClearTax ───────────────────────────────────────────────────────────────

export function clearTaxActionGuidance(action: string) {
  if (action === 'compliance.status.check') return 'Use to assess current compliance posture before approving filings or remediation.';
  if (action === 'compliance.notice.read') return 'Use for regulated notice review with a clear audit trail of who accessed the notice.';
  if (action === 'compliance.tds.calculate') return 'Use to calculate TDS before filing or reconciliation; preserve inputs and generated summary.';
  if (action === 'compliance.gst.file') return 'Use only after filing data, approval chain, and evidence export requirements are complete.';
  return null;
}

export function clearTaxExecutionSummary(execution: ConnectorExecution) {
  const result = execution.result && typeof execution.result === 'object' ? execution.result : {};
  const afterState = execution.after_state && typeof execution.after_state === 'object' ? execution.after_state : {};
  const params = execution.params && typeof execution.params === 'object' ? execution.params : {};

  if (execution.action === 'compliance.gst.file') {
    return {
      title: 'GST filing evidence',
      lines: [
        (result as any).filing_id ?? (afterState as any).filing_id ? `Filing: ${String((result as any).filing_id ?? (afterState as any).filing_id)}` : null,
        (result as any).status ?? (afterState as any).status ? `Status: ${String((result as any).status ?? (afterState as any).status)}` : null,
        execution.approval_required ? 'Compliance filing required approval' : 'Compliance filing executed directly',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'compliance.tds.calculate') {
    return {
      title: 'TDS calculation record',
      lines: [
        Object.keys(params).length > 0 ? 'Calculation inputs captured for review' : null,
        Object.keys(result).length > 0 ? 'Result available for audit and finance follow-up' : null,
      ].filter(Boolean),
    };
  }
  if (execution.action === 'compliance.notice.read') {
    return {
      title: 'Notice review',
      lines: [
        Object.keys(result).length > 0 ? 'Notice metadata captured for investigation' : null,
        'Use this when triaging regulatory or tax notices.',
      ].filter(Boolean),
    };
  }
  return null;
}

// ─── Naukri ─────────────────────────────────────────────────────────────────

export function naukriActionGuidance(action: string) {
  if (action === 'recruitment.candidate.search') return 'Use to build a governed shortlist with query context and recruiter review before outreach.';
  if (action === 'recruitment.candidate.profile.read') return 'Use when recruiters need candidate context with a clear audit trail of profile access.';
  if (action === 'recruitment.resume.parse') return 'Use to structure resume evidence before shortlist decisions or human screening.';
  if (action === 'recruitment.job.publish') return 'Use only after role details, posting approval, and target audience are confirmed.';
  return null;
}

export function naukriExecutionSummary(execution: ConnectorExecution) {
  const result = execution.result && typeof execution.result === 'object' ? execution.result : {};
  const beforeState = execution.before_state && typeof execution.before_state === 'object' ? execution.before_state : {};
  const afterState = execution.after_state && typeof execution.after_state === 'object' ? execution.after_state : {};
  const params = execution.params && typeof execution.params === 'object' ? execution.params : {};

  if (execution.action === 'recruitment.job.publish') {
    return {
      title: 'Job publishing trail',
      lines: [
        (params as any).job_title ?? (afterState as any).job_title ? `Role: ${String((params as any).job_title ?? (afterState as any).job_title)}` : null,
        (result as any).job_id ?? (afterState as any).job_id ? `Job ID: ${String((result as any).job_id ?? (afterState as any).job_id)}` : null,
        execution.approval_required ? 'Publishing required recruiter approval' : 'Role posted without extra approval',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'recruitment.candidate.search') {
    const total = (result as any).count ?? (afterState as any).count ?? null;
    return {
      title: 'Candidate shortlist search',
      lines: [
        Object.keys(params).length > 0 ? 'Search query captured for recruiter review' : null,
        total != null ? `Profiles returned: ${total}` : null,
        'Use this to explain why candidates entered a shortlist.',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'recruitment.resume.parse') {
    return {
      title: 'Resume parsing evidence',
      lines: [
        Object.keys(beforeState).length > 0 ? 'Original resume context preserved' : null,
        Object.keys(result).length > 0 ? 'Structured candidate summary captured' : null,
      ].filter(Boolean),
    };
  }
  return null;
}

// ─── Slack ──────────────────────────────────────────────────────────────────

export function slackActionGuidance(action: string) {
  if (action === 'communication.channel.read') return 'Use for channel context and incident review before posting or escalating messages.';
  if (action === 'communication.message.send') return 'Use for governed outbound communication with message preview, business-hours policy, and approval routing when needed.';
  if (action === 'communication.message.reply') return 'Use when responding into an existing thread so the response trail stays reviewable and attributable.';
  if (action === 'communication.user.lookup') return 'Use to verify recipient identity before sending sensitive or operational messages.';
  return null;
}

export function slackExecutionSummary(execution: ConnectorExecution) {
  const result = execution.result && typeof execution.result === 'object' ? execution.result : {};
  const afterState = execution.after_state && typeof execution.after_state === 'object' ? execution.after_state : {};
  const params = execution.params && typeof execution.params === 'object' ? execution.params : {};

  if (execution.action === 'communication.message.send' || execution.action === 'communication.message.reply') {
    return {
      title: execution.action === 'communication.message.reply' ? 'Thread reply trail' : 'Outbound message trail',
      lines: [
        (params as any).channel ?? (afterState as any).channel ? `Channel: ${String((params as any).channel ?? (afterState as any).channel)}` : null,
        (result as any).ts ?? (afterState as any).ts ? `Message ref: ${String((result as any).ts ?? (afterState as any).ts)}` : null,
        execution.approval_required ? 'Communication was approval-gated' : 'Message sent without extra approval',
      ].filter(Boolean),
    };
  }
  if (execution.action === 'communication.channel.read') {
    return {
      title: 'Channel context review',
      lines: [
        Object.keys(result).length > 0 ? 'Channel snapshot returned for operator review' : null,
        'Use this before outbound messaging when context matters.',
      ].filter(Boolean),
    };
  }
  return null;
}
