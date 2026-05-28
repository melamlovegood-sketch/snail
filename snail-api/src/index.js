const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL = 'https://ckwcobbuserktcjrmgly.supabase.co';

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function sbFetch(env, path, opts = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

function escapeIcs(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldLine(line) {
  if (line.length <= 75) return line;
  const out = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = ' ' + line.slice(75);
  }
  out.push(line);
  return out.join('\r\n');
}

function buildIcs(tasks) {
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const events = tasks.map(t => {
    const dt = (t.deadline || '').replace(/-/g, '');
    if (dt.length !== 8) return '';
    const lines = [
      'BEGIN:VEVENT',
      `UID:${t.id}@snail`,
      foldLine(`SUMMARY:${escapeIcs(t.task_desc)}`),
      `DTSTART:${dt}T000000Z`,
      `DTEND:${dt}T010000Z`,
      `DTSTAMP:${now}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:任务提醒',
      'TRIGGER:-PT30M',
      'END:VALARM',
      'END:VEVENT',
    ];
    return lines.join('\r\n');
  }).filter(Boolean);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Snail//Snail Tasks//ZH',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Snail 任务',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // GET /ical/:token — ICS calendar subscription (no auth needed, token is the secret)
    if (request.method === 'GET' && url.pathname.startsWith('/ical/')) {
      const token = url.pathname.slice(6);
      if (!token) return new Response('Not found', { status: 404 });
      return handleIcal(token, env);
    }

    // GET /api/ical-token — return current user's ical_token (requires JWT)
    if (request.method === 'GET' && url.pathname === '/api/ical-token') {
      return handleIcalToken(request, env);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    if (url.pathname === '/api/send-code') {
      return handleSendCode(request, env);
    }

    if (url.pathname === '/api/verify-code') {
      return handleVerifyCode(request, env);
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

async function handleIcal(token, env) {
  if (!env.SUPABASE_SERVICE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }

  const userResp = await sbFetch(env,
    `/rest/v1/users?ical_token=eq.${encodeURIComponent(token)}&select=id`
  );
  if (!userResp.ok) return new Response('Server error', { status: 500 });
  const users = await userResp.json();
  if (!users || users.length === 0) return new Response('Not found', { status: 404 });

  const userId = users[0].id;

  const tasksResp = await sbFetch(env,
    `/rest/v1/tasks?user_id=eq.${userId}&deleted_at=is.null&deadline=not.is.null&select=id,task_desc,deadline`
  );
  if (!tasksResp.ok) return new Response('Server error', { status: 500 });
  const tasks = await tasksResp.json();

  const ics = buildIcs(Array.isArray(tasks) ? tasks : []);

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="snail-tasks.ics"',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  });
}

async function handleIcalToken(request, env) {
  if (!env.SUPABASE_SERVICE_KEY) {
    return jsonResp({ error: 'Server not configured' }, 503);
  }

  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return jsonResp({ error: 'Unauthorized' }, 401);
  const jwt = auth.slice(7);

  // Verify JWT via Supabase auth API
  const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apikey': env.SUPABASE_SERVICE_KEY,
    },
  });
  if (!verifyResp.ok) return jsonResp({ error: 'Unauthorized' }, 401);
  const authUser = await verifyResp.json();
  if (!authUser || !authUser.id) return jsonResp({ error: 'Unauthorized' }, 401);

  const userResp = await sbFetch(env,
    `/rest/v1/users?id=eq.${authUser.id}&select=ical_token`
  );
  if (!userResp.ok) return jsonResp({ error: 'Server error' }, 500);
  const rows = await userResp.json();
  if (!rows || rows.length === 0) return jsonResp({ error: 'User not found' }, 404);

  return jsonResp({ token: rows[0].ical_token });
}

async function handleSendCode(request, env) {
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResp({ success: false, message: '请求格式错误' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email) || email.includes('..')) {
    return jsonResp({ success: false, message: '邮箱格式不正确' }, 400);
  }

  const code = genCode();
  await env.CODES_KV.put(`code:${email}`, code, { expirationTtl: 300 });

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'noreply@friday0.top',
      to: [email],
      subject: 'Snail 验证码',
      text: `你的验证码是 ${code}，5分钟内有效。`,
    }),
  });

  if (!resp.ok) {
    console.error('Resend error:', await resp.text().catch(() => ''));
    return jsonResp({ success: false, message: '发送失败，请重试' }, 500);
  }

  return jsonResp({ success: true });
}

async function handleVerifyCode(request, env) {
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResp({ valid: false, message: '请求格式错误' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();

  if (!email || !code) {
    return jsonResp({ valid: false, message: '参数缺失' }, 400);
  }

  const stored = await env.CODES_KV.get(`code:${email}`);

  if (!stored) {
    return jsonResp({ valid: false, message: '验证码已过期' });
  }

  if (stored !== code) {
    return jsonResp({ valid: false, message: '验证码错误' });
  }

  await env.CODES_KV.delete(`code:${email}`);

  return jsonResp({ valid: true });
}
