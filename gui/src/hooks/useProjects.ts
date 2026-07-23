import {useState} from 'react';
import {
    createProject as apiCreateProject,
    deleteProject as apiDeleteProject,
    fetchBrowseDirs as apiFetchBrowseDirs,
    fetchProjects as apiFetchProjects
} from '../api/projects';

export function useProjects(
  setSelectedProjectName: (name: string) => void,
  fetchKits: (scope?: 'global' | 'project', proj?: string) => Promise<void>,
  setDeployMsg: (msg: string | null) => void
) {
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [targetProjectPath, setTargetProjectPath] = useState<string>('');
  const [managedProjects, setManagedProjects] = useState<string[]>(['default']);
  const [showCreateProjectModal, setShowCreateProjectModal] = useState<boolean>(false);
  const [newProjectKitInput, setNewProjectKitInput] = useState<string>('');
  const [showDeleteProjectModal, setShowDeleteProjectModal] = useState<boolean>(false);
  const [showDirBrowser, setShowDirBrowser] = useState<boolean>(false);
  const [loadingBrowse, setLoadingBrowse] = useState<boolean>(false);
  const [browserDirData, setBrowserDirData] = useState<{
    currentPath: string;
    parentPath: string | null;
    homePath: string;
    directories: { name: string; path: string; isProject: boolean; hasGit: boolean; hasPackageJson: boolean }[];
  } | null>(null);

  const fetchProjects = async () => {
    try {
      const data = await apiFetchProjects();
      if (data.projects) setManagedProjects(data.projects);
    } catch (err) {
      console.error('Failed to fetch projects:', err);
    }
  };

  const handleCreateProjectKitSubmit = async () => {
    if (!newProjectKitInput.trim()) return;
    const name = newProjectKitInput.trim();
    try {
      const data = await apiCreateProject(name);
      if (data.success) {
        setShowCreateProjectModal(false);
        setNewProjectKitInput('');
        await fetchProjects();
        setSelectedProjectName(data.projectName);
        await fetchKits('project', data.projectName);
        setDeployMsg(`신규 프로젝트 킷 '${data.projectName}'이(가) 성공적으로 생성되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`생성 실패: ${err.message}`);
    }
  };

  const handleDeleteProjectKitSubmit = async (selectedProjectName: string) => {
    if (!selectedProjectName || selectedProjectName === 'default') return;
    try {
      const data = await apiDeleteProject(selectedProjectName);
      if (data.success) {
        setShowDeleteProjectModal(false);
        await fetchProjects();
        setSelectedProjectName('default');
        await fetchKits('project', 'default');
        setDeployMsg(`프로젝트 킷 '${selectedProjectName}'이(가) 성공적으로 삭제되었습니다.`);
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`삭제 실패: ${err.message}`);
    }
  };

  const fetchBrowseDirs = async (dirPath?: string) => {
    setLoadingBrowse(true);
    try {
      const data = await apiFetchBrowseDirs(dirPath);
      setBrowserDirData(data);
      if (data.currentPath) setTargetProjectPath(data.currentPath);
    } catch (err) {
      console.error('Failed to browse dirs:', err);
    } finally {
      setLoadingBrowse(false);
    }
  };

  return {
    showProjectModal,
    setShowProjectModal,
    targetProjectPath,
    setTargetProjectPath,
    managedProjects,
    setManagedProjects,
    showCreateProjectModal,
    setShowCreateProjectModal,
    newProjectKitInput,
    setNewProjectKitInput,
    showDeleteProjectModal,
    setShowDeleteProjectModal,
    showDirBrowser,
    setShowDirBrowser,
    loadingBrowse,
    browserDirData,
    fetchProjects,
    handleCreateProjectKitSubmit,
    handleDeleteProjectKitSubmit,
    fetchBrowseDirs
  };
}
