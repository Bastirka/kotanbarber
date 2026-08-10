// Registers (or updates) the Telegram webhook to point at your deployed Vercel URL.
// Usage: TELEGRAM_BOT_TOKEN=... PUBLIC_URL=https://your-site.vercel.app TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const publicUrl = process.env.PUBLIC_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token || !publicUrl) {
    console.error('Set TELEGRAM_BOT_TOKEN and PUBLIC_URL env vars first.');
    process.exit(1);
  }

  const url = `${publicUrl.replace(/\/$/, '')}/api/telegram-webhook`;
  const params = new URLSearchParams({ url });
  if (secret) params.set('secret_token', secret);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?${params.toString()}`);
  const data = await res.json();
  console.log(data);
  if (!data.ok) process.exit(1);
}

main();
