const { bot } = require('../lib/telegram');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    await bot.handleUpdate(req.body);
  } catch (err) {
    console.error('telegram-webhook error', err);
  }
  res.status(200).send('ok');
};
