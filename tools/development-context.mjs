import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--repo')) {
  console.error('Usage: node tools/development-context.mjs [--repo <repository path>]');
  process.exitCode = 1;
} else {
  try {
    let repositoryRoot = path.resolve(args[1] ?? fileURLToPath(new URL('../', import.meta.url)));
    const readGit = (gitArgs, optional = false) => {
      const result = spawnSync('git', ['--no-optional-locks', '-C', repositoryRoot, ...gitArgs], {
        encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        if (optional) return [];
        throw new Error(`Git inspection failed (${gitArgs.join(' ')}): ${result.stderr.trim()}`);
      }
      const output = result.stdout.trimEnd();
      return output ? output.split(/\r?\n/) : [];
    };
    const readSourceVersion = relativePath => {
      const packagePath = path.join(repositoryRoot, relativePath);
      if (!fs.existsSync(packagePath)) return null;
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''));
      return typeof pkg.version === 'string' ? pkg.version : null;
    };

    repositoryRoot = path.resolve(readGit(['rev-parse', '--show-toplevel'])[0]);
    const head = readGit(['rev-parse', '--verify', 'HEAD'], true)[0] ?? null;
    const branch = readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], true)[0] ?? null;
    const cachedMain = readGit(['rev-parse', '--verify', 'refs/remotes/origin/main'], true)[0] ?? null;
    const status = readGit(['status', '--porcelain=v1', '--untracked-files=normal']);
    const worktrees = readGit(['worktree', 'list', '--porcelain']);
    const frontendVersion = readSourceVersion('frontend/package.json');
    const desktopVersion = readSourceVersion('desktop/package.json');
    const warnings = [];
    let ahead = null, behind = null;

    if (head && cachedMain) {
      const counts = readGit(['rev-list', '--left-right', '--count', 'refs/remotes/origin/main...HEAD']).join('').trim().split(/\s+/).map(Number);
      if (counts.length !== 2 || counts.some(value => !Number.isInteger(value) || value < 0)) throw new Error('Cannot read cached main divergence.');
      [behind, ahead] = counts;
      if (behind > 0) warnings.push('HEAD is behind cached origin/main; verify the task baseline before editing.');
    }
    if (!head) warnings.push('Repository has no HEAD commit.');
    if (!cachedMain) warnings.push('origin/main is not cached; remote state is unknown.');
    if (head && !branch) warnings.push('HEAD is detached; choose the intended task branch before changes.');
    const versionsMatch = frontendVersion && desktopVersion ? frontendVersion === desktopVersion : null;
    if (versionsMatch === false) warnings.push('Frontend and desktop source versions differ.');

    // Local reads only: no fetch, configuration, index refresh, or ignored data.
    console.log(JSON.stringify({
      workingDirectory: process.cwd(), repositoryRoot, branch,
      detachedHead: Boolean(head && !branch), head,
      cachedOriginMain: cachedMain, remoteVerified: false,
      aheadOfCachedMain: ahead, behindCachedMain: behind,
      frontendSourceVersion: frontendVersion, desktopSourceVersion: desktopVersion,
      sourceVersionsMatch: versionsMatch, statusEntryCount: status.length,
      statusPreview: status.slice(0, 20),
      registeredWorktreeCount: worktrees.filter(line => line.startsWith('worktree ')).length,
      ignoredFilesInspected: false, warnings,
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
