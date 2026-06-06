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

// 把中转站的 baseURL 规整为 OpenAI 兼容的 chat/completions 端点
function normalizeCustomEndpoint(baseURL) {
  let u = (baseURL || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(u)) return u;
  if (/\/v\d+$/.test(u)) return u + '/chat/completions';
  return u + '/v1/chat/completions';
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

function epochToShanghai(ms) {
  // epoch 毫秒 → 上海本地（固定 +0800）的 { date:"YYYYMMDD", time:"HHMMSS" }
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`,
    time: `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`,
  };
}

function addMinutes(t6, minutes) {
  // "HHMMSS" + N 分钟 → "HHMMSS"；按当天封顶，避免跨日溢出
  const startSec = parseInt(t6.slice(0, 2), 10) * 3600
    + parseInt(t6.slice(2, 4), 10) * 60
    + parseInt(t6.slice(4, 6), 10);
  const endSec = Math.min(startSec + Math.round(minutes) * 60, 24 * 3600 - 60);
  const h = Math.floor(endSec / 3600);
  const m = Math.floor((endSec % 3600) / 60);
  const s = endSec % 60;
  return String(h).padStart(2, '0') + String(m).padStart(2, '0') + String(s).padStart(2, '0');
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

function buildIcs(tasks, r1 = 15, r2 = 0, calName = 'Snail 任务') {
  const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
  const events = tasks.map(t => {
    const isDone = t.dur_actual != null;
    const descLine = t.notes ? foldLine(`DESCRIPTION:${escapeIcs(t.notes)}`) : null;

    // 有完整计时段（≥1 段，过滤 <1min 误点）→ 每段一个独立事件，落在真实墙钟，已发生不加提醒
    const segs = (Array.isArray(t.segments) ? t.segments : [])
      .filter(s => s && s.s && s.e && (s.e - s.s) >= 60000);
    if (segs.length >= 1) {
      return segs.map((s, i) => {
        const a = epochToShanghai(s.s), b = epochToShanghai(s.e);
        const label = segs.length > 1 ? ` (${i + 1}/${segs.length})` : '';
        const summary = (isDone ? '✓ ' : '') + (t.task_desc || '') + label;
        return [
          'BEGIN:VEVENT',
          `UID:${t.id}-seg${i}@snail`,
          foldLine(`SUMMARY:${escapeIcs(summary)}`),
          `DTSTART;TZID=Asia/Shanghai:${a.date}T${a.time}`,
          `DTEND;TZID=Asia/Shanghai:${b.date}T${b.time}`,
          `DTSTAMP:${now}`,
          ...(descLine ? [descLine] : []),
          'END:VEVENT',
        ].join('\r\n');
      }).join('\r\n');
    }

    // 否则按规划时间显示
    let dateStr, startT, endT;
    if (t.start_time && t.task_date) {
      dateStr = t.task_date.replace(/-/g, '');
      startT = formatTime6(t.start_time);
      const durMin = Number.isFinite(+t.dur_plan) && +t.dur_plan > 0 ? +t.dur_plan : 60;
      endT = addMinutes(startT, durMin);
    } else if (t.deadline) {
      dateStr = t.deadline.replace(/-/g, '');
      startT = '080000';
      endT = '090000';
    } else {
      return '';
    }

    if (dateStr.length !== 8) return '';

    const taskReminderEnabled = t.reminder_enabled !== false && !isDone;
    const alarms = [];
    if (taskReminderEnabled) {
      if (t.reminder_override != null) {
        alarms.push(buildValarm(t.reminder_override));
      } else {
        alarms.push(buildValarm(r1));
        if (r2 > 0) alarms.push(buildValarm(r2));
      }
    }
    const summary = (isDone ? '✓ ' : '') + (t.task_desc || '');
    const lines = [
      'BEGIN:VEVENT',
      `UID:${t.id}@snail`,
      foldLine(`SUMMARY:${escapeIcs(summary)}`),
      `DTSTART;TZID=Asia/Shanghai:${dateStr}T${startT}`,
      `DTEND;TZID=Asia/Shanghai:${dateStr}T${endT}`,
      `DTSTAMP:${now}`,
      ...(descLine ? [descLine] : []),
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
    foldLine(`X-WR-CALNAME:${escapeIcs(calName)}`),
    'X-WR-TIMEZONE:Asia/Shanghai',
    VTIMEZONE_SHANGHAI,
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');
}

export default {
  async fetch(request, env) {
    console.log('Worker received:', request.method, request.url);

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

    if (url.pathname === '/api/qwen') {
      return handleQwen(request, env);
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

async function handleIcal(token, url, env) {
  const r1 = Math.max(1, parseInt(url.searchParams.get('r1') || '15', 10) || 15);
  const r2Raw = parseInt(url.searchParams.get('r2') || '0', 10);
  const r2 = r2Raw > 0 ? r2Raw : 0;

  // 可选 cat 参数：S/R/G/C，按类别筛选；缺省则返回全部
  const CAT_NAMES = { S: 'S 学习', R: 'R 研究', G: 'G 成长', C: 'C 杂事' };
  const catRaw = (url.searchParams.get('cat') || '').trim().toUpperCase();
  const cat = CAT_NAMES[catRaw] ? catRaw : '';
  const calName = cat ? `Snail · ${CAT_NAMES[cat]}` : 'Snail 任务';

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

  // 未删除的任务进日历（含已完成与已计时）；已完成事项以 ✓ 前缀标记，仍然显示在日程订阅中
  // 过滤纳入：有规划时间(start_time/deadline) 或 已完成(dur_actual) 的任务；已计时任务通常已满足前两者之一
  const catFilter = cat ? `&cat=eq.${cat}` : '';
  const tasksResp = await sbFetch(env,
    `/rest/v1/tasks?user_id=eq.${userId}&deleted_at=is.null${catFilter}&or=(deadline.not.is.null,start_time.not.is.null,dur_actual.not.is.null)&select=id,task_desc,notes,deadline,start_time,task_date,dur_plan,dur_actual,segments,reminder_enabled,reminder_override`
  );
  if (!tasksResp.ok) return new Response('Server error', { status: 500 });
  const tasks = await tasksResp.json();

  const ics = buildIcs(Array.isArray(tasks) ? tasks : [], r1, r2, calName);

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

async function handleQwen(request, env) {
  let body;
  try { body = await request.json(); } catch (_) {
    return jsonResp({ error: '请求格式错误' }, 400);
  }

  const { provider = 'qwen', apiKey: clientKey, baseURL, ...rest } = body;

  const envKey = env[`${provider.toUpperCase()}_API_KEY`] || '';
  const apiKey = (clientKey && clientKey.trim()) ? clientKey.trim() : envKey;

  const openaiEndpoints = {
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
  };

  // 自定义 / 中转站：用用户提供的 baseURL，按 OpenAI 兼容格式转发
  if (provider === 'custom') {
    const endpoint = normalizeCustomEndpoint(baseURL);
    if (!endpoint) {
      return jsonResp({ error: '缺少有效的中转站接口地址 (baseURL)' }, 400);
    }
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(rest),
    });
    const data = await upstream.json();
    return jsonResp(data, upstream.status);
  }

  if (openaiEndpoints[provider]) {
    const upstream = await fetch(openaiEndpoints[provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(rest),
    });
    const data = await upstream.json();
    return jsonResp(data, upstream.status);
  }

  if (provider === 'claude') {
    const { model, messages, max_tokens = 1024 } = rest;
    let system;
    let msgs = messages;
    if (messages[0]?.role === 'system') {
      system = messages[0].content;
      msgs = messages.slice(1);
    }
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens, messages: msgs, ...(system ? { system } : {}) }),
    });
    const data = await upstream.json();
    return jsonResp({
      choices: [{ message: { role: 'assistant', content: data.content?.[0]?.text || '' }, finish_reason: data.stop_reason || 'stop' }],
      usage: data.usage,
    }, upstream.status);
  }

  if (provider === 'gemini') {
    const { model, messages, max_tokens = 1024 } = rest;
    let systemInstruction;
    let msgs = messages;
    if (messages[0]?.role === 'system') {
      systemInstruction = { parts: [{ text: messages[0].content }] };
      msgs = messages.slice(1);
    }
    const contents = msgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: Array.isArray(m.content)
        ? m.content.map(c =>
            c.type === 'image_url'
              ? { inlineData: { mimeType: c.image_url.url.split(';')[0].split(':')[1], data: c.image_url.url.split(',')[1] } }
              : { text: c.text })
        : [{ text: m.content }],
    }));
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, ...(systemInstruction ? { systemInstruction } : {}), generationConfig: { maxOutputTokens: max_tokens } }),
      }
    );
    const data = await upstream.json();
    return jsonResp({
      choices: [{ message: { role: 'assistant', content: data.candidates?.[0]?.content?.parts?.[0]?.text || '' }, finish_reason: data.candidates?.[0]?.finishReason || 'stop' }],
      usage: { prompt_tokens: data.usageMetadata?.promptTokenCount, completion_tokens: data.usageMetadata?.candidatesTokenCount },
    }, upstream.status);
  }

  return jsonResp({ error: 'Unknown provider: ' + provider }, 400);
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
