// Elapsed-time scheduling: cron minute steps cannot represent e.g. every 45 minutes.
export function scheduleInterval(minutes, callback, onError = () => {}) {
  const delay = Number(minutes) * 60_000;
  if (!Number.isFinite(delay) || delay < 60_000 || delay > 2_147_483_647) {
    throw new Error('Interval must be finite, at least one minute and within timer limits');
  }
  let running = false;
  let stopped = false;
  const timer = setInterval(async () => {
    if (running || stopped) return;
    running = true;
    try {
      await callback();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
    }
  }, delay);
  return { stop() { stopped = true; clearInterval(timer); } };
}
