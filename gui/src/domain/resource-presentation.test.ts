import {describe, expect, it} from 'vitest';
import {externalObservationTargets,isObservationOnly, resourceStatus} from './resource-presentation';
import type {ClientSummary, LocalDiscoveryAsset} from '../api/deploy';

const client: ClientSummary={id:'codex',displayName:'Codex',schemaVersion:2,defaultSurface:'cli',detection:{commands:['codex'],userRoot:'~/.codex'},
  capabilities:[{assetKind:'skills',scope:'global',status:'stable'}],surfaces:[{id:'cli',displayName:'CLI',configStore:'codex',runtimeState:'verified',runtimeEvidence:[]} ]};
const observed:LocalDiscoveryAsset={id:'review',kind:'skills',clientId:'codex',scope:'global',surface:'cli',sourcePath:'/home/.codex/skills/review',path:'/home/.codex/skills/review'};

describe('resource presentation facts',()=>{
  it('recognizes an external link from another client by canonical target, without grouping same-named unrelated skills',()=>{
    const external={...observed,path:'/home/.agents/skills/ego-browser',resolvedTarget:'/external/ego/skill'};
    const alias={...observed,entryType:'symlink' as const,path:'/home/.claude/skills/ego-browser',resolvedTarget:'/external/ego/skill'};
    const targets=externalObservationTargets([external,alias]);
    expect(isObservationOnly(alias,targets)).toBe(true);
    expect(isObservationOnly({...alias,resolvedTarget:'/another/ego-browser'},targets)).toBe(false);
  });
  it.each(['/home/.agents/skills/review','/project/.agents/skills/review','~/.agents/skills','C:\\Users\\jw\\.agents\\skills\\review'])('observes %s without offering management',path=>{
    expect(isObservationOnly({...observed,path,sourcePath:path})).toBe(true);
  });
  it('recognizes a resolved shared link and preserves the external-manager boundary',()=>{
    expect(isObservationOnly({...observed,resolvedTarget:'/home/.agents/skills/review'})).toBe(true);
    expect(isObservationOnly({...observed,managementMode:'external'})).toBe(true);
    expect(isObservationOnly({...observed,path:'/home/.codex/skills/review'})).toBe(false);
    expect(isObservationOnly({...observed,path:'/home/.agents/skills-other/review',sourcePath:'/other'})).toBe(false);
  });
  it('does not promote a found file, enabled native listing or verified client to resource execution success',()=>{
    const state=resourceStatus({client,kind:'skills',scope:'global',surface:'cli',observations:[{...observed,activation:'enabled',nativeEvidence:{state:'listed'}}]});
    expect(state.discovery.label).toBe('파일 발견');
    expect(state.support.label).toBe('파일 계약 · 계획 확인 필요');
    expect(state.runtime.label).toBe('미확인');
  });
  it('keeps scope and surface mismatches unverified, and shared resources observation-only',()=>{
    expect(resourceStatus({client,kind:'skills',scope:'project',surface:'cli',observations:[observed]}).discovery.label).toBe('관측 기록 없음');
    expect(resourceStatus({client,kind:'skills',scope:'global',surface:'desktop',observations:[observed]}).support.label).toBe('미확인');
    expect(resourceStatus({client,kind:'skills',scope:'global',surface:'cli',observations:[{...observed,path:'/home/.agents/skills/review'}]}).support.label).toBe('관측 전용 · 미확인');
  });
});
