/**
 * Tannico NPS — Vercel Webhook Endpoint
 * POST /api/webhook  ← paste this URL into OmniPulse → Settings → Webhook
 *
 * Environment variables (set in Vercel dashboard → Settings → Environment Variables):
 *   OMNICONVERT_SECRET   your OmniConvert API key
 *   KV_REST_API_URL      auto-filled when you link a Vercel KV database
 *   KV_REST_API_TOKEN    auto-filled when you link a Vercel KV database
 */

import crypto from 'crypto';
import { kv }  from '@vercel/kv';

export const config = { api: { bodyParser: true } };

// ─── HMAC helper — tries all known OmniPulse variants ────────────────────────
function computeHmac(message, secret, algo = 'sha1') {
  return crypto.createHmac(algo, secret).update(message).digest('hex');
}

function buildResponse(ts, secret, hookId) {
  // OmniPulse signs the _hook_id (random challenge UUID), not the timestamp.
  // We return: timestamp|HMAC-SHA1(secret, hook_id)
  const message = hookId || ts;
  const hmac    = computeHmac(message, secret, 'sha1');
  return `${ts}|${hmac}`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow CORS preflight
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end('Method not allowed');

  const body   = req.body || {};
  const hookId = body._hook_id || '';
  const secret = process.env.OMNICONVERT_SECRET || '';
  const ts     = String(Math.floor(Date.now() / 1000));

  // ── Debug log: print what OmniPulse sent and what we respond ──
  console.log('[webhook] hook_id:', hookId);
  console.log('[webhook] body keys:', Object.keys(body));
  const debugResponse = buildResponse(ts, secret, hookId);
  console.log('[webhook] responding:', debugResponse);

  // ── Store survey response (only real submissions, not pings) ──
  const payload = body._payload || {};
  const isReal  = payload.customer_eid && payload.customer_eid !== '';
  if (isReal) {
    try {
      const record = {
        ts:          new Date().toISOString(),
        customer_id: payload.customer_eid        || '',
        email:       payload.email               || '',
        nps:         payload.nps_score           ?? null,
        // Survey question fields — keys confirmed once first real submission arrives
        // (check Vercel function logs for actual field names in _payload)
        q_consiglio:  payload.q_consiglio         || payload['Q (1) - Quanto è probabile che tu consigli Tannico a un amico o collega?'] || '',
        q_insoddf:    payload.q_insoddisfatto      || '',
        q_migliorare: payload.q_migliorare         || '',
        q_riacquisto: payload.q_riacquisto         || '',
        q_dove:       payload.q_dove               || '',
        q_prodotti:   payload.q_prodotti           || '',
        q_giudizio:   payload.q_giudizio           || '',
        a_svc:        payload.a_servizio_clienti   || null,
        a_sito:       payload.a_sito_app           || null,
        a_prezzi:     payload.a_prezzi             || null,
        a_spedizione: payload.a_spedizione         || null,
        a_pagamento:  payload.a_pagamento          || null,
        a_vini:       payload.a_vini               || null,
      };
      // Prepend to KV list (newest first), keep max 5000 entries
      await kv.lpush('nps:responses', JSON.stringify(record));
      await kv.ltrim('nps:responses', 0, 4999);
      console.log('[webhook] saved response for', record.email);
    } catch (err) {
      // KV might not be configured yet — log but don't block the response
      console.error('[webhook] KV write failed:', err.message);
    }
  } else {
    console.log('[webhook] ping/test payload (no customer_eid) — not stored');
  }

  // ── Respond with timestamp|hmac ──
  res.status(200)
     .setHeader('Content-Type', 'text/plain')
     .send(debugResponse);
}
