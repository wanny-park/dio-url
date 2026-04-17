/**
 * dio.kr URL Shortener - Cloudflare Worker
 * 
 * KV Namespace: URL_STORE
 *   - "url:{alias}"     → JSON { url, createdAt, clicks }
 *   - "settings"        → JSON { adsEnabled, adsCode, countdown, domain }
 *   - "auth:token"      → API 토큰 (크롬 확장 인증용)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ─── 라우터 ────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // API 라우트
    if (path.startsWith('/api/')) {
      return handleAPI(request, env, path);
    }

    // 단축 URL 리다이렉트
    const alias = path.replace('/', '').trim();
    if (alias && alias !== 'favicon.ico') {
      return handleRedirect(request, env, alias);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ─── API 핸들러 ────────────────────────────────────────────
async function handleAPI(request, env, path) {
  // 인증 체크 (설정 조회는 제외)
  if (path !== '/api/settings' || request.method !== 'GET') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const savedToken = await env.URL_STORE.get('auth:token');
    if (!savedToken || token !== savedToken) {
      return jsonResponse({ error: true, message: 'Unauthorized' }, 401);
    }
  }

  // POST /api/shorten — URL 단축 생성
  if (path === '/api/shorten' && request.method === 'POST') {
    const body = await request.json();
    const { url, custom } = body;

    if (!url || !isValidURL(url)) {
      return jsonResponse({ error: true, message: '유효하지 않은 URL입니다.' }, 400);
    }

    const alias = custom ? sanitizeAlias(custom) : generateAlias();

    // 중복 체크
    const existing = await env.URL_STORE.get(`url:${alias}`);
    if (existing) {
      return jsonResponse({ error: true, message: '이미 사용 중인 별칭입니다.' }, 409);
    }

    const settings = await getSettings(env);
    const data = {
      url,
      alias,
      createdAt: new Date().toISOString(),
      clicks: 0,
    };

    await env.URL_STORE.put(`url:${alias}`, JSON.stringify(data));

    const shortUrl = `${settings.domain}/${alias}`;
    return jsonResponse({ error: false, short: shortUrl, alias });
  }

  // GET /api/links — 링크 목록
  if (path === '/api/links' && request.method === 'GET') {
    const list = await env.URL_STORE.list({ prefix: 'url:' });
    const links = [];
    for (const key of list.keys) {
      const val = await env.URL_STORE.get(key.name);
      if (val) links.push(JSON.parse(val));
    }
    links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return jsonResponse({ error: false, links });
  }

  // DELETE /api/links/:alias
  if (path.startsWith('/api/links/') && request.method === 'DELETE') {
    const alias = path.replace('/api/links/', '');
    await env.URL_STORE.delete(`url:${alias}`);
    return jsonResponse({ error: false, message: '삭제되었습니다.' });
  }

  // GET /api/settings — 설정 조회 (인증 없이 가능, 광고코드 제외)
  if (path === '/api/settings' && request.method === 'GET') {
    const settings = await getSettings(env);
    // 크롬 확장용: 광고 활성화 여부, 도메인만 반환
    return jsonResponse({
      error: false,
      adsEnabled: settings.adsEnabled,
      countdown: settings.countdown,
      domain: settings.domain,
    });
  }

  // POST /api/settings — 설정 저장
  if (path === '/api/settings' && request.method === 'POST') {
    const body = await request.json();
    const current = await getSettings(env);
    const updated = {
      adsEnabled: body.adsEnabled ?? current.adsEnabled,
      adsCode: body.adsCode ?? current.adsCode,
      countdown: parseInt(body.countdown ?? current.countdown) || 5,
      domain: body.domain ?? current.domain,
    };
    await env.URL_STORE.put('settings', JSON.stringify(updated));
    return jsonResponse({ error: false, message: '설정이 저장되었습니다.' });
  }

  // POST /api/auth — 토큰 초기 설정
  if (path === '/api/auth' && request.method === 'POST') {
    const body = await request.json();
    if (!body.token || body.token.length < 16) {
      return jsonResponse({ error: true, message: '토큰은 16자 이상이어야 합니다.' }, 400);
    }
    await env.URL_STORE.put('auth:token', body.token);
    return jsonResponse({ error: false, message: '토큰이 설정되었습니다.' });
  }

  return jsonResponse({ error: true, message: 'Not Found' }, 404);
}

// ─── 리다이렉트 핸들러 ─────────────────────────────────────
async function handleRedirect(request, env, alias) {
  const raw = await env.URL_STORE.get(`url:${alias}`);
  if (!raw) {
    return new Response('링크를 찾을 수 없습니다.', { status: 404 });
  }

  const data = JSON.parse(raw);

  // 클릭 카운트 업데이트 (비동기, 응답 지연 없음)
  data.clicks = (data.clicks || 0) + 1;
  env.URL_STORE.put(`url:${alias}`, JSON.stringify(data));

  const settings = await getSettings(env);

  // 광고 미사용: 바로 리다이렉트
  if (!settings.adsEnabled) {
    return Response.redirect(data.url, 302);
  }

  // 광고 사용: 스플래시 페이지
  return new Response(
    renderSplashPage(data.url, settings),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      }
    }
  );
}

// ─── 스플래시 페이지 HTML ──────────────────────────────────
function renderSplashPage(targetUrl, settings) {
  const countdown = settings.countdown || 5;
  const adsCode = settings.adsCode || '';
  const encodedUrl = encodeURIComponent(targetUrl);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>잠시 후 이동합니다...</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans KR', sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 640px;
      width: 90%;
      text-align: center;
    }
    .ad-area {
      width: 100%;
      margin-bottom: 2rem;
      min-height: 100px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 2.5rem 2rem;
    }
    .timer-ring {
      width: 80px;
      height: 80px;
      margin: 0 auto 1.5rem;
      position: relative;
    }
    .timer-ring svg {
      transform: rotate(-90deg);
    }
    .timer-ring circle {
      fill: none;
      stroke-width: 4;
    }
    .timer-ring .bg { stroke: #2a2a2a; }
    .timer-ring .progress {
      stroke: #4ade80;
      stroke-dasharray: 220;
      stroke-dashoffset: 0;
      stroke-linecap: round;
      transition: stroke-dashoffset 1s linear;
    }
    .timer-num {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 1.5rem;
      font-weight: 700;
      color: #4ade80;
    }
    h2 { font-size: 1.1rem; font-weight: 400; color: #aaa; margin-bottom: 1rem; }
    .url-box {
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-size: 0.8rem;
      color: #666;
      word-break: break-all;
      margin-bottom: 1.5rem;
    }
    .btn-skip {
      display: inline-block;
      padding: 0.75rem 2rem;
      background: #4ade80;
      color: #000;
      font-weight: 700;
      border-radius: 9999px;
      text-decoration: none;
      font-size: 0.9rem;
      transition: opacity 0.2s;
    }
    .btn-skip:hover { opacity: 0.85; }
    .ad-area-bottom { margin-top: 2rem; width: 100%; min-height: 100px; }
    .disclaimer { font-size: 0.7rem; color: #444; margin-top: 1.5rem; }
  </style>
</head>
<body>
  <div class="container">
    <!-- 상단 광고 -->
    <div class="ad-area">${adsCode}</div>

    <div class="card">
      <div class="timer-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle class="bg" cx="40" cy="40" r="35"/>
          <circle class="progress" id="progress-ring" cx="40" cy="40" r="35"/>
        </svg>
        <div class="timer-num" id="timer-num">${countdown}</div>
      </div>
      <h2>잠시 후 목적지로 이동합니다</h2>
      <div class="url-box" id="target-url">${targetUrl}</div>
      <a href="${targetUrl}" class="btn-skip" id="skip-btn">지금 바로 이동 →</a>
      <p class="disclaimer">링크의 내용에 대해 책임지지 않습니다.</p>
    </div>

    <!-- 하단 광고 -->
    <div class="ad-area-bottom">${adsCode}</div>
  </div>

  <script>
    const TOTAL = ${countdown};
    let remaining = TOTAL;
    const ring = document.getElementById('progress-ring');
    const num = document.getElementById('timer-num');
    const circumference = 2 * Math.PI * 35;
    ring.style.strokeDasharray = circumference;
    ring.style.strokeDashoffset = 0;

    function tick() {
      remaining--;
      num.textContent = remaining;
      const offset = circumference * (1 - remaining / TOTAL);
      ring.style.strokeDashoffset = offset;
      if (remaining <= 0) {
        window.location.href = decodeURIComponent("${encodedUrl}");
      } else {
        setTimeout(tick, 1000);
      }
    }
    setTimeout(tick, 1000);
  </script>
</body>
</html>`;
}

// ─── 유틸 ──────────────────────────────────────────────────
async function getSettings(env) {
  const raw = await env.URL_STORE.get('settings');
  if (!raw) {
    return {
      adsEnabled: false,
      adsCode: '',
      countdown: 5,
      domain: 'https://dio.kr',
    };
  }
  return JSON.parse(raw);
}

function generateAlias(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (const byte of array) {
    result += chars[byte % chars.length];
  }
  return result;
}

function sanitizeAlias(str) {
  return str.replace(/[^a-zA-Z0-9\-_]/g, '').slice(0, 20);
}

function isValidURL(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
