import "../load-env.js";
import fs from "node:fs";
import { scheduleInterval } from "../interval-task.js";
import { config } from "../config.js";
import { logAction } from "../logger.js";
import { sendMessage } from "../telegram.js";
import { runScreeningCycle } from "../index.js";

if (process.env.DRY_RUN !== "true" || process.env.SUNSTRIKE_LIVE_ENABLED === "true") {
  throw new Error("Ten-cycle runner requires DRY_RUN=true and live disabled");
}

const total = 10;
const interval = config.schedule.screeningIntervalMin;
const statePath = "./logs/ten-dry-run-cycles.json";
const lockPath = "./logs/ten-dry-run-cycles.lock";
const lock = fs.openSync(lockPath, "wx", 0o600);
fs.writeSync(lock, String(process.pid));
fs.closeSync(lock);
const schedule = `every ${interval} minutes from process start`;
const state = { status: "running", started_at: new Date().toISOString(), completed: 0, total, schedule, interval_minutes: interval };
const save = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
save();

let running = false;
let task;
async function cycle() {
  if (running || state.completed >= total) return;
  running = true;
  const number = state.completed + 1;
  let report;
  try {
    report = await runScreeningCycle();
  } catch (error) {
    report = `Screening failed: ${error.message}`;
  }
  state.completed = number;
  state.last_at = new Date().toISOString();
  state.last_result = report?.startsWith("⛔ NO DEPLOY") ? "no_candidate_or_entry" : /fail|error/i.test(report ?? "") ? "failed" : "reported";
  save();
  logAction({ tool: "ten_dry_run_cycle", args: { cycle: number, total }, result: { outcome: state.last_result }, success: state.last_result !== "failed" });
  running = false;
  if (number === total) {
    state.status = "complete";
    save();
    task.stop();
    await sendMessage(`Sunstrike dry run selesai: ${total} siklus screening. Live tetap terkunci.`);
    fs.unlinkSync(lockPath);
    process.exit(0);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    task?.stop();
    state.status = "stopped";
    save();
    fs.rmSync(lockPath, { force: true });
    process.exit(0);
  });
}
task = scheduleInterval(interval, cycle, (error) => console.error(`Dry-run timer failed: ${error.message}`));
await sendMessage(`Sunstrike dry run dimulai: ${total} siklus screening; jadwal ${schedule}. Tidak ada transaksi.`);
await cycle();
