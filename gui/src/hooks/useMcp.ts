import {useRef, useState} from 'react';
import type {SmitherySearchResult, SmitheryServerDetail} from '../components/Marketplaces';
import {
    fetchSmitheryRecommendations,
    fetchSmitheryServer,
    mergeSmitheryServer,
    searchSmithery,
    toggleMcpServer as apiToggleMcpServer
} from '../api/mcp';

export function useMcp(
  kitScope: 'global' | 'project',
  selectedProjectName: string,
  targetProjectPath: string,
  fetchKits: () => Promise<void>,
  fetchStatus: () => Promise<void>
) {
  const [showSmitheryMarketplace, setShowSmitheryMarketplace] = useState<boolean>(false);
  const [smitherySearchQuery, setSmitherySearchQuery] = useState<string>('');
  const [smitherySearchResults, setSmitherySearchResults] = useState<SmitherySearchResult[]>([]);
  const [smitherySearchLoading, setSmitherySearchLoading] = useState<boolean>(false);
  const [smitheryError, setSmitheryError] = useState<string | null>(null);
  const [smitheryMessage, setSmitheryMessage] = useState<string | null>(null);
  const [selectedSmitheryServer, setSelectedSmitheryServer] = useState<SmitheryServerDetail | null>(null);
  const [smitheryDetailLoading, setSmitheryDetailLoading] = useState<boolean>(false);
  const [smitheryAlias, setSmitheryAlias] = useState<string>('');
  const [smitheryConfigValues, setSmitheryConfigValues] = useState<Record<string, string>>({});
  const [smitheryMerging, setSmitheryMerging] = useState<boolean>(false);
  const smitherySearchSequence = useRef(0);

  const handleSearchSmithery = async (queryOverride?: string) => {
    const query = (queryOverride ?? smitherySearchQuery).trim();
    if (query.length === 1) {
      setSmitheryError('검색어를 2글자 이상 입력해주세요.');
      return;
    }
    const sequence = ++smitherySearchSequence.current;
    setSmitherySearchLoading(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const data = query ? await searchSmithery(query) : await fetchSmitheryRecommendations();
      if (sequence !== smitherySearchSequence.current) return;
      setSmitherySearchResults(data.servers || []);
    } catch (err: any) {
      if (sequence !== smitherySearchSequence.current) return;
      setSmitherySearchResults([]);
      setSmitheryError(err.message || 'Smithery 검색에 실패했습니다.');
    } finally {
      if (sequence === smitherySearchSequence.current) setSmitherySearchLoading(false);
    }
  };

  const handleSelectSmitheryServer = async (qualifiedName: string) => {
    setSmitheryDetailLoading(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const data = await fetchSmitheryServer(qualifiedName);
      const server = data.server as SmitheryServerDetail;
      const baseAlias = server.qualifiedName.split('/').pop() || server.qualifiedName;
      setSelectedSmitheryServer(server);
      setSmitheryAlias(baseAlias.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''));
      setSmitheryConfigValues({});
    } catch (err: any) {
      setSmitheryError(err.message || 'Smithery MCP 정보를 불러오지 못했습니다.');
    } finally {
      setSmitheryDetailLoading(false);
    }
  };

  const handleMergeSmithery = async () => {
    if (!selectedSmitheryServer) return;
    if (!smitheryAlias.trim()) {
      setSmitheryError('MCP 별칭을 입력해주세요.');
      return;
    }
    if (kitScope === 'project' && !targetProjectPath.trim()) {
      setSmitheryError('프로젝트에 바로 적용할 대상 경로를 입력해주세요.');
      return;
    }
    const missing = selectedSmitheryServer.fields.filter(field => field.required && !smitheryConfigValues[field.name]?.trim());
    if (missing.length > 0) {
      setSmitheryError(`필수 설정을 입력해주세요: ${missing.map(field => field.name).join(', ')}`);
      return;
    }
    setSmitheryMerging(true);
    setSmitheryError(null);
    setSmitheryMessage(null);
    try {
      const data = await mergeSmitheryServer({
        qualifiedName: selectedSmitheryServer.qualifiedName,
        alias: smitheryAlias.trim(),
        configValues: smitheryConfigValues,
        scope: kitScope,
        projectName: selectedProjectName,
        projectPath: kitScope === 'project' ? targetProjectPath.trim() : ''
      });
      setSmitheryMessage(`'${data.alias}' MCP 병합 및 적용 완료 · ${data.appliedLinksCount}개 링크`);
      await Promise.all([fetchKits(), fetchStatus()]);
    } catch (err: any) {
      setSmitheryError(err.message || 'MCP 병합에 실패했습니다.');
    } finally {
      setSmitheryMerging(false);
    }
  };

  const handleToggleMcpServer = async (serverName: string) => {
    try {
      const data = await apiToggleMcpServer(kitScope, selectedProjectName, serverName);
      if (data.success) {
        await fetchKits();
      }
    } catch (err: any) {
      alert(`오류 발생: ${err.message}`);
    }
  };

  return {
    showSmitheryMarketplace,
    setShowSmitheryMarketplace,
    smitherySearchQuery,
    setSmitherySearchQuery,
    smitherySearchResults,
    setSmitherySearchResults,
    smitherySearchLoading,
    setSmitherySearchLoading,
    smitheryError,
    setSmitheryError,
    smitheryMessage,
    setSmitheryMessage,
    selectedSmitheryServer,
    setSelectedSmitheryServer,
    smitheryDetailLoading,
    smitheryAlias,
    setSmitheryAlias,
    smitheryConfigValues,
    setSmitheryConfigValues,
    smitheryMerging,
    smitherySearchSequence,
    handleSearchSmithery,
    handleSelectSmitheryServer,
    handleMergeSmithery,
    handleToggleMcpServer
  };
}
