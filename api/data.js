/**
 * GET /api/data
 * Returns all stored NPS responses as JSON.
 * The dashboard fetches this on load and on every refresh.
 *
 * Query params:
 *   ?from=YYYY-MM-DD   filter from date (inclusive)
 *   ?to=YYYY-MM-DD     filter to date (inclusive)
 *   ?limit=N           max records to return (default 5000)
 */

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  try {
    const limit = Math.min(parseInt(req.query.limit || '5000', 10), 5000);
    const raw   = await kv.lrange('nps:responses', 0, limit - 1);

    let records = (raw || []).map(r => {
      try { return typeof r === 'string' ? JSON.parse(r) : r; }
      catch (_) { return null; }
    }).filter(Boolean);

    // Date filtering
    const { from, to } = req.query;
    if (from || to) {
      const f = from ? new Date(from) : null;
      const t = to   ? new Date(to + 'T23:59:59Z') : null;
      records = records.filter(r => {
        const d = new Date(r.ts);
        if (f && d < f) return false;
        if (t && d > t) return false;
        return true;
      });
    }

    res.status(200).json({ count: records.length, records });

  } catch (err) {
    console.error('[data] KV read failed:', err.message);
    // Return empty data if KV not yet configured
    res.status(200).json({ count: 0, records: [], error: err.message });
  }
}
