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

function buildTrigger(minutes) {
  const days = Math.floor(minutes / 1440);
  const rem = minutes % 1440;
  const hours = Math.floor(rem / 60);
  const mins = rem % 60;
  if (days === 0) {
    if (hours === 0) return `TRIGGER:-PT${mins}M`;
    return mins === 0 ? `TRIGGER:-PT${hours}H` : `TRIGGER:-PT${hours}H${mins}M`;
  }
  const timePart = (hours === 0 && mins === 0) ? '' :
    mins === 0 ? `T${hours}H` :
    hours === 0 ? `T${mins}M` :
    `T${hours}H${mins}M`;
  return `TRIGGER:-P${days}D${timePart}`;
}

function buildValarm(minutes) {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:任务提醒', buildTrigger(minutes), 'END:VALARM'].join('\r\n');
}

function formatTime6(timeStr) {
  // "HH:MM:SS" or "HH:MM" → "HHMMSS"
  return timeStr.replace(/:/g, '').slice(0, 6).padEnd(6, '0');
}

function addOneHour(t6) {
  const h = (parseInt(t6.slice(0, 2), 10) + 1) % 24;
  return String(h).padStart(2, '0') + t6.slice(2);
}

const VTIMEZONE_SHANGHAI = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Shanghai',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0800',
  'TZOFFSETTO:+0800',
  'TZNAME:CST',
  'DTSTART:19700101T000000',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

function buildIcs(tasks, r1 = 15, r2 = 0) {
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const events = tasks.map(t => {
    let dateStr, startT, endT;

    if (t.start_time && t.task_date) {
      dateStr = t.task_date.replace(/-/g, '');
      startT = formatTime6(t.start_time);
      endT = addOneHour(startT);
    } else if (t.deadline) {
      dateStr = t.deadline.replace(/-/g, '');
      startT = '080000';
      endT = '090000';
    } else {
      return '';
    }

    if (dateStr.length !== 8) return '';

    const taskReminderEnabled = t.reminder_enabled !== false;
    const alarms = [];
    if (taskReminderEnabled) {
      if (t.reminder_override != null) {
        alarms.push(buildValarm(t.reminder_override));
      } else {
        alarms.push(buildValarm(r1));
        if (r2 > 0) alarms.push(buildValarm(r2));
      }
    }
    const lines = [
      'BEGIN:VEVENT',
      `UID:${t.id}@snail`,
      foldLine(`SUMMARY:${escapeIcs(t.task_desc)}`),
      `DTSTART;TZID=Asia/Shanghai:${dateStr}T${startT}`,
      `DTEND;TZID=Asia/Shanghai:${dateStr}T${endT}`,
      `DTSTAMP:${now}`,
      ...alarms,
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
    'X-WR-TIMEZONE:Asia/Shanghai',
    VTIMEZONE_SHANGHAI,
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
      return handleIcal(token, url, env);
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

async function handleIcal(token, url, env) {
  const r1 = Math.max(1, parseInt(url.searchParams.get('r1') || '15', 10) || 15);
  const r2Raw = parseInt(url.searchParams.get('r2') || '0', 10);
  const r2 = r2Raw > 0 ? r2Raw : 0;

  if (!env.SUPABASE_SERVICE_KEY) {
    return new Response('Server not configured', { status: 503 });
  }

  const userResp = await sbFetch(env,
    `/rest/v1/profiles?ical_token=eq.${encodeURIComponent(token)}&select=id`
  );
  if (!userResp.ok) return new Response('Server error', { status: 500 });
  const users = await userResp.json();
  if (!users || users.length === 0) return new Response('Not found', { status: 404 });

  const userId = users[0].id;

  const tasksResp = await sbFetch(env,
    `/rest/v1/tasks?user_id=eq.${userId}&deleted_at=is.null&or=(deadline.not.is.null,start_time.not.is.null)&select=id,task_desc,deadline,start_time,task_date,reminder_enabled,reminder_override`
  );
  if (!tasksResp.ok) return new Response('Server error', { status: 500 });
  const tasks = await tasksResp.json();

  const ics = buildIcs(Array.isArray(tasks) ? tasks : [], r1, r2);

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="snail-tasks.ics"',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  });
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
