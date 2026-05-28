export const config = { runtime: 'edge' };

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS });
  }

  const body = await req.json();
  const { provider = 'qwen', apiKey: clientKey, ...rest } = body;

  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  const apiKey = (clientKey && clientKey.trim()) ? clientKey.trim() : (envKey || '');

  // ── OpenAI-compatible providers ──────────────────────────────────────────
  const openaiEndpoints = {
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
  };

  if (openaiEndpoints[provider]) {
    const upstream = await fetch(openaiEndpoints[provider], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(rest),
    });
    const data = await upstream.json();
    return jsonResp(data, upstream.status);
  }

  // ── Claude (Anthropic) ───────────────────────────────────────────────────
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

  // ── Gemini ───────────────────────────────────────────────────────────────
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
