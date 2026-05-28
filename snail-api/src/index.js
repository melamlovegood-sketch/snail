const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

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
