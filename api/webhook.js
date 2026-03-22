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

// Disable body parser — we need the raw body string for HMAC
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end('Method not allowed');

  const rawBody = await readRawBody(req);
  const body    = JSON.parse(rawBody || '{}');
  const hookId  = body._hook_id || '';
  const secret  = process.env.OMNICONVERT_SECRET || '';

  // ── Parse x-reveal-signature: t=<ts>,v1=<sha256> ─────────────────────────
  const revealSig = req.headers['x-reveal-signature'] || '';
  const tMatch    = revealSig.match(/t=(\d+)/);
  const v1Match   = revealSig.match(/v1=([a-f0-9]+)/);
  const theirTs   = tMatch  ? tMatch[1]  : String(Math.floor(Date.now() / 1000));
  const theirHash = v1Match ? v1Match[1] : '';

  // ── Stripe-style: HMAC-SHA256(secret, t + "." + rawBody) ─────────────────
  const stripeMsg  = `${theirTs}.${rawBody}`;
  const stripeHash = crypto.createHmac('sha256', secret).update(stripeMsg).digest('hex');
  const response   = `${theirTs}|${stripeHash}`;

  console.log('[webhook] their sig :', revealSig);
  console.log('[webhook] their hash:', theirHash);
  console.log('[webhook] our  hash :', stripeHash);
  console.log('[webhook] match?    :', theirHash === stripeHash);
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
