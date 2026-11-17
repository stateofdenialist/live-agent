import { exec } from 'node:child_process';

/**
 * Opens `url` in the user's default browser.
 *
 * Best-effort: failures are logged, never thrown, because a browser that fails
 * to launch must not break the extension host.
 */
export function openExternalUrl(url: string): void {
  const command =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  exec(command, (err) => {
    if (err) console.error('[Live Agent] Failed to open URL:', err);
  });
}
