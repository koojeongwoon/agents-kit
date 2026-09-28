import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {domainError} from '../domain/errors.js';
import {normalizeMcpDefinition} from '../domain/mcp-definition.js';
import {createManifestDeploymentService} from './manifest-deployment-service.js';
import {SavedDeploymentPlanStore, canonicalDigest} from '../infrastructure/saved-deployment-plan-store.js';
import {BUNDLE_LIMITS, decodeResourceBundle, readBundleFile, stageResourceBundle, verifyStagedBundle} from '../infrastructure/resource-bundle.js';
import {assertSafeProjectTarget, isWithinRoot, resolveForAuthorization} from '../security-boundary.js';

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const fail = code => { throw domainError(code, 'Resource bundle executor rejected the request'); };
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('INVALID_BUNDLE_REQUEST');
}

// Local, same-user execution boundary. It is deliberately not a management-job
// verifier or network listener. A future daemon adapter must authorize a signed
// job before invoking this fixed helper as the enrolled user.
export function createResourceBundleDeploymentService({definitionsDir, homeDir, workRoot, bindings, binaryObserver, clock = () => Date.now(), ttlMs = 5 * 60 * 1000}) {
  if (![definitionsDir, homeDir, workRoot].every(value => typeof value === 'string' && path.isAbsolute(value))) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
  homeDir = resolveForAuthorization(homeDir); definitionsDir = resolveForAuthorization(definitionsDir);
  const requestedWorkRoot = workRoot;
  workRoot = resolveForAuthorization(workRoot);
  if (requestedWorkRoot !== workRoot || workRoot === path.parse(workRoot).root || workRoot === homeDir
    || isWithinRoot(workRoot, definitionsDir)) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 5 * 60 * 1000 || !bindings || typeof bindings !== 'object' || Array.isArray(bindings)) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
  bindings = structuredClone(bindings);
  for (const [id, binding] of Object.entries(bindings)) {
    fields(binding, ['scope', 'targetRoot', 'targets', 'allowedMcpDigests']);
    if (!ID.test(id) || !['global', 'project'].includes(binding.scope) || typeof binding.targetRoot !== 'string' || !path.isAbsolute(binding.targetRoot)
      || !Array.isArray(binding.targets) || !binding.targets.length || binding.targets.length > 2) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
    for (const target of binding.targets) {
      fields(target, ['clientId', 'surface', 'clientVersion']);
      if (!['codex', 'antigravity'].includes(target.clientId) || target.surface !== 'cli'
        || (target.clientVersion !== undefined && (typeof target.clientVersion !== 'string' || !target.clientVersion))) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
    }
    if (new Set(binding.targets.map(target => target.clientId)).size !== binding.targets.length) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
    if (binding.allowedMcpDigests !== undefined && (!Array.isArray(binding.allowedMcpDigests) || binding.allowedMcpDigests.some(item => typeof item !== 'string' || !HASH.test(item)))) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
    const targetRoot = resolveForAuthorization(binding.targetRoot);
    if (binding.scope === 'global') { if (targetRoot !== homeDir) fail('INVALID_BUNDLE_EXECUTOR_CONFIG'); }
    else {
      assertSafeProjectTarget({targetDir: targetRoot, homeDir, projectRoot: path.resolve(import.meta.dirname, '../..'), kitRoot: workRoot});
      if (isWithinRoot(workRoot, targetRoot)) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
    }
    if (binding.targetRoot !== targetRoot) fail('INVALID_BUNDLE_EXECUTOR_CONFIG');
  }
  function secureRoot() {
    if (resolveForAuthorization(workRoot) !== workRoot) fail('UNSAFE_BUNDLE_PATH');
    fs.mkdirSync(workRoot, {recursive: true, mode: 0o700});
    const stat = fs.lstatSync(workRoot);
    if (!stat.isDirectory() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) fail('UNSAFE_BUNDLE_PATH');
    for (const name of ['receipts', '.deployment-plans']) {
      const directory = path.join(workRoot, name);
      if (resolveForAuthorization(directory) !== directory) fail('UNSAFE_BUNDLE_PATH');
      try {
        const child = fs.lstatSync(directory);
        if (!child.isDirectory() || (child.mode & 0o077) || (process.getuid && child.uid !== process.getuid())) fail('UNSAFE_BUNDLE_PATH');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  function bindingFor(id) {
    if (typeof id !== 'string' || !ID.test(id) || !Object.hasOwn(bindings, id)) fail('BUNDLE_BINDING_NOT_FOUND');
    const binding = bindings[id];
    if (resolveForAuthorization(binding.targetRoot) !== binding.targetRoot) fail('BUNDLE_BINDING_CHANGED');
    return binding;
  }
  const bindingDigest = id => canonicalDigest({homeDir, definitionsDir, binding: bindingFor(id)});
  secureRoot();
  const receipts = new SavedDeploymentPlanStore({root: path.join(workRoot, 'receipts'), clock});
  const deployment = createManifestDeploymentService({definitionsDir, homeDir, binaryObserver, clock,
    planStoreRoot: path.join(workRoot, '.deployment-plans'), savedPlanTtlMs: ttlMs});

  function cachedBundle(sha256) {
    if (typeof sha256 !== 'string' || !HASH.test(sha256)) fail('RESOURCE_BUNDLE_HASH_MISMATCH');
    return decodeResourceBundle(readBundleFile(workRoot, `${sha256}.json`, BUNDLE_LIMITS.bytes), sha256).bundle;
  }
  function validateReceipt(body) {
    if (body.kind !== 'bundle-apply' || body.bindingDigest !== bindingDigest(body.bindingId)) fail('BUNDLE_BINDING_CHANGED');
    const bundle = cachedBundle(body.bundleSha256);
    const scopeRoot = body.scopeRoot;
    if (typeof scopeRoot !== 'string' || path.dirname(scopeRoot) !== workRoot || !/^bundle-[A-Za-z0-9]+$/.test(path.basename(scopeRoot))
      || resolveForAuthorization(scopeRoot) !== scopeRoot) fail('UNSAFE_BUNDLE_PATH');
    verifyStagedBundle(scopeRoot, bundle);
    return bundle;
  }
  function result(body, applied) {
    if (!applied.transactionId || (applied.status !== undefined && applied.status !== 'committed')) fail('BUNDLE_APPLY_UNCONFIRMED');
    return {schemaVersion: 1, phase: 'files-applied', receiptId: body.id, bundleSha256: body.bundleSha256,
      resource: body.resource, bindingId: body.bindingId, transactionId: applied.transactionId,
      clientRecognition: 'unverified'};
  }
  return {
    prepare(request) {
      fields(request, ['bindingId', 'bundleBytes', 'sha256']);
      secureRoot();
      const binding = bindingFor(request.bindingId);
      const {bundle, bytes, sha256} = decodeResourceBundle(request.bundleBytes, request.sha256);
      for (const asset of bundle.manifest.assets.mcpServers || []) {
        const digest = canonicalDigest(normalizeMcpDefinition(asset, bundle.manifest.defaults?.mcpBindings));
        if (!binding.allowedMcpDigests?.includes(digest)) fail('BUNDLE_MCP_POLICY_DENIED');
      }
      const cached = path.join(workRoot, `${sha256}.json`);
      const temporary = path.join(workRoot, `pending-${crypto.randomUUID()}`);
      try {
        fs.writeFileSync(temporary, bytes, {flag: 'wx', mode: 0o600});
        try { fs.linkSync(temporary, cached); }
        catch (error) { if (error.code !== 'EEXIST') throw error; cachedBundle(sha256); }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
      const scopeRoot = stageResourceBundle({parent: workRoot, bundle});
      let saved;
      try {
        const plan = deployment.plan({scopeRoot, targetRoot: binding.targetRoot, scope: binding.scope, targets: binding.targets});
        if (!plan.automatic) { fs.rmSync(scopeRoot, {recursive: true, force: true}); return {schemaVersion: 1, phase: 'blocked', bundleSha256: sha256, plan}; }
        saved = deployment.savePlan({planId: plan.planId});
        const receipt = receipts.create({schemaVersion: 1, id: saved.planId, kind: 'bundle-apply',
          expiresAtMs: Date.parse(saved.expiresAt), bindingId: request.bindingId, bindingDigest: bindingDigest(request.bindingId),
          bundleSha256: sha256, resource: bundle.resource, scopeRoot, savedPlan: {planId: saved.planId, digest: saved.digest},
          replay: {input: {targetRoot: binding.targetRoot}}, operations: saved.operations});
        return {schemaVersion: 1, phase: 'prepared', bundleSha256: sha256, resource: bundle.resource, bindingId: request.bindingId,
          receiptId: receipt.planId, receiptDigest: receipt.digest, expiresAt: receipt.expiresAt, plan};
      } catch (error) {
        if (!saved) fs.rmSync(scopeRoot, {recursive: true, force: true});
        throw error;
      }
    },
    apply(request) {
      fields(request, ['receiptId', 'receiptDigest']);
      secureRoot();
      const {receiptId, receiptDigest} = request;
      // Also validate completed receipts: a digest is never a caller identity or
      // permission to retarget a deployment. Completed results are historical.
      const record = receipts.read(receiptId, receiptDigest);
      validateReceipt(record.body);
      return receipts.run(receiptId, receiptDigest, body => {
        validateReceipt(body);
        return result(body, deployment.resumeSavedPlan(body.savedPlan));
      }, body => {
        validateReceipt(body);
        // Only inspect an already-consumed inner plan when reconciling. Never
        // start a ready plan after an outer claim was interrupted or expired.
        const inner = new SavedDeploymentPlanStore({root: path.join(workRoot, '.deployment-plans'), clock}).read(body.savedPlan.planId, body.savedPlan.digest);
        if (inner.status === 'ready') return null;
        return result(body, deployment.resumeSavedPlan(body.savedPlan));
      });
    }
  };
}
