/**
 * Development runner for Live Agent.
 *
 * Builds once, launches Live's Extension Host, then rebuilds and restarts the
 * host on every save so changes reach Live without manual restarts. It also
 * stops a host left behind by an interrupted session, tracked in a pid file, so
 * it never touches another project's extension host.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCH_DIRS = ['src', 'ui/src', 'scripts'];
const DEBOUNCE_MS = 400;
const HOST_COMMAND = 'extensions-cli';
const HOST_PID_FILE = path.join(PROJECT_ROOT, '.live-agent-host.pid');
const isWindows = process.platform === 'win32';

let host: ChildProcess | null = null;
let debounce: NodeJS.Timeout | null = null;

/** Kills a process together with any children it spawned. */
function killTree(pid: number): void {
  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // The host leads its own process group on POSIX (see `detached` below).
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

/** Records the host PID so a later run can stop a host left by a crash. */
function recordHostPid(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    fs.writeFileSync(HOST_PID_FILE, String(child.pid));
  } catch {
    /* Without the file a crashed run just leaves its host behind. */
  }
}

/** Removes the pid file once its host is gone or replaced. */
function clearHostPid(): void {
  try {
    fs.rmSync(HOST_PID_FILE, { force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Whether `pid` is alive and still looks like an extension host. A recorded PID
 * can be reused by an unrelated process, so the command line is checked first.
 */
function isExtensionHost(pid: number): boolean {
  const result = isWindows
    ? spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
        ],
        { encoding: 'utf8' },
      )
    : spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && (result.stdout ?? '').includes(HOST_COMMAND);
}

/** Stops the host left behind by this project's previous session, if any. */
function killStaleHost(): void {
  let recorded = '';
  try {
    recorded = fs.readFileSync(HOST_PID_FILE, 'utf8').trim();
  } catch {
    return;
  }

  const pid = Number.parseInt(recorded, 10);
  if (Number.isInteger(pid) && pid > 0 && isExtensionHost(pid)) {
    killTree(pid);
    console.log(`[dev] stopped stale extension host (pid ${pid})`);
  }
  clearHostPid();
}

/** Runs build.ts (esbuild bundle + Vite UI). */
function build(): boolean {
  // A single command string: Node warns (DEP0190) when args are passed with shell: true.
  const result = spawnSync('npx tsx build.ts', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

function startHost(): void {
  const child = spawn('npx extensions-cli run', {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
    // Without a group of its own, killTree() could only reach the shell wrapper.
    detached: !isWindows,
  });
  host = child;
  recordHostPid(child);
  console.log(`[dev] extension host started (pid ${child.pid ?? '?'})`);

  child.on('exit', (code) => {
    // A host we replaced is no longer `host`; only report genuine exits.
    if (host !== child) return;
    host = null;
    clearHostPid();
    console.log(
      `[dev] extension host exited (code ${code ?? 'null'}) — will restart on the next change.`,
    );
  });
}

function stopHost(): void {
  if (!host?.pid) return;
  const { pid } = host;
  host = null;
  killTree(pid);
}

/** Rebuilds, then swaps the host over to the new bundle. */
function rebuildAndRestart(reason: string): void {
  console.log(`\n[dev] ${reason} — rebuilding…`);

  if (!build()) {
    console.log('[dev] build failed — keeping the running host; save again to retry.');
    return;
  }

  console.log('[dev] restarting extension host');
  stopHost();
  startHost();
}

function watchSources(): void {
  const onChange = (reason: string): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => rebuildAndRestart(reason), DEBOUNCE_MS);
  };

  for (const dir of WATCH_DIRS) {
    const absolute = path.join(PROJECT_ROOT, dir);
    if (!fs.existsSync(absolute)) continue;
    fs.watch(absolute, { recursive: true }, (_event, filename) => {
      const file = String(filename ?? '');
      if (!file || file.endsWith('.test.ts')) return;
      onChange(path.join(dir, file));
    });
  }

  const manifest = path.join(PROJECT_ROOT, 'manifest.json');
  if (fs.existsSync(manifest)) fs.watch(manifest, () => onChange('manifest.json'));
}

function shutdown(): void {
  if (debounce) clearTimeout(debounce);
  stopHost();
  clearHostPid();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (!build()) {
  console.error('[dev] initial build failed — not starting the extension host.');
  process.exit(1);
}

killStaleHost();
startHost();
watchSources();

console.log(
  '[dev] watching src/, ui/src/ and scripts/ — save a file to rebuild and reload. Ctrl+C to stop.',
);
