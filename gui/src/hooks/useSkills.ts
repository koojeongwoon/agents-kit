import {useRef, useState} from 'react';
import type {SkillSearchResult} from '../components/Marketplaces';
import {fetchSkillsRecommendations, installSkill as apiInstallSkill, searchSkills} from '../api/skills';

export function useSkills(
  kitScope: 'global' | 'project',
  selectedProjectName: string,
  targetProjectPath: string,
  fetchKits: () => Promise<void>,
  fetchStatus: () => Promise<void>
) {
  const [showSkillMarketplace, setShowSkillMarketplace] = useState<boolean>(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState<string>('');
  const [skillSearchResults, setSkillSearchResults] = useState<SkillSearchResult[]>([]);
  const [skillSearchLoading, setSkillSearchLoading] = useState<boolean>(false);
  const [skillSearchError, setSkillSearchError] = useState<string | null>(null);
  const [installingSkill, setInstallingSkill] = useState<boolean>(false);
  const [skillInstallMessage, setSkillInstallMessage] = useState<string | null>(null);
  const [skillInstallError, setSkillInstallError] = useState<string | null>(null);
  const skillSearchSequence = useRef(0);

  const handleInstallSkill = async (locatorValue: string) => {
    const locator = locatorValue.trim();
    if (!locator) {
      setSkillInstallError('skills.sh 스킬 URL 또는 owner/repo@skill을 입력해주세요.');
      return;
    }
    if (kitScope === 'project' && !targetProjectPath.trim()) {
      setSkillInstallError('프로젝트에 바로 적용할 대상 경로를 입력해주세요.');
      return;
    }

    setInstallingSkill(true);
    setSkillInstallError(null);
    setSkillInstallMessage(null);
    try {
      const data = await apiInstallSkill({
        locator,
        scope: kitScope,
        projectName: selectedProjectName,
        projectPath: kitScope === 'project' ? targetProjectPath.trim() : ''
      });
      setSkillInstallMessage(
        `'${data.skill.slug}' 다운로드 및 적용 완료 · ${data.files}개 파일 · ${data.deployedTargets.length}개 클라이언트`
      );
      await Promise.all([fetchKits(), fetchStatus()]);
    } catch (err: any) {
      setSkillInstallError(err.message || '스킬 다운로드에 실패했습니다.');
    } finally {
      setInstallingSkill(false);
    }
  };

  const handleSearchSkills = async (queryOverride?: string) => {
    const query = (queryOverride ?? skillSearchQuery).trim();
    if (query.length === 1) {
      setSkillSearchError('검색어를 2글자 이상 입력해주세요.');
      return;
    }
    const sequence = ++skillSearchSequence.current;
    setSkillSearchLoading(true);
    setSkillSearchError(null);
    try {
      const data = query ? await searchSkills(query) : await fetchSkillsRecommendations();
      if (sequence !== skillSearchSequence.current) return;
      setSkillSearchResults(data.skills || []);
    } catch (err: any) {
      if (sequence !== skillSearchSequence.current) return;
      setSkillSearchResults([]);
      setSkillSearchError(err.message || 'skills.sh 검색에 실패했습니다.');
    } finally {
      if (sequence === skillSearchSequence.current) setSkillSearchLoading(false);
    }
  };

  return {
    showSkillMarketplace,
    setShowSkillMarketplace,
    skillSearchQuery,
    setSkillSearchQuery,
    skillSearchResults,
    setSkillSearchResults,
    skillSearchLoading,
    setSkillSearchLoading,
    skillSearchError,
    setSkillSearchError,
    installingSkill,
    setInstallingSkill,
    skillInstallMessage,
    setSkillInstallMessage,
    skillInstallError,
    setSkillInstallError,
    skillSearchSequence,
    handleInstallSkill,
    handleSearchSkills
  };
}
