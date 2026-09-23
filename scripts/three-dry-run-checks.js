import 'dotenv/config';
import fs from 'node:fs';
import { runScreeningCycle } from '../index.js';
if (process.env.DRY_RUN !== 'true' || process.env.SUNSTRIKE_LIVE_ENABLED === 'true') {
  throw new Error('Requires dry run with live disabled');
}
if (fs.existsSync('logs/ten-dry-run-cycles.lock')) throw new Error('Stop the previous bounded runner first');
const lockPath = 'logs/three-dry-run-checks.lock';
const lock = fs.openSync(lockPath, 'wx', 0o600);
fs.writeSync(lock, String(process.pid));
fs.closeSync(lock);
const state = { status: 'running', started_at: new Date().toISOString(), interval_seconds: 60, cycles: [], live_ready: false };
const save = () => fs.writeFileSync('logs/three-dry-run-checks.json', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
save();
try {
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, 60000));
    const started = new Date().toISOString();
    const report = await runScreeningCycle({ silent: true });
    const outcome = /fail|error|blocked/i.test(report ?? '') ? 'failed'
      : report?.startsWith('⛔ NO DEPLOY') ? 'no_entry'
      : /SIMULATED DEPLOY/.test(report ?? '') ? 'simulated_entry'
      : 'unverified';
    state.cycles.push({ number: i + 1, started_at: started, finished_at: new Date().toISOString(), outcome });
    save();
  }
  state.status = 'complete';
} catch {
  state.status = 'failed';
} finally {
  save();
  fs.rmSync(lockPath, { force: true });
}
console.log(JSON.stringify(state));
process.exit(state.status === 'complete' && state.cycles.every(c => c.outcome !== 'failed' && c.outcome !== 'unverified') ? 0 : 1);
