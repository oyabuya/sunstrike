import "../load-env.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing in .env");
  process.exit(1);
}

async function telegram(method, body = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`${method} HTTP ${response.status}`);
  return data.result;
}

try {
  const bot = await telegram("getMe");
  console.log(`Bot valid: @${bot.username}`);
  const updates = await telegram("getUpdates", { timeout: 0, limit: 20 });
  const chats = new Map();
  for (const update of updates) {
    const message = update.message;
    if (message?.chat?.id && message?.from?.id) {
      chats.set(`${message.chat.id}:${message.from.id}`, {
        chat_id: String(message.chat.id),
        user_id: String(message.from.id),
        chat_type: message.chat.type,
      });
    }
  }
  for (const chat of chats.values()) console.log(JSON.stringify(chat));
  if (!chats.size) console.log("No messages found. Send /start to the bot in Telegram, then rerun this check.");

  const chatId = process.env.TELEGRAM_CHAT_ID;
  const allowed = new Set((process.env.TELEGRAM_ALLOWED_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));
  console.log(`Configured chat: ${chatId ? "set" : "missing"}; allowed users: ${allowed.size}`);
  if (process.argv.includes("--send-test")) {
    if (!chatId || !allowed.size) throw new Error("Set TELEGRAM_CHAT_ID and TELEGRAM_ALLOWED_USER_IDS before sending a test");
    await telegram("sendMessage", { chat_id: chatId, text: "Sunstrike Telegram check: dry run, no transaction." });
    console.log("Test message sent.");
  }
} catch (error) {
  // Never print provider response text: it may contain the token or request URL.
  console.error(error.message.startsWith("Set TELEGRAM_") ? error.message : "Telegram check failed; verify token, network, and webhook status.");
  process.exitCode = 1;
}
