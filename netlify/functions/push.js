const crypto = require('crypto');

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const cleanKey = v => String(v).replace(/[.$#\[\]\/\s]/g, '_');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let tokCache = { t: '', exp: 0 };
async function accessToken(sa) {
  if (tokCache.t && Date.now() < tokCache.exp - 60000) return tokCache.t;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const jwt = head + '.' + claim + '.' + b64u(sig);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('auth failed: ' + JSON.stringify(j).slice(0, 200));
  tokCache = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokCache.t;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let noteId;
  try { noteId = JSON.parse(event.body || '{}').noteId; } catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }
  if (!noteId || !/^[a-z0-9]{3,60}$/i.test(noteId)) return { statusCode: 400, body: 'Bad id' };

  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  const dbUrl = (process.env.FIREBASE_DB_URL || '').replace(/\/+$/, '');
  if (!sa.private_key || !dbUrl) return { statusCode: 500, body: 'Missing environment variables' };

  const tok = await accessToken(sa);
  const qs = `?access_token=${encodeURIComponent(tok)}`;
  const getJson = async path => (await fetch(`${dbUrl}/${path}.json${qs}`)).json();

  let note = null;
  for (let i = 0; i < 5 && !note; i++) {
    note = await getJson(`amaya/notes/${noteId}`);
    if (!note) await sleep(1500);
  }
  if (!note) return { statusCode: 404, body: 'Note not found' };

  const map = (await getJson('amaya/tokens')) || {};
  const runners = (await getJson('amaya/runners')) || {};
  const to = note.to;
  const targets = Object.values(map).filter(x =>
    x && x.t && (to === 'all' || x.o === to || (to === 'staff' && x.o === 'mgr')) &&
    !(x.o !== 'mgr' && runners[x.o] && runners[x.o].notif === false));
  if (!targets.length) return { statusCode: 200, body: JSON.stringify({ sent: 0 }) };

  const pick = x => (x && typeof x === 'object') ? x : { ar: String(x || ''), en: String(x || '') };
  const ti = pick(note.title), bo = pick(note.body);
  const data = {
    title_ar: String(ti.ar || 'Amaya Heroes').slice(0, 120),
    title_en: String(ti.en || ti.ar || 'Amaya Heroes').slice(0, 120),
    body_ar: String(bo.ar || '').slice(0, 300),
    body_en: String(bo.en || bo.ar || '').slice(0, 300),
    kind: String(note.kind || 'info'),
  };

  const results = await Promise.all(targets.map(async x => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: x.t, data, webpush: { headers: { Urgency: 'high' } } } }),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    const dead = /UNREGISTERED|NOT_FOUND/.test(JSON.stringify(j));
    if (dead) await fetch(`${dbUrl}/amaya/tokens/${cleanKey(x.t)}.json${qs}`, { method: 'DELETE' });
    return { ok: false };
  }));

  const sent = results.filter(r => r.ok).length;
  return { statusCode: 200, body: JSON.stringify({ sent, failed: results.length - sent }) };
};
