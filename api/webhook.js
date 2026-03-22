/**
 * Tannico NPS — Vercel Webhook Endpoint
 * POST /api/webhook  ← paste this URL into OmniPulse → Settings → Webhook
 *
 * Environment variables (set in Vercel dashboard → Settings → Environment Variables):
 *   OMNICONVERT_SECRET   the Webhook Secret shown in OmniPulse webhook settings (NOT the API key)
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
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end('Method not allowed');

  const body   = req.body || {};
  const hookId = body._hook_id || '';
  const secret = process.env.OMNICONVERT_SECRET || '';
  const ts     = String(Math.floor(Date.now() / 1000));

  // ── Log EVERYTHING so we can diagnose ────────────────────────────────────
  console.log('[webhook] === HEADERS ===');
  console.log(JSON.stringify(req.headers));
  console.log('[webhook] === BODY ===');
  console.log(JSON.stringify(body));
  console.log('[webhook] secret len:', secret.length, '| first4:', secret.slice(0, 4));

  // ── Try base64-decoded secret as key ─────────────────────────────────────
  let secretB64 = secret;
  try { secretB64 = Buffer.from(secret, 'base64'); } catch(_) {}

  // ── All variants ─────────────────────────────────────────────────────────
  const v1 = `${ts}|${hmac(ts,           secret)}`;
  const v2 = `${ts}|${hmac(hookId,       secret)}`;
  const v5 = `${ts}|${hmac(ts,           secretB64)}`;
  const v6 = `${ts}|${hmac(hookId,       secretB64)}`;

  console.log('[webhook] v1 raw sign(ts)      :', v1);
  console.log('[webhook] v2 raw sign(hook_id) :', v2);
  console.log('[webhook] v5 b64 sign(ts)      :', v5);
  console.log('[webhook] v6 b64 sign(hook_id) :', v6);

  // ── Respond with v1 (sign timestamp, raw key) ────────────────────────────
  const response = v1;
  console.log('[webhook] responding:', response);

  // ── Store real survey responses (not pings) ───────────────────────────────
  const payload = body._payload || {};
  const isReal  = payload.customer_eid && payload.customer_eid !== '';
  if (isReal) {
    try {
      const record = {
        ts:           new Date().toISOString(),
        customer_id:  payload.customer_eid        || '',
        email:        payload.email               || '',
        nps:          payload.nps_score           ?? null,
        q_consiglio:  payload.q_consiglio         || '',
        q_insoddf:    payload.q_insoddisfatto      || '',
        q_migliorare: payload.q_migliorare         || '',
        q_riacquisto: payload.q_riacquisto         || '',
        q_dove:       payload.q_dove               || '',
        q_prodotti:   payload.q_prodotti           || '',
        q_giudizio:   payload.q_giudizio           || '',
        a_svc:        payload.a_servizio_clienti   ?? null,
        a_sito:       payload.a_sito_app           ?? null,
        a_prezzi:     payload.a_prezzi             ?? null,
        a_spedizione: payload.a_spedizione         ?? null,
        a_pagamento:  payload.a_pagamento          ?? null,
        a_vini:       payload.a_vini               ?? null,
      };
      await kv.lpush('nps:responses', JSON.stringify(record));
      await kv.ltrim('nps:responses', 0, 4999);
      console.log('[webhook] saved response for', record.email);
    } catch (err) {
      console.error('[webhook] KV write failed:', err.message);
    }
  } else {
    console.log('[webhook] ping — not stored');
  }

  res.status(200)
     .setHeader('Content-Type', 'text/plain')
     .send(response);
}
