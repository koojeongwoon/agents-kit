import {useState} from 'react';
import type {CategorizedKits} from '../types';
import {fetchKits as apiFetchKits} from '../api/assets';

export function useAssets(kitScope: 'global' | 'project', selectedProjectName: string) {
  const [kits, setKits] = useState<CategorizedKits>({
    skills: [],
    mcp: [],
    agents: [],
    harness: [],
    loops: [],
    memory: []
  });
  const [assetSubTab, setAssetSubTab] = useState<string>('skills');
  const [assetSearchTerm, setAssetSearchTerm] = useState<string>('');
  const [assetCurrentPage, setAssetCurrentPage] = useState<number>(1);

  const fetchKits = async (scope = kitScope, proj = selectedProjectName) => {
    try {
      const data = await apiFetchKits(scope, proj);
      setKits(data);
    } catch (err) {
      console.error('Failed to fetch kits:', err);
    }
  };

  return {
    kits,
    setKits,
    assetSubTab,
    setAssetSubTab,
    assetSearchTerm,
    setAssetSearchTerm,
    assetCurrentPage,
    setAssetCurrentPage,
    fetchKits
  };
}
