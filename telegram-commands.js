export const TELEGRAM_COMMANDS = [
  { command: "help", description: "Panduan dan contoh perintah" },
  { command: "status", description: "Mode, saldo, dan posisi terbaru" },
  { command: "candidates", description: "Lihat kandidat LP; tanpa deploy" },
  { command: "refresh", description: "Perbarui daftar kandidat; tanpa deploy" },
  { command: "check", description: "Cek kondisi bot dan posisi" },
  { command: "positions", description: "Lihat posisi LP terbuka" },
  { command: "briefing", description: "Laporan harian" },
  { command: "thresholds", description: "Lihat batas screening" },
  { command: "evolve", description: "Evaluasi ambang dari posisi tertutup" },
  { command: "mode", description: "Lihat mode DRY_RUN atau LIVE" },
  { command: "dry_run", description: "Alihkan ke simulasi" },
  { command: "close", description: "Tutup posisi: /close 1" },
  { command: "set", description: "Catat instruksi: /set 1 catatan" },
];

const ALIASES = { start: "help", menu: "help", candidat: "candidates" };
const KEYBOARD_ROWS = [
  [["📊 Status", "status"], ["🔎 Kandidat", "candidates"]],
  [["🔄 Refresh", "refresh"], ["🩺 Cek Bot", "check"]],
  [["📈 Posisi", "positions"], ["📰 Briefing", "briefing"]],
  [["⚙️ Ambang", "thresholds"], ["🧠 Evolve", "evolve"]],
  [["🧪 Mode", "mode"], ["❔ Bantuan", "help"]],
];
const KEYBOARD_COMMANDS = new Map(KEYBOARD_ROWS.flat().map(([label, command]) => [label, command]));

export function telegramReplyKeyboard() {
  return {
    keyboard: KEYBOARD_ROWS.map((row) => row.map(([text]) => ({ text }))),
    resize_keyboard: true,
    input_field_placeholder: "Pilih menu atau tulis pesan",
  };
}

export function parseTelegramCommand(text) {
  const trimmed = String(text || "").trim();
  const keyboardCommand = KEYBOARD_COMMANDS.get(trimmed);
  if (keyboardCommand) return { name: keyboardCommand, args: "" };
  const match = trimmed.match(/^\/([a-z][a-z0-9_]*)(?:@[A-Za-z0-9_]+)?(?:\s+(.*))?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  return { name: ALIASES[name] || name, args: match[2]?.trim() || "" };
}

export function telegramHelp(mode) {
  return `☀️ Sunstrike · ${mode}\nKetuk ikon empat kotak di kolom pesan untuk membuka menu.\n\n` +
    `/status — saldo, mode, dan posisi\n` +
    `/candidates atau /refresh — kandidat terbaru (baca-saja, tidak deploy)\n` +
    `/check — kondisi bot dan posisi (baca-saja)\n` +
    `/positions — daftar posisi\n` +
    `/briefing — laporan harian\n` +
    `/thresholds — ambang screening\n` +
    `/evolve — evaluasi ambang; butuh 5 posisi tertutup, dapat mengubah konfigurasi\n` +
    `/close 1 — tutup posisi nomor 1\n` +
    `/set 1 catatan — simpan instruksi posisi\n` +
    `/mode — lihat mode; /dry_run atau /live untuk mengubahnya\n\n` +
    `Perintah lain: tulis pertanyaan biasa. Aksi LP hanya terjadi jika tool nyata berhasil.`;
}
