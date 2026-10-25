/* 青元修真 · 道友服务（Cloudflare Worker + KV）
 *
 * 存数据两种方式，任选其一（代码会自动判断）：
 *   A. 绑定 KV 命名空间到变量 KV（最优，无需令牌）
 *   B. 不绑定，改在下面 CF_ACC / CF_NS / CF_TOK 三个常量里填值（走 Cloudflare REST API）
 * 路由（全部 CORS 放行，仅用 JSON）：
 *   POST /reg      {u,n,r,s,p}            → {ok,token}          注册/取回令牌
 *   POST /sync     {token,snap}            → {ok}               同步自己的快照
 *   POST /req      {token,to}              → {ok}               按道号发申请
 *   GET  /inbox?u=&token=                  → {ok,list:[...]}    我的待处理申请
 *   POST /ack      {token,from,act}        → {ok}               同意/拒绝
 *   GET  /friends?u=&token=                → {ok,list:[...]}    好友（实时快照）
 *   GET  /p?u=                             → {ok,player}        查某人快照
 *   GET  /health                           → {ok,ts}
 *
 * 设计取舍：
 * - 无数据库，只用 KV；每个玩家 3 个键：p:<uid> 资料、k:<uid> 令牌、q:<uid> 申请队列
 * - 好友关系对称存两份数组 f:<uid>（JSON 数组，上限 200）
 * - 令牌 = 32 位随机 hex，首次 /reg 生成，客户端存 localStorage；换设备可重新 /reg 取回（令牌会刷新）
 */

/* ---------- B 方案（不绑定 KV 时用）：填这三个常量 ---------- */
const CF_ACC = '96deee7f2257d70cca2cb5ed79dabff4';   // 账号 ID（32 位 hex，Dashboard 右下角/URL 里可见）
const CF_NS  = 'ec9a8ee25dc446cbb5da8317c8638eca';   // KV 命名空间 ID，例如 6f1c…（Workers KV 列表里那一列）
const CF_TOK = '';   // API 令牌，权限 Workers KV Storage:Edit

/* ---------- C 方案：Upstash Redis（免费、纯 REST，不依赖 CF 绑定）----------
 * 在 upstash.com 建一个 Redis 库，把 REST URL 和 REST TOKEN 填到这里即可。
 * 例：const UPSTASH_URL='https://xxx.upstash.io'; const UPSTASH_TOKEN='AXxx…';
 */
const UPSTASH_URL = '';
const UPSTASH_TOKEN = '';
const UPSTASH_READY = !!UPSTASH_URL && !!UPSTASH_TOKEN;

/* 统一存储层：有 env.KV 用它，否则走 REST API */
function store(env) {
  if (env && env.KV && typeof env.KV.get === 'function') {
    return {
      get: (k) => env.KV.get(k),
      put: async (k, v) => {
        await env.KV.put(k, v);
        return true;
      },
    };
  }
  if (UPSTASH_READY) {
    const uh = { authorization: 'Bearer ' + UPSTASH_TOKEN };
    const call = async (cmd) => {
      const r = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: { ...uh, 'content-type': 'application/json' },
        body: JSON.stringify(cmd),
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null);
      return j && j.result !== undefined ? j.result : null;
    };
    return {
      get: (k) => call(['GET', k]),
      put: async (k, v) => {
        const out = await call(['SET', k, String(v)]);
        return out === 'OK';
      },
    };
  }

  const base =
    'https://api.cloudflare.com/client/v4/accounts/' +
    encodeURIComponent(CF_ACC) +
    '/storage/kv/namespaces/' +
    encodeURIComponent(CF_NS) +
    '/values/';
  const auth = { authorization: 'Bearer ' + CF_TOK };
  return {
    async get(k) {
      const r = await fetch(base + encodeURIComponent(k), { headers: auth });
      if (!r.ok) return null;
      return await r.text();
    },
    async put(k, v) {
      const r = await fetch(base + encodeURIComponent(k), {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'text/plain' },
        body: v,
      });
      return r.ok;
    },
  };
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-token',
  'access-control-max-age': '86400',
};

const J = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

const okUid = (u) => typeof u === 'string' && /^1\d{11}$/.test(u);
const hex = (n) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};
const clampInt = (v, min, max) => Math.max(min, Math.min(max, Number(v) | 0));
const cleanName = (n) => String(n == null ? '' : n).slice(0, 16).replace(/[<>\r\n]/g, '') || '无名道友';

function cleanSnap(o, uid) {
  return {
    u: uid,
    n: cleanName(o && o.n),
    r: clampInt(o && o.r, 0, 8),
    s: clampInt(o && o.s, 0, 8),
    p: clampInt(o && o.p, 0, 129),
    t: Date.now(),
  };
}

async function readJson(env, key, dflt) {
  const raw = await (await store(env)).get(key);
  if (!raw) return dflt;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return dflt;
  }
}
const writeJson = async (env, key, val) => (await store(env)).put(key, JSON.stringify(val));

async function auth(env, uid, token) {
  if (!okUid(uid) || typeof token !== 'string' || token.length < 16) return false;
  const saved = await (await store(env)).get('k:' + uid);
  return !!saved && saved === token;
}

export async function onRequest(ctx) {
  const req = ctx.request;
  const env = ctx.env;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const segs = (ctx.params && ctx.params.path) || [];
    const path = '/' + (Array.isArray(segs) ? segs.join('/') : String(segs || ''));

    try {
      if (path === '/health') return J({ ok: true, ts: Date.now() });

      if (path === '/diag') {
        const st = await store(env);
        const probe = 'diag:' + Date.now();
        let wrote = false, back = null, err = '';
        try {
          wrote = await st.put(probe, 'ok');
          back = await st.get(probe);
        } catch (e) {
          err = String((e && e.message) || e);
        }
        return J({
          ok: true,
          mode: env && env.KV ? 'kv-binding' : (UPSTASH_READY ? 'upstash' : 'rest-api'),
          wrote: !!wrote,
          readBack: back,
          err,
        });
      }

      /* ---------- 注册 / 令牌 ---------- */
      if (path === '/reg' && req.method === 'POST') {
        const body = await req.json();
        const uid = body && body.u;
        if (!okUid(uid)) return J({ ok: false, err: 'bad-uid' }, 400);
        let token = await (await store(env)).get('k:' + uid);
        if (!token) {
          token = hex(16);
          const saved = await (await store(env)).put('k:' + uid, token);
          if (!saved) return J({ ok: false, err: 'storage' }, 500);
        }
        await writeJson(env, 'p:' + uid, cleanSnap(body, uid));
        return J({ ok: true, token });
      }

      /* ---------- 同步自己的快照 ---------- */
      if (path === '/sync' && req.method === 'POST') {
        const body = await req.json();
        const snap = body && body.snap;
        const uid = snap && snap.u;
        if (!(await auth(env, uid, body && body.token))) return J({ ok: false, err: 'auth' }, 401);
        await writeJson(env, 'p:' + uid, cleanSnap(snap, uid));
        return J({ ok: true });
      }

      /* ---------- 按道号发申请 ---------- */
      if (path === '/req' && req.method === 'POST') {
        const body = await req.json();
        if (!(await auth(env, body && body.u, body && body.token))) return J({ ok: false, err: 'auth' }, 401);
        const to = body && body.to;
        if (!okUid(to)) return J({ ok: false, err: 'bad-target' }, 400);
        const me = body.u;
        if (to === me) return J({ ok: false, err: 'self' }, 400);
        const target = await (await store(env)).get('p:' + to);
        if (!target) return J({ ok: false, err: 'no-such-player' }, 404);
        const friends = await readJson(env, 'f:' + to, []);
        if (friends.includes(me)) return J({ ok: false, err: 'already-friend' }, 409);
        const q = await readJson(env, 'q:' + to, []);
        const mine = (await readJson(env, 'p:' + me, null)) || { u: me, n: '无名道友', r: 0, s: 0, p: 0, t: 0 };
        const entry = { u: me, n: mine.n, r: mine.r | 0, s: mine.s | 0, p: mine.p | 0, t: Date.now() };
        const rest = q.filter((x) => x.u !== me);
        rest.unshift(entry);
        await writeJson(env, 'q:' + to, rest.slice(0, 50));
        return J({ ok: true, name: mine.n });
      }

      /* ---------- 我的待处理申请 ---------- */
      if (path === '/inbox' && req.method === 'GET') {
        const u = url.searchParams.get('u');
        const token = url.searchParams.get('token') || req.headers.get('x-token') || '';
        if (!(await auth(env, u, token))) return J({ ok: false, err: 'auth' }, 401);
        const q = await readJson(env, 'q:' + u, []);
        const list = [];
        for (const it of q) {
          const p = await readJson(env, 'p:' + it.u, null);
          list.push(p ? { u: p.u, n: p.n, r: p.r, s: p.s, p: p.p, t: p.t || it.t } : it);
        }
        return J({ ok: true, list });
      }

      /* ---------- 同意 / 拒绝 ---------- */
      if (path === '/ack' && req.method === 'POST') {
        const body = await req.json();
        const uid = body && body.u;
        if (!(await auth(env, uid, body && body.token))) return J({ ok: false, err: 'auth' }, 401);
        const from = body.from;
        if (!okUid(from)) return J({ ok: false, err: 'bad-target' }, 400);
        const q = await readJson(env, 'q:' + uid, []);
        await writeJson(env, 'q:' + uid, q.filter((x) => x.u !== from));
        if (body.act === 'accept') {
          const add = async (a, b) => {
            const list = await readJson(env, 'f:' + a, []);
            if (!list.includes(b)) list.unshift(b);
            await writeJson(env, 'f:' + a, list.slice(0, 200));
          };
          await add(uid, from);
          await add(from, uid);
        }
        return J({ ok: true });
      }

      /* ---------- 好友列表（实时快照） ---------- */
      if (path === '/friends' && req.method === 'GET') {
        const u = url.searchParams.get('u');
        const token = url.searchParams.get('token') || req.headers.get('x-token') || '';
        if (!(await auth(env, u, token))) return J({ ok: false, err: 'auth' }, 401);
        const ids = await readJson(env, 'f:' + u, []);
        const list = [];
        for (const id of ids) {
          const p = await readJson(env, 'p:' + id, null);
          if (p) list.push(p);
        }
        return J({ ok: true, list });
      }

      /* ---------- 查某人 ---------- */
      if (path === '/p' && req.method === 'GET') {
        const u = url.searchParams.get('u');
        if (!okUid(u)) return J({ ok: false, err: 'bad-uid' }, 400);
        const p = await readJson(env, 'p:' + u, null);
        if (!p) return J({ ok: false, err: 'not-found' }, 404);
        return J({ ok: true, player: p });
      }

      return J({ ok: false, err: 'not-found' }, 404);
    } catch (e) {
      return J({ ok: false, err: 'server', detail: String(e && e.message || e) }, 500);
    }
}
