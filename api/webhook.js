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

  // ── Extract OmniPulse's own timestamp from x-reveal-signature header ──────
  // Header format: "t=1234567890,v1=<sha256_hmac>"
  const revealSig = req.headers['x-reveal-signature'] || '';
  const tMatch    = revealSig.match(/t=(\d+)/);
  const theirTs   = tMatch ? tMatch[1] : String(Math.floor(Date.now() / 1000));

  console.log('[webhook] x-reveal-signature:', revealSig);
  console.log('[webhook] using timestamp    :', theirTs);
  console.log('[webhook] hook_id            :', hookId);
  console.log('[webhook] secret len         :', secret.length);

  // ── Try all variants using OmniPulse's timestamp ─────────────────────────
  const v1 = `${theirTs}|${hmac('sha256', theirTs,           secret)}`;  // sha256 sign(ts)
  const v2 = `${theirTs}|${hmac('sha256', hookId,            secret)}`;  // sha256 sign(hook_id)
  const v3 = `${theirTs}|${hmac('sha256', theirTs + hookId,  secret)}`;  // sha256 sign(ts+id)
  const v4 = `${theirTs}|${hmac('sha1',   theirTs,           secret)}`;  // sha1   sign(ts)
  const v5 = `${theirTs}|${hmac('sha1',   hookId,            secret)}`;  // sha1   sign(hook_id)

  console.log('[webhook] v1 sha256 sign(ts)         :', v1);
  console.log('[webhook] v2 sha256 sign(hook_id)    :', v2);
  console.log('[webhook] v3 sha256 sign(ts+hook_id) :', v3);
  console.log('[webhook] v4 sha1   sign(ts)         :', v4);
  console.log('[webhook] v5 sha1   sign(hook_id)    :', v5);

  // ── Use v1: SHA-256, sign their timestamp ─────────────────────────────────
  const response = v1;
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
