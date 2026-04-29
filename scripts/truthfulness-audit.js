#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const checks = [
  {
    name: 'No static template adoption claims',
    file: 'zapheit-ui/src/pages/dashboard/AgentTemplatesPage.tsx',
    patterns: [
      /Used by\s+\$\{/,
      /usedBy\.toLocaleString/,
      /TEMPLATE_META/,
      /Most popular/,
    ],
    help: 'Template cards must not imply real customer adoption unless the count comes from a production source.',
  },
  {
    name: 'Command center uses evidence language',
    file: 'zapheit-ui/src/pages/dashboard/DashboardOverview.tsx',
    required: [
      'Production Command Center',
      'Evidence coverage',
      'Live evidence stream',
    ],
    help: 'The dashboard must frame excitement around production evidence, not placeholders.',
  },
  {
    name: 'Connector certification exposes evidence and missing checks',
    file: 'zapheit-ui/src/lib/production-readiness.ts',
    required: [
      'CONNECTOR_CERTIFICATION_MANIFEST',
      'missingChecks',
      'certificationLevel',
    ],
    help: 'Certification labels need explicit backing and gaps.',
  },
  {
    name: 'Template launch package is persisted with agent config',
    file: 'zapheit-ui/src/pages/Dashboard.tsx',
    required: [
      'production_launch_package',
      'readiness_status',
    ],
    help: 'Template deployment should carry production package context into the created agent.',
  },
];

const failures = [];

for (const check of checks) {
  const target = path.join(repoRoot, check.file);
  const source = fs.readFileSync(target, 'utf8');

  for (const pattern of check.patterns || []) {
    if (pattern.test(source)) {
      failures.push(`${check.name}: forbidden pattern ${pattern} found in ${check.file}. ${check.help}`);
    }
  }

  for (const token of check.required || []) {
    if (!source.includes(token)) {
      failures.push(`${check.name}: required token "${token}" missing from ${check.file}. ${check.help}`);
    }
  }
}

if (failures.length > 0) {
  console.error('UI truthfulness audit failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('UI truthfulness audit passed.');
