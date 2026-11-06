import {render,screen} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import type {SkillDistributionReview} from '../../api/deploy';
import {SkillDistributionPreview} from './SkillDistributionPreview';

const review:SkillDistributionReview={assetId:'review',clientId:'codex',surface:'cli',selection:{schemaVersion:1,status:'selected',variantId:'common',source:'common',format:'common',clientVersion:'0.0.1-test',exposure:'shared',compatibilityState:'author-reviewed',nativeUseState:'unverified',fulfilled:false},
  exposure:{schemaVersion:1,target:'/project/.agents/skills/review',coverage:'known-roots-only',additionalDiscoveryState:'unverified',isolationState:'unverified',readers:[{clientId:'codex',surface:'cli',via:'capability'},{clientId:'antigravity',surface:'cli',via:'inventory'}]}};
describe('Skill distribution review',()=>{
  it('shows the selected variant and additional readers without claiming runtime use or isolation',()=>{
    render(<SkillDistributionPreview reviews={[review]}/>);
    expect(screen.getByText('review · common · codex / cli')).toBeInTheDocument();
    expect(screen.getByText(/추가 대상: antigravity \/ cli/)).toBeInTheDocument();
    expect(screen.getByText('실제 클라이언트 발견·사용은 별도 확인이 필요합니다.')).toBeInTheDocument();
    expect(screen.getByText(/대상 선택만으로 클라이언트가 격리되지는 않습니다/)).toBeInTheDocument();
  });
  it('explains why an exclusive target remains blocked',()=>{
    render(<SkillDistributionPreview reviews={[{...review,selection:{...review.selection,exposure:'exclusive-client'}}]}/>);
    expect(screen.getByText('전용 배포에 필요한 격리가 확인되지 않아 적용을 차단합니다.')).toBeInTheDocument();
  });
  it('identifies a native client format without claiming model use',()=>{
    render(<SkillDistributionPreview reviews={[{...review,selection:{...review.selection,schemaVersion:3,format:'native',native:{schemaVersion:1,clientId:'codex',profile:'codex-skill-interface-v1'}}}]}/>);
    expect(screen.getByText('클라이언트 원형: codex · 검증된 metadata 보존')).toBeInTheDocument();expect(screen.getByText('실제 클라이언트 발견·사용은 별도 확인이 필요합니다.')).toBeInTheDocument();
  });
});
