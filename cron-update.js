// cron-update.js — 현재 비활성화됨
export default async function handler(req, res) {
  return res.status(403).json({ error: "Disabled" });
}
