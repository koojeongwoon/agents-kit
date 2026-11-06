import {summarizeVerification, VERIFICATION_STAGES} from '../../lib/domain/verification-evidence.js';
import fs from 'node:fs';
import crypto from 'node:crypto';

export function verificationComponentHashes() {
  return Object.fromEntries(['lib/domain/verification-evidence.js', 'lib/adapters/verification/probe-evidence.js',
    'lib/adapters/verification/model-use-observation.js', 'lib/adapters/verification/basic-resource-observation.js', 'lib/adapters/verification/command-coverage.js', 'lib/adapters/verification/agent-observation.js',
    'lib/adapters/verification/antigravity-child-acp.js', 'scripts/client-verification/antigravity-child-acp.mjs',
    'lib/adapters/verification/codex-agent-observation.js', 'lib/adapters/verification/recorded-report.js', 'scripts/client-verification/deployment.mjs',
    'scripts/client-verification/report.mjs'].map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(new URL(`../../${file}`, import.meta.url))).digest('hex')]));
}

export function cleanupVerificationScratch(report, scratchRoot) {
  if (report.clients.some(client => client.cleanupVerified === false)) {
    report.recovery = {scratchRetained: true, scratchRoot, reason: 'FIXTURE_RESTORATION_UNVERIFIED'};
  } else fs.rmSync(scratchRoot, {recursive: true, force: true});
}

// Legacy report fields remain readable. Completion now refers to the requested subset.
export function finalizeVerificationReport(report) {
  const requestedStages = report.stagesRequested === 'applied' ? ['applied'] : VERIFICATION_STAGES;
  for (const client of report.clients) {
    const stages = Object.fromEntries(Object.entries(client.stages || {}).filter(([, value]) => value.verification).map(([stage, value]) => [stage, value.verification]));
    client.verification = summarizeVerification(stages, {requestedStages, cleanup: client.cleanupVerified});
    client.fullLifecycleConfirmed = !client.blocker && client.verification.fullLifecycleConfirmed;
  }
  report.completionScope = 'requested-clients-resources-stages';
  report.complete = report.clients.length > 0 && report.clients.every(client => !client.blocker && client.verification.complete);
  report.productionEvidencePromoted = false;
  report.verificationComponentHashes = verificationComponentHashes();
  return report;
}
