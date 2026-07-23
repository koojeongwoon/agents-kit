import {useState} from 'react';
import type {GitStatus} from '../types';
import {
    fetchGhLoginStatus,
    fetchGhStatus as apiFetchGhStatus,
    fetchGitStatus as apiFetchGitStatus,
    ghLogin as apiGhLogin,
    gitSync as apiGitSync,
    installGh as apiInstallGh,
    openGhAuthPage as apiOpenGhAuthPage,
    saveRemoteUrl as apiSaveRemoteUrl
} from '../api/git';

export function useGit(setDeployMsg: (msg: string | null) => void) {
  const [showGitModal, setShowGitModal] = useState<boolean>(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [remoteUrlInput, setRemoteUrlInput] = useState<string>('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [gitSyncing, setGitSyncing] = useState<boolean>(false);
  const [gitOutput, setGitOutput] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [ghStatus, setGhStatus] = useState<{ isInstalled: boolean; isLoggedIn: boolean; username: string; version?: string; ghPath?: string } | null>(null);
  const [loadingGh, setLoadingGh] = useState<boolean>(false);
  const [installingGh, setInstallingGh] = useState<boolean>(false);
  const [loggingInGh, setLoggingInGh] = useState<boolean>(false);
  const [ghLoginOutput, setGhLoginOutput] = useState<string>('');

  const fetchGitStatus = async () => {
    try {
      const data = await apiFetchGitStatus();
      setGitStatus(data);
      if (data.remoteUrl) setRemoteUrlInput(data.remoteUrl);
    } catch (err) {
      console.error('Failed to fetch git status:', err);
    }
  };

  const fetchGhStatus = async () => {
    setLoadingGh(true);
    try {
      const data = await apiFetchGhStatus();
      setGhStatus(data);
    } catch (err) {
      console.error('Failed to fetch gh status:', err);
    } finally {
      setLoadingGh(false);
    }
  };

  const handleInstallGh = async () => {
    setInstallingGh(true);
    try {
      const data = await apiInstallGh();
      if (data.success) {
        await fetchGhStatus();
        setDeployMsg('GitHub CLI (gh)가 성공적으로 설치되었습니다!');
        setTimeout(() => setDeployMsg(null), 4000);
      }
    } catch (err: any) {
      alert(`설치 실패: ${err.message}`);
    } finally {
      setInstallingGh(false);
    }
  };

  const handleGhLogin = async () => {
    setLoggingInGh(true);
    setGhLoginOutput('GitHub 인증 페이지를 여는 중입니다...');
    try {
      const data = await apiGhLogin();
      if (data.success) {
        setDeployMsg(data.message || 'GitHub CLI 로그인 연동이 완료되었습니다.');
        if (data.completed) {
          await fetchGhStatus();
        } else {
          let authenticated = false;
          for (let attempt = 0; attempt < 150; attempt += 1) {
            await new Promise(resolve => window.setTimeout(resolve, 2000));
            const statusData = await apiFetchGhStatus();
            const loginStatus = await fetchGhLoginStatus();
            setGhStatus(statusData);
            if (statusData.isLoggedIn) {
              authenticated = true;
              setGhLoginOutput('');
              setDeployMsg(`GitHub CLI 로그인 완료: ${statusData.username || 'github.com'}`);
              break;
            }
            if (!loginStatus.running) {
              const detail = loginStatus.error || loginStatus.output || 'GitHub 인증이 완료되지 않았습니다.';
              setDeployMsg(detail);
              break;
            }
            if (loginStatus.output) {
              setGhLoginOutput(loginStatus.output);
              setDeployMsg(loginStatus.output);
            }
          }
          if (!authenticated) {
            setDeployMsg('GitHub 인증 대기 시간이 초과되었습니다. 다시 로그인을 눌러 시도하세요.');
          }
        }
        setTimeout(() => setDeployMsg(null), 5000);
      }
    } catch (err: any) {
      alert(`오류: ${err.message}`);
    } finally {
      setLoggingInGh(false);
    }
  };

  const handleOpenGhAuthPage = async () => {
    try {
      await apiOpenGhAuthPage();
    } catch (err: any) {
      alert(`GitHub 인증 페이지 열기 실패: ${err.message}`);
    }
  };

  const handleOpenGitModal = async () => {
    await Promise.all([fetchGitStatus(), fetchGhStatus()]);
    setGitOutput(null);
    setGitError(null);
    setShowGitModal(true);
  };

  const handleSaveRemoteUrl = async () => {
    if (!remoteUrlInput.trim()) return;
    try {
      const data = await apiSaveRemoteUrl(remoteUrlInput.trim());
      if (data.success) {
        setGitOutput(`Remote URL 연결 완료: ${remoteUrlInput.trim()}`);
        await fetchGitStatus();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleGitSync = async (action: 'push' | 'pull') => {
    setGitSyncing(true);
    setGitOutput(null);
    setGitError(null);
    try {
      const data = await apiGitSync(action, commitMessage);
      if (data.success) {
        setGitOutput(data.output);
        setCommitMessage('');
        await fetchGitStatus();
      }
    } catch (err: any) {
      setGitError(err.message);
    } finally {
      setGitSyncing(false);
    }
  };

  return {
    showGitModal,
    setShowGitModal,
    gitStatus,
    setGitStatus,
    remoteUrlInput,
    setRemoteUrlInput,
    commitMessage,
    setCommitMessage,
    gitSyncing,
    setGitSyncing,
    gitOutput,
    setGitOutput,
    gitError,
    setGitError,
    ghStatus,
    setGhStatus,
    loadingGh,
    installingGh,
    loggingInGh,
    ghLoginOutput,
    fetchGitStatus,
    fetchGhStatus,
    handleInstallGh,
    handleGhLogin,
    handleOpenGhAuthPage,
    handleOpenGitModal,
    handleSaveRemoteUrl,
    handleGitSync
  };
}
