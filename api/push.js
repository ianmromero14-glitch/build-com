const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:ianmromero14@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { subscription, title, body } = req.body;
  try {
    await webpush.sendNotification(subscription, JSON.stringify({ title, body }));
    res.status(200).json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
