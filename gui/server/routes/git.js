import express from 'express';
import fs from 'fs';
import path from 'path';
import {execFile, spawn} from 'child_process';
import {
    redactCredentials,
    stripRemoteCredentials,
    validateRemoteUrl,
    validateRepositoryName
} from '../../../lib/git-security.js';
import {sendBadRequest, sendServerError} from '../../../lib/interfaces/http/error-mapper.js';

export function createGitRouter(ctx) {
  const router = express.Router();
  const { kitRoot } = ctx;

  // ─── Git API Endpoints ────────────────────────────────────────────────────

  function execFileResult(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      });
    });
  }

  async function findExecutable(command, knownPaths = []) {
    for (const candidate of knownPaths) {
      if (fs.existsSync(candidate)) return candidate;
    }
    try {
      const { stdout } = await execFileResult('/usr/bin/which', [command]);
      return stdout.trim();
    } catch {
      return '';
    }
  }

  const findGhExecutable = () => findExecutable('gh', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);

  const findBrewExecutable = () => findExecutable('brew', ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']);

  async function runGit(args, cwd = kitRoot) {
    try {
      const result = await execFileResult('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
      return `${result.stdout}${result.stderr}`.trim();
    } catch (err) {
      let msg = redactCredentials(err.stderr || err.message).trim();
      if (msg.includes('could not read Username') || msg.includes('terminal prompts disabled') || msg.includes('Permission denied')) {
        msg = 'GitHub CLI (gh) 로그인이 필요하거나 저장소 접근 권한이 부족합니다.';
      }
      throw new Error(msg);
    }
  }

  async function configureGitHubCredentialHelper() {
    const ghPath = await findGhExecutable();
    if (!ghPath) throw new Error('GitHub CLI가 설치되어 있지 않습니다.');
    await execFileResult(ghPath, ['auth', 'setup-git', '--hostname', 'github.com']);
  }

  async function removeStoredRemoteCredentials() {
    try {
      const current = await runGit(['remote', 'get-url', 'origin']);
      const cleaned = stripRemoteCredentials(current);
      if (cleaned !== current) await runGit(['remote', 'set-url', 'origin', cleaned]);
      return cleaned;
    } catch {
      return '';
    }
  }

  // GET /api/gh-status — Check GitHub CLI (gh) installation & login status
  router.get('/api/gh-status', async (req, res) => {
    const ghPath = await findGhExecutable();
    if (!ghPath) return res.json({ isInstalled: false, isLoggedIn: false, username: '' });

    let version = '';
    try {
      const result = await execFileResult(ghPath, ['--version']);
      version = result.stdout.split('\n')[0].trim();
    } catch (err) {
      return res.json({ isInstalled: false, isLoggedIn: false, username: '', error: err.message });
    }

    try {
      const result = await execFileResult(ghPath, ['api', 'user', '--jq', '.login'], { timeout: 15000 });
      return res.json({
        isInstalled: true,
        isLoggedIn: true,
        username: result.stdout.trim(),
        version,
        ghPath
      });
    } catch (err) {
      const authLog = `${err.stdout || ''}${err.stderr || ''}`.trim();
      return res.json({ isInstalled: true, isLoggedIn: false, username: '', version, ghPath, authLog });
    }
  });

  // POST /api/gh-install — One-click install GitHub CLI via brew
  router.post('/api/gh-install', async (req, res) => {
    const existingGh = await findGhExecutable();
    if (existingGh) return res.json({ success: true, alreadyInstalled: true, ghPath: existingGh });

    if (process.platform !== 'darwin') {
      const installHint = process.platform === 'win32'
        ? 'winget install --id GitHub.cli'
        : 'See https://github.com/cli/cli/blob/trunk/docs/install_linux.md';
      return sendBadRequest(res, `Automatic installation is currently supported on macOS with Homebrew. ${installHint}`);
    }

    const brewPath = await findBrewExecutable();
    if (!brewPath) {
      return sendBadRequest(res, 'HOMEBREW_NOT_FOUND', 'Homebrew를 찾을 수 없습니다. brew.sh에서 Homebrew를 먼저 설치하세요.');
    }

    try {
      const result = await execFileResult(brewPath, ['install', 'gh'], { timeout: 300000 });
      const ghPath = await findGhExecutable();
      if (!ghPath) {
        return sendServerError(res, new Error('GitHub CLI 설치 실패: 설치 후 gh 실행 파일을 찾지 못했습니다.'));
      }
      res.json({ success: true, ghPath, output: `${result.stdout}${result.stderr}`.trim() });
    } catch (err) {
      sendServerError(res, err, `GitHub CLI 설치 실패: ${err.stderr || err.message}`);
    }
  });

  // POST /api/gh-login — Non-interactive GitHub CLI login via token or web browser device code
  let ghLoginSession = null;

  function publicGhLoginSession() {
    if (!ghLoginSession) return { running: false, completed: false, output: '', error: '' };
    return {
      running: ghLoginSession.running,
      completed: ghLoginSession.completed,
      output: ghLoginSession.output.slice(-4000),
      error: ghLoginSession.error
    };
  }

  function openGitHubDevicePage() {
    const url = 'https://github.com/login/device';
    let command;
    let args;
    if (process.platform === 'darwin') {
      command = '/usr/bin/open';
      args = [url];
    } else if (process.platform === 'win32') {
      command = 'cmd.exe';
      args = ['/c', 'start', '', url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const opener = spawn(command, args, { detached: true, stdio: 'ignore' });
    opener.unref();
  }

  router.post('/api/gh-login', async (req, res) => {
    const { token } = req.body;
    const ghPath = await findGhExecutable();
    if (!ghPath) return sendBadRequest(res, 'GH_CLI_NOT_INSTALLED', 'GitHub CLI가 설치되어 있지 않습니다.');

    if (token && token.trim()) {
      const child = spawn(ghPath, ['auth', 'login', '--hostname', 'github.com', '--with-token'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdin.end(`${token.trim()}\n`);
      child.on('error', err => sendServerError(res, err, `gh CLI 토큰 로그인 실패: ${err.message}`));
      child.on('close', code => {
        if (code !== 0) return sendServerError(res, new Error(`gh CLI 토큰 로그인 실패: ${stderr || stdout || `exit code ${code}`}`));
        res.json({ success: true, completed: true, message: 'GitHub CLI 토큰 로그인이 완료됐습니다.' });
      });
    } else {
      if (ghLoginSession?.running) {
        return res.json({
          success: true,
          completed: false,
          message: '이미 GitHub 브라우저 인증을 기다리고 있습니다.'
        });
      }

      const child = spawn(ghPath, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--clipboard'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      ghLoginSession = { child, running: true, completed: false, output: '', error: '' };
      const appendOutput = chunk => {
        if (ghLoginSession?.child !== child) return;
        ghLoginSession.output = `${ghLoginSession.output}${chunk}`.replace(/\u001b\[[0-9;]*m/g, '').slice(-4000);
      };
      child.stdout.on('data', appendOutput);
      child.stderr.on('data', appendOutput);
      child.on('error', error => {
        if (ghLoginSession?.child !== child) return;
        ghLoginSession.running = false;
        ghLoginSession.error = error.message;
      });
      child.on('close', code => {
        if (ghLoginSession?.child !== child) return;
        ghLoginSession.running = false;
        ghLoginSession.completed = code === 0;
        if (code !== 0 && !ghLoginSession.error) {
          ghLoginSession.error = ghLoginSession.output.trim() || `gh auth login exited with code ${code}`;
        }
      });
      try {
        openGitHubDevicePage();
      } catch (error) {
        ghLoginSession.output = `브라우저를 자동으로 열지 못했습니다. https://github.com/login/device 를 직접 여세요.\n${error.message}`;
      }
      res.json({
        success: true,
        completed: false,
        message: '브라우저에서 GitHub 인증을 완료하세요. 일회용 코드는 클립보드에 복사됩니다.'
      });
    }
  });

  router.post('/api/gh-open-auth', (req, res) => {
    try {
      openGitHubDevicePage();
      res.json({ success: true });
    } catch (error) {
      sendServerError(res, error, `브라우저 열기 실패: ${error.message}`);
    }
  });

  router.get('/api/gh-login-status', (req, res) => {
    res.json(publicGhLoginSession());
  });

  // GET /api/git-status  — user info, remote url, branch, changed files
  router.get('/api/git-status', async (req, res) => {
    try {
      const gitDir = path.join(kitRoot, '.git');
      if (!fs.existsSync(gitDir)) {
        return res.json({
          isRepo: false,
          kitRoot,
          message: '마스터 킷(~/.agents-kit/kit)에 아직 Git 레포지토리가 생성되지 않았습니다.'
        });
      }

      const [userName, userEmail, remoteUrl, branch, statusRaw, logRaw] = await Promise.allSettled([
        runGit(['config', 'user.name']),
        runGit(['config', 'user.email']),
        runGit(['remote', 'get-url', 'origin']),
        runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
        runGit(['status', '--short']),
        runGit(['log', '--oneline', '-5'])
      ]);

      const changedFiles = statusRaw.status === 'fulfilled' && statusRaw.value
        ? statusRaw.value.split('\n').filter(Boolean).map(line => ({
            status: line.slice(0, 2).trim(),
            file: line.slice(3)
          }))
        : [];

      const recentCommits = logRaw.status === 'fulfilled' && logRaw.value
        ? logRaw.value.split('\n').filter(Boolean)
        : [];

      const cleanRemoteUrl = remoteUrl.status === 'fulfilled' ? stripRemoteCredentials(remoteUrl.value) : '';
      let remoteVerified = false;
      let remoteRepository = '';
      let remotePermission = '';
      let remoteError = '';
      if (cleanRemoteUrl) {
        try {
          const ghPath = await findGhExecutable();
        if (!ghPath) {
          remoteError = 'GitHub CLI가 설치되어 있지 않습니다.';
        } else {
          const match = cleanRemoteUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
          if (!match) {
            remoteError = '현재는 github.com 원격 저장소만 검증할 수 있습니다.';
          } else {
            const repository = `${match[1]}/${match[2]}`;
            const result = await execFileResult(ghPath, [
              'repo', 'view', repository,
              '--json', 'nameWithOwner,url,viewerPermission'
            ], { timeout: 15000 });
            const details = JSON.parse(result.stdout);
            remoteVerified = true;
            remoteRepository = details.nameWithOwner || repository;
            remotePermission = details.viewerPermission || '';
          }
        }
        } catch (error) {
          remoteError = redactCredentials(error.stderr || error.message).trim();
        }
      }

      res.json({
        isRepo: true,
        kitRoot,
        userName: userName.status === 'fulfilled' ? userName.value : '',
        userEmail: userEmail.status === 'fulfilled' ? userEmail.value : '',
        remoteUrl: cleanRemoteUrl,
        remoteConfigured: !!cleanRemoteUrl,
        remoteVerified,
        remoteRepository,
        remotePermission,
        remoteError,
        branch: branch.status === 'fulfilled' ? branch.value : 'main',
        changedFiles,
        recentCommits,
        isConnected: remoteVerified
      });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // POST /api/git-config  — set user.name, user.email, remote origin URL (auto git init if missing)
  router.post('/api/git-config', async (req, res) => {
    const { userName, userEmail, remoteUrl } = req.body;
    try {
      const gitDir = path.join(kitRoot, '.git');
      if (!fs.existsSync(gitDir)) {
        await runGit(['init']);
        try {
          await runGit(['add', '.']);
          await runGit(['commit', '-m', 'Initial commit of Master Kit']);
        } catch (e) {
          // initial commit optional
        }
      }

      const results = [];
      if (userName) {
        await runGit(['config', 'user.name', String(userName)]);
        results.push(`user.name = ${userName}`);
      }
      if (userEmail) {
        await runGit(['config', 'user.email', String(userEmail)]);
        results.push(`user.email = ${userEmail}`);
      }
      if (remoteUrl) {
        const finalUrl = validateRemoteUrl(remoteUrl);

        try {
          await runGit(['remote', 'get-url', 'origin']);
          await runGit(['remote', 'set-url', 'origin', finalUrl]);
        } catch (e) {
          await runGit(['remote', 'add', 'origin', finalUrl]);
        }
        results.push(`remote origin = ${remoteUrl}`);
      }
      await removeStoredRemoteCredentials();
      res.json({ success: true, applied: results });
    } catch (err) {
      sendServerError(res, err);
    }
  });

  // POST /api/git-create-remote — Auto create private GitHub repository via gh CLI
  router.post('/api/git-create-remote', async (req, res) => {
    const { repoName = 'my-master-agent-kit', isPrivate = true } = req.body;
    try {
      const gitDir = path.join(kitRoot, '.git');
      if (!fs.existsSync(gitDir)) {
        await runGit(['init']);
        try {
          await runGit(['add', '.']);
          await runGit(['commit', '-m', 'Initial commit of Master Kit']);
        } catch (e) {
          // ignore
        }
      }

      const safeRepoName = validateRepositoryName(repoName);
      const ghPath = await findGhExecutable();
      if (!ghPath) {
        return sendServerError(res, new Error('GitHub 레포 자동 생성 실패 (gh CLI 미설치 또는 로그인 필요): GitHub CLI가 설치되어 있지 않습니다.'));
      }
      const visibilityFlag = isPrivate ? '--private' : '--public';
      const result = await execFileResult(ghPath, ['repo', 'create', safeRepoName, visibilityFlag, `--source=${kitRoot}`, '--remote=origin', '--push'], { cwd: kitRoot });
      const out = result.stdout.trim();
      let remoteUrl = '';
      try {
        remoteUrl = await runGit(['remote', 'get-url', 'origin']);
      } catch {
        // ignore
      }

      res.json({ success: true, remoteUrl, output: out });
    } catch (err) {
      sendServerError(res, err, `GitHub 레포 자동 생성 실패 (gh CLI 미설치 또는 로그인 필요): ${err.message}`);
    }
  });

  // POST /api/git-sync  — commit + push OR pull
  router.post('/api/git-sync', async (req, res) => {
    const { action, commitMessage } = req.body;
    // action: 'push' | 'pull'
    try {
      if (action === 'push') {
        const msg = commitMessage || `agents-kit: update assets ${new Date().toISOString()}`;
        await configureGitHubCredentialHelper();
        await removeStoredRemoteCredentials();
        await runGit(['add', '.']);
        const pendingChanges = await runGit(['status', '--porcelain']);
        let commitOut = 'Nothing new to commit locally.';
        if (pendingChanges) {
          commitOut = await runGit(['commit', '-m', String(msg)]);
        }
        const pushOut = await runGit(['push', '-u', 'origin', 'HEAD']);
        res.json({ success: true, output: `${commitOut}\n${pushOut}`.trim() });
      } else if (action === 'pull') {
        await configureGitHubCredentialHelper();
        await removeStoredRemoteCredentials();
        const pullOut = await runGit(['pull', 'origin', 'HEAD']);
        res.json({ success: true, output: pullOut });
      } else {
        sendBadRequest(res, 'action must be push or pull');
      }
    } catch (err) {
      let userMsg = err.message;
      if (userMsg.includes('terminal prompts disabled') || userMsg.includes('could not read Username') || userMsg.includes('Permission denied (publickey)')) {
        userMsg = 'GitHub 원격 저장소 인증이 필요합니다. GitHub CLI 로그인을 완료한 뒤 다시 시도하세요.';
      }
      sendServerError(res, err, userMsg);
    }
  });

  return router;
}
