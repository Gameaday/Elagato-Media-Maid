/**
 * Serialization lock for MediaMaid.
 *
 * Stream Deck lets the user trigger several actions at once (or mash the
 * same key repeatedly). The rename / organize / sort / undo pipelines all
 * follow the same shape: read a folder, compute target paths, then mutate
 * files. If two runs interleave, the second run computes its targets from
 * a folder state the first run is still changing — deconfliction checks
 * race with in-flight renames and undo snapshots can reference files that
 * no longer exist.
 *
 * Every mutating operation therefore runs under this process-wide lock.
 * A single promise chain is enough: the plugin runs in one Node process,
 * and the lock only guards local code (the disk is not shared here).
 */

let tail: Promise<void> = Promise.resolve();

/**
 * Run `fn` exclusively with respect to every other `withFsLock` call.
 *
 * The returned promise settles with fn's outcome (rejections propagate to
 * the caller); the internal chain itself never rejects, so one failed run
 * can never block the runs queued behind it.
 */
export function withFsLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
