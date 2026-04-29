#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));

const flags = {
  withRouteTests: args.has('--with-route-tests'),
  withRestSmoke: args.has('--with-rest-smoke'),
  withUiSmoke: args.has('--with-ui-smoke'),
};

const checks = [
  {
    name: 'UI truthfulness audit',
    cwd: '.',
    cmd: 'node',
    args: ['scripts/truthfulness-audit.js'],
    required: true,
    description: 'Blocks launch-facing fake adoption, unsupported production claims, and missing evidence language.',
  },
  {
    name: 'Frontend build',
    cwd: 'zapheit-ui',
    cmd: 'pnpm',
    args: ['build'],
    required: true,
    description: 'Verifies the dashboard compiles for production.',
  },
  {
    name: 'API build',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['run', 'build'],
    required: true,
    description: 'Verifies the control-plane API compiles for production.',
  },
  {
    name: 'Runtime build',
    cwd: 'zapheit-runtime',
    cmd: 'npm',
    args: ['run', 'build'],
    required: true,
    description: 'Verifies the runtime worker compiles for production.',
  },
  {
    name: 'Approvals normalization tests',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['test', '--', '--runInBand', 'src/routes/__tests__/approvals-reason-model.test.ts'],
    required: flags.withRouteTests,
    description: 'Checks the unified approval/workflow response model.',
  },
  {
    name: 'Governed actions workflow tests',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['test', '--', '--runInBand', 'src/routes/__tests__/integrations-governed-actions.test.ts'],
    required: flags.withRouteTests,
    description: 'Checks governed action response wiring and linkage.',
  },
  {
    name: 'Governed chat workflow tests',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['test', '--', '--runInBand', 'src/routes/__tests__/conversations-chat.test.ts'],
    required: flags.withRouteTests,
    description: 'Checks chat session creation and governed workflow normalization.',
  },
  {
    name: 'Standard chat workflow tests',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['test', '--', '--runInBand', 'src/routes/__tests__/chat-standard.test.ts'],
    required: flags.withRouteTests,
    description: 'Checks the consumer-first chat session and standard message workflow.',
  },
  {
    name: 'Chat runtime profile tests',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['test', '--', '--runInBand', 'src/routes/__tests__/chat-runtime-profiles.test.ts'],
    required: flags.withRouteTests,
    description: 'Checks encrypted backend-managed runtime profile storage and lifecycle.',
  },
  {
    name: 'REST smoke suite',
    cwd: 'zapheit-api',
    cmd: 'npm',
    args: ['run', 'smoke:rest'],
    required: flags.withRestSmoke,
    description: 'Runs authenticated API smoke checks against a live local or staging environment.',
  },
  {
    name: 'Frontend smoke suite',
    cwd: 'zapheit-ui',
    cmd: 'pnpm',
    args: ['e2e'],
    required: flags.withUiSmoke,
    description: 'Runs browser smoke coverage for the dashboard.',
  },
];

const skipped = [];
const failures = [];

function printHeader(title) {
  console.log(`\n=== ${title} ===`);
}

function runCheck(check) {
  printHeader(check.name);
  console.log(check.description);

  const result = spawnSync(check.cmd, check.args, {
    cwd: path.join(repoRoot, check.cwd),
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status === 0) {
    console.log(`PASS: ${check.name}`);
    return;
  }

  failures.push(check.name);
  console.log(`FAIL: ${check.name}`);
}

console.log('Zapheit production gate');
console.log(`Repository: ${repoRoot}`);

for (const check of checks) {
  if (!check.required) {
    skipped.push(check.name);
    continue;
  }
  runCheck(check);
}

printHeader('Manual Release Gate');
console.log('Confirm the following before calling a release production-ready:');
console.log('- Apps governed flow passes end-to-end: app -> policy -> approval -> execution -> audit -> cost.');
console.log('- Chat governed flow passes end-to-end with visible policy and approval state.');
console.log('- Template governed flow passes end-to-end with the same lifecycle semantics.');
console.log('- Legacy branding and unsupported claims are absent from launch-facing surfaces.');
console.log('- Weak modules are marked Beta or Preview where capability is partial.');
console.log('- Rollback steps are verified from docs/PRODUCTION_READINESS_RUNBOOK.md.');

if (skipped.length > 0) {
  printHeader('Skipped Checks');
  for (const name of skipped) {
    console.log(`- ${name}`);
  }
}

if (failures.length > 0) {
  printHeader('Gate Result');
  console.log('Production gate failed.');
  for (const name of failures) {
    console.log(`- ${name}`);
  }
  process.exit(1);
}

printHeader('Gate Result');
console.log('Production gate passed for the selected automated checks.');
if (skipped.length > 0) {
  console.log('Complete the skipped automated checks and the manual release gate before production rollout.');
}
