import test from "node:test";
import assert from "node:assert/strict";
import { TELEGRAM_COMMANDS, parseTelegramCommand, telegramHelp, telegramReplyKeyboard } from "../telegram-commands.js";

test("Telegram menu names are unique and documented", () => {
  const names = TELEGRAM_COMMANDS.map(({ command }) => command);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes("help"));
  for (const name of ["status", "candidates", "refresh", "check", "evolve", "positions"]) {
    assert.ok(telegramHelp("DRY_RUN").includes(`/${name}`));
  }
});

test("Telegram shortcuts and aliases parse without treating plain chat as a command", () => {
  assert.deepEqual(parseTelegramCommand("/candidat"), { name: "candidates", args: "" });
  assert.deepEqual(parseTelegramCommand("/refresh@Sunstrike_Bot"), { name: "refresh", args: "" });
  assert.deepEqual(parseTelegramCommand("/close 2"), { name: "close", args: "2" });
  assert.deepEqual(parseTelegramCommand("/start"), { name: "help", args: "" });
  assert.deepEqual(parseTelegramCommand("🔄 Refresh"), { name: "refresh", args: "" });
  assert.deepEqual(parseTelegramCommand("🩺 Cek Bot"), { name: "check", args: "" });
  assert.equal(parseTelegramCommand("cek kandidat terbaru"), null);
  assert.match(telegramHelp("LIVE"), /baca-saja, tidak deploy/);
});

test("reply keyboard uses collapsible two-column buttons wired to commands", () => {
  const keyboard = telegramReplyKeyboard();
  assert.equal(keyboard.resize_keyboard, true);
  assert.equal(keyboard.is_persistent, undefined);
  assert.equal(keyboard.keyboard.length, 5);
  for (const row of keyboard.keyboard) {
    assert.equal(row.length, 2);
    for (const button of row) assert.ok(parseTelegramCommand(button.text));
  }
});
