import {useState} from 'react';
import type {DeploymentChange, DeploymentPlanData} from '../App';
import {
    deployClient as apiDeployClient,
    deployGlobalAll as apiDeployGlobalAll,
    deployProject as apiDeployProject
} from '../api/deploy';

export function useDeploy(
  selectedProjectName: string,
  targetProjectPath: string,
  fetchStatus: () => Promise<void>
) {
  const [deployingGlobal, setDeployingGlobal] = useState<boolean>(false);
  const [deployingProject, setDeployingProject] = useState<boolean>(false);
  const [deployingSingleClient, setDeployingSingleClient] = useState<boolean>(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState<boolean>(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [deploymentPlan, setDeploymentPlan] = useState<DeploymentPlanData | null>(null);

  const showDeploymentPlan = (title: string, changes: DeploymentChange[]) => {
    setDryRunError(null);
    setDeploymentPlan({ title, changes });
  };

  const handlePreviewGlobal = async () => {
    setDryRunLoading(true);
    setDryRunError(null);
    try {
      const data = await apiDeployGlobalAll(true);
      showDeploymentPlan('전역 배포 예정 변경', data.changes || []);
    } catch (err: any) {
      setDryRunError(err.message || 'Dry-run 요청이 실패했습니다.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const handlePreviewProject = async () => {
    if (!targetProjectPath.trim()) {
      setDryRunError('적용할 프로젝트 경로를 입력해주세요.');
      return;
    }
    setDryRunLoading(true);
    setDryRunError(null);
    try {
      const data = await apiDeployProject(targetProjectPath, selectedProjectName, true);
      showDeploymentPlan(`프로젝트 배포 예정 변경 · ${data.targetDir || targetProjectPath}`, data.changes || []);
    } catch (err: any) {
      setDryRunError(err.message || 'Dry-run 요청이 실패했습니다.');
    } finally {
      setDryRunLoading(false);
    }
  };

  const handleDeployGlobal = async () => {
    setDeployingGlobal(true);
    setDeployMsg(null);
    try {
      const data = await apiDeployGlobalAll(false);
      if (data.success) {
        setDeployMsg(`Applied to Global (~/): ${data.appliedLinksCount} Symlinks connected and ${data.syncedCommandsCount} commands synced.`);
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingGlobal(false);
    }
  };

  const handleDeployProjectSubmit = async (onSuccess?: () => void) => {
    if (!targetProjectPath.trim()) {
      alert('적용할 프로젝트 경로를 입력해주세요.');
      return;
    }
    setDeployingProject(true);
    setDeployMsg(null);
    try {
      const data = await apiDeployProject(targetProjectPath, selectedProjectName, false);
      if (data.success) {
        setDeployMsg(`Applied to Project (${data.targetDir}): ${data.appliedLinksCount} Symlinks connected.`);
        if (onSuccess) onSuccess();
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingProject(false);
    }
  };

  const handleDeploySingleClientSubmit = async (modalSelectedClientId: string, onSuccess?: () => void) => {
    setDeployingSingleClient(true);
    setDeployMsg(null);
    try {
      const data = await apiDeployClient(modalSelectedClientId, 'global');
      if (data.success) {
        setDeployMsg(`Applied to ${data.clientName || modalSelectedClientId}: ${data.appliedLinksCount} Symlinks connected.`);
        if (onSuccess) onSuccess();
        await fetchStatus();
        setTimeout(() => setDeployMsg(null), 6000);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDeployingSingleClient(false);
    }
  };

  return {
    deployingGlobal,
    deployingProject,
    deployingSingleClient,
    deployMsg,
    setDeployMsg,
    dryRunLoading,
    dryRunError,
    setDryRunError,
    deploymentPlan,
    setDeploymentPlan,
    handlePreviewGlobal,
    handlePreviewProject,
    handleDeployGlobal,
    handleDeployProjectSubmit,
    handleDeploySingleClientSubmit
  };
}
