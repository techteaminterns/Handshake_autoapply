/**
 * worker/mutex.js
 *
 * In-process promise-based async mutex used to serialize Playwright browser access (`browserBusy`).
 * Guarantees that only one browser task (health check, scrape, or apply) runs at any given time.
 *
 * References:
 * - ProjectDocs/06-implementation.md §Phase V1-A6
 * - .cursor/rules/worker.mdc
 */

export class AsyncMutex {
  constructor() {
    this._queue = Promise.resolve();
    this._activeCount = 0;
  }

  /**
   * Runs an async function while holding the mutex lock.
   * Serializes requests strictly in FIFO order.
   *
   * @template T
   * @param {() => Promise<T>|T} asyncFn
   * @returns {Promise<T>}
   */
  run(asyncFn) {
    this._activeCount++;
    const resultPromise = this._queue.then(async () => {
      return await asyncFn();
    });

    // Update queue to wait for this execution, catching any errors so subsequent tasks still execute
    this._queue = resultPromise
      .catch(() => {})
      .finally(() => {
        this._activeCount--;
      });

    return resultPromise;
  }

  /**
   * Returns true if a task is currently executing or queued.
   * @returns {boolean}
   */
  isLocked() {
    return this._activeCount > 0;
  }
}
