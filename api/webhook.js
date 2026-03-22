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

// ─── HMAC helper ──────────────────────────────────────────────────────────────
function hmac(message, key) {
  return crypto.createHmac('sha1', key).update(message).digest('hex');
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

  // ── Log all variants so we can identify the correct one from Vercel logs ──
  const v1 = `${ts}|${hmac(ts,     secret)}`;                        // sign timestamp
  const v2 = `${ts}|${hmac(hookId, secret)}`;                        // sign hook_id
  const v3 = `${ts}|${hmac(ts + hookId, secret)}`;                   // sign ts+hook_id
  const v4 = `${ts}|${hmac(hookId + ts, secret)}`;                   // sign hook_id+ts

  console.log('[webhook] hook_id :', hookId);
  console.log('[webhook] secret  :', secret ? `${secret.slice(0,4)}… (len ${secret.length})` : 'NOT SET');
  console.log('[webhook] v1 sign(ts)          :', v1);
  console.log('[webhook] v2 sign(hook_id)     :', v2);
  console.log('[webhook] v3 sign(ts+hook_id)  :', v3);
  console.log('[webhook] v4 sign(hook_id+ts)  :', v4);

  // ── Use v1 (sign timestamp) — most common webhook pattern ──
  const response = v1;
  console.log('[webhook] responding with v1   :', response);

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
     .send(response);
}
