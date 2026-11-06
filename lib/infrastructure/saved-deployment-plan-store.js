import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {FileTransaction} from './file-transaction.js';
import {domainError} from '../domain/errors.js';
import {authorizeSharedTarget} from '../application/shared-resource-deployment.js';
import {resolveForAuthorization} from '../security-boundary.js';
import {runTransactionWorkflow,withTransactionCleanup} from './transaction-workflow.js';

export function canonicalDigest(value) {
  const canonical = input => Array.isArray(input) ? `[${input.map(canonical).join(',')}]`
    : input && typeof input === 'object' ? `{${Object.keys(input).filter(key => input[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(input[key])}`).join(',')}}`
      : JSON.stringify(input);
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

export class SavedDeploymentPlanStore {
  constructor({root, clock = () => Date.now()}) { this.root = resolveForAuthorization(root); this.clock = clock; }
  location(id) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw domainError('INVALID_SAVED_PLAN_ID', 'Saved plan ID is invalid');
    return authorizeSharedTarget(path.join(this.root, `${id}.json`), this.root);
  }
  write(record) {
    const target = this.location(record.body.id);
    fs.mkdirSync(this.root, {recursive: true, mode: 0o700});
    const transaction = new FileTransaction();
    try { transaction.write(target, `${JSON.stringify(record, null, 2)}\n`, {mode: 0o600}); transaction.commit(); }
    catch (error) { transaction.rollback(); throw error; }
  }
  create(body) {
    if (fs.existsSync(this.location(body.id))) throw domainError('SAVED_PLAN_ALREADY_EXISTS', 'Plan has already been saved');
    const record = {body, digest: canonicalDigest(body), status: 'ready'};
    this.write(record); return this.summary(record);
  }
  read(id, expectedDigest) {
    let record;
    try { record = JSON.parse(fs.readFileSync(this.location(id), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw domainError('DEPLOYMENT_PLAN_NOT_FOUND', 'Saved deployment plan was not found');
      throw domainError('INVALID_SAVED_PLAN', 'Saved deployment plan cannot be read safely');
    }
    if (![1, 2, 3, 4, 5].includes(record?.body?.schemaVersion) || record.body.schemaVersion === 2 && record.body.contract !== 'tree-deployment-v1'
      || record.body.schemaVersion === 3 && record.body.contract !== 'physical-resource-v1'
      || record.body.schemaVersion === 4 && (record.body.contract !== 'global-dependency-mutation-v1' || record.body.replay?.input?.scope !== 'global'
        || !['apply','remove','rollback'].includes(record.body.kind) || !/^[a-f0-9]{64}$/.test(record.body.globalMutationDigest || ''))
      || record.body.schemaVersion === 5 && (record.body.contract !== 'scoped-deployment-v1' || !['global','project'].includes(record.body.replay?.input?.scope)
        || !['apply','remove','rollback'].includes(record.body.kind) || !['plan','planRemoval','planRollback'].includes(record.body.replay?.method)
        || ({apply:'plan',remove:'planRemoval',rollback:'planRollback'})[record.body.kind]!==record.body.replay?.method
        || !/^[a-f0-9]{64}$/.test(record.body.scopedReviewDigest||'') || typeof record.body.observeProviders!=='boolean')
      || record.body.id !== id || canonicalDigest(record.body) !== record.digest
      || (expectedDigest !== undefined && expectedDigest !== record.digest)) throw domainError('SAVED_PLAN_DIGEST_MISMATCH', 'Saved plan does not match the reviewed digest');
    return record;
  }
  summary(record) {
    return {planId: record.body.id, digest: record.digest, kind: record.body.kind, status: record.status,
      ...(record.body.skillDistributions?{skillDistributions:structuredClone(record.body.skillDistributions)}:{}),
      operations: record.body.operations, expiresAt: new Date(record.body.expiresAtMs).toISOString(), targetRoot: record.body.replay.input.targetRoot,
      ...(record.body.pathMigrations ? {pathMigrations: record.body.pathMigrations} : {}),
      ...(record.result ? {result: record.result} : {})};
  }
  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
      .map(name => this.summary(this.read(name.slice(0, -5))));
  }
  run(id, digest, action, reconcile) {
    return this.execute(id,digest,action,reconcile,false);
  }
  async runAsync(id,digest,action,reconcile) {
    return this.execute(id,digest,action,reconcile,true);
  }
  execute(id,digest,action,reconcile,async) {
    if (!/^[a-f0-9]{64}$/.test(digest || '')) throw domainError('SAVED_PLAN_DIGEST_REQUIRED', 'Supply the digest of the reviewed saved plan');
    let record = this.read(id, digest);
    if (record.status === 'completed') return record.result;
    if (record.status !== 'ready') {
      const result = reconcile?.(record.body);
      if (result) { record.status = 'completed'; record.result = result; this.write(record); return result; }
      throw domainError('SAVED_PLAN_NOT_READY', 'Interrupted or failed saved plans cannot be replayed; inspect deployment recovery');
    }
    if (record.body.expiresAtMs < this.clock()) throw domainError('DEPLOYMENT_PLAN_EXPIRED', 'Saved deployment plan has expired');
    const claimPath = `${this.location(id)}.claim`;
    authorizeSharedTarget(claimPath, this.root);
    let descriptor;
    try { descriptor = fs.openSync(claimPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw domainError('SAVED_PLAN_NOT_READY', 'Saved plan is already claimed'); throw error; }
    const identity=fs.fstatSync(descriptor),owner={pid:process.pid,token:crypto.randomUUID()};
    try{fs.writeFileSync(descriptor,JSON.stringify(owner));}catch(error){fs.closeSync(descriptor);throw error;}
    const ownsClaim=()=>{try{const current=fs.lstatSync(claimPath),value=JSON.parse(fs.readFileSync(claimPath,'utf8'));return current.isFile()&&current.nlink===1&&current.dev===identity.dev&&current.ino===identity.ino&&value.pid===owner.pid&&value.token===owner.token;}catch{return false;}};
    const assertReview=()=>{if(!ownsClaim()||canonicalDigest(this.read(id,digest))!==canonicalDigest(record))throw domainError('SAVED_PLAN_NOT_READY','The saved review or its execution claim changed');
      if(record.body.expiresAtMs<this.clock())throw domainError('DEPLOYMENT_PLAN_EXPIRED','The saved plan expired during validation');};
    let started = false;
    return withTransactionCleanup(()=>runTransactionWorkflow((function*(){try {
      const current = this.read(id, digest);
      if (current.status === 'completed') return current.result;
      if (current.status !== 'ready') throw domainError('SAVED_PLAN_NOT_READY', 'Saved plan is already consumed');
      record = current;
      record.status = 'running'; this.write(record); started = true;
      const result = yield action(record.body,assertReview);
      assertReview();
      record.status = 'completed'; record.result = result; this.write(record);
      return result;
    } catch (error) {
      // A persisted running state is intentionally retained if saving failure status also fails.
      let unchanged=false;try{assertReview();unchanged=true;}catch{/* Preserve a replaced claim or manually edited review. */}
      if (started&&unchanged) {
        record.status = 'failed'; record.failureCode = error.code || 'EXECUTION_FAILED';
        try { this.write(record); } catch { /* recovery must reconcile actual deployment state */ }
      }
      throw error;
    }}).call(this),{async}),()=>{fs.closeSync(descriptor);if(ownsClaim())fs.unlinkSync(claimPath);});
  }
}
