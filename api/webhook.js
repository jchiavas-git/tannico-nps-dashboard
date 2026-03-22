/**
 * Tannico NPS — Vercel Webhook Endpoint
 * POST /api/webhook  ← paste this URL into OmniPulse → Settings → Webhook
 *
 * Environment variables:
 *   OMNICONVERT_SECRET   Webhook Secret from OmniPulse webhook settings
 *   KV_REST_API_URL      auto-filled when you link a Vercel KV database
 *   KV_REST_API_TOKEN    auto-filled when you link a Vercel KV database
 */

import crypto from 'crypto';
import { kv }  from '@vercel/kv';

export const config = { api: { bodyParser: true } };

function hmac(algo, message, key) {
  return crypto.createHmac(algo, key).update(message).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end('Method not allowed');

  const body   = req.body || {};
  const hookId = body._hook_id || '';
  const secret = process.env.OMNICONVERT_SECRET || '';

  // ── Parse OmniPulse's x-reveal-signature header ──────────────────────────
  // Header format: "t=1234567890,v1=<sha256_hmac_of_request>"
  const revealSig = req.headers['x-reveal-signature'] || '';
  const tMatch    = revealSig.match(/t=(\d+)/);
  const v1Match   = revealSig.match(/v1=([a-f0-9]+)/);
  const theirTs   = tMatch  ? tMatch[1]  : String(Math.floor(Date.now() / 1000));
  const theirHash = v1Match ? v1Match[1] : '';

  console.log('[webhook] x-reveal-signature:', revealSig);
  console.log('[webhook] their ts  :', theirTs);
  console.log('[webhook] their hash:', theirHash);
  console.log('[webhook] hook_id   :', hookId);

  // ── Theory: respond by echoing their t and v1 (proving we received it) ────
  const response = `${theirTs}|${theirHash}`;
  console.log('[webhook] responding:', response);

  // ── Store real survey responses ───────────────────────────────────────────
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
