import { watch, type FSWatcher } from "node:fs";

/** Debounce window: coalesce bursts of file events into one re-index. */
const DEBOUNCE_MS = 300;

/** Active watchers, keyed by directory, so a directory is watched at most once. */
const watchers = new Map<string, FSWatcher>();

/** Pending debounce timers, keyed by directory. */
const timers = new Map<string, NodeJS.Timeout>();

/**
 * Watch a directory (recursively) and invoke `onChange` when TypeScript files
 * change. Events are debounced so a save that emits several events triggers a
 * single re-index. Watching the same directory twice is a no-op.
 *
 * @param directory - The directory to watch.
 * @param onChange - Called (debounced) after a settling period with no new events.
 * @returns Nothing.
 */
export function watchDirectory(directory: string, onChange: () => void): void {
  if (watchers.has(directory)) return;

  const watcher = watch(directory, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".ts")) return;
    schedule(directory, onChange);
  });
  watcher.on("error", () => {
    // A vanished directory or OS limit shouldn't crash the server.
    watchers.delete(directory);
  });
  watchers.set(directory, watcher);
}

/**
 * Debounce a change: reset the timer for this directory so `onChange` fires
 * only after DEBOUNCE_MS of quiet.
 *
 * @param directory - The directory the change belongs to.
 * @param onChange - The callback to fire once events settle.
 * @returns Nothing.
 */
function schedule(directory: string, onChange: () => void): void {
  const existing = timers.get(directory);
  if (existing) clearTimeout(existing);
  timers.set(
    directory,
    setTimeout(() => {
      timers.delete(directory);
      onChange();
    }, DEBOUNCE_MS),
  );
}
