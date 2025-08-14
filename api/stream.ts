<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>FiveM Global Player Finder</title>
<style>
  :root{--bg:#0b0e13;--card:#11161f;--fg:#e6edf3;--muted:#9aa4b2;--border:#1f2a37;--accent:#7aa2ff}
  *{box-sizing:border-box}body{margin:0;background:#0b0e13;color:var(--fg);font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif}
  header{padding:24px 16px 6px;text-align:center}
  h1{margin:0 0 6px;font-size:24px} .sub{color:var(--muted);font-size:13px;margin:0}
  .card{max-width:1100px;margin:18px auto;background:#11161f;border:1px solid var(--border);border-radius:14px}
  .content{padding:16px}
  form{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center}
  input[type=text]{padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:#0b1220;color:var(--fg)}
  .btn{padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:#0e1524;color:var(--fg);cursor:pointer}
  .btn.primary{background:linear-gradient(180deg,var(--accent),#5b87ff);border:none;color:#fff}
  .chips{grid-column:1 / -1;display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:13px;margin-top:4px}
  .chip{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--border);padding:6px 10px;border-radius:999px;background:#0b1220}
  .dot{width:8px;height:8px;border-radius:50%} #status{font-size:12px;color:var(--muted);margin-top:6px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  thead{position:sticky;top:0;background:#0c1220;box-shadow:0 1px 0 var(--border)}
  th,td{padding:9px 10px;border-bottom:1px solid var(--border);font-size:14px;text-align:left}
</style>
</head>
<body>
<header>
  <h1>FiveM Global Player Finder</h1>
  <p class="sub">Search a player name across the live CFX masterlist. Results stream in as servers are scanned.</p>
</header>

<section class="card"><div class="content">
  <form id="f">
    <input id="q" type="text" placeholder="Type a player name (e.g. matthew)"/>
    <button class="btn primary" type="submit">Search</button>
    <button class="btn" type="button" id="stopBtn">Stop</button>
    <div class="chips">
      <label class="chip"><input id="exact" type="checkbox"/> Exact match</label>
      <label class="chip"><input id="hl" type="checkbox" checked/> Highlight</label>
      <span class="chip"><input id="cap" type="checkbox" checked/> Cap 1500</span>
      <span class="chip"><span class="dot" id="led" style="background:#64748b"></span><span id="state">Idle</span></span>
      <span class="chip" id="proxyChip">Proxy: (loading)</span>
    </div>
    <div id="status">Idle.</div>
  </form>

  <table id="t"><thead>
    <tr><th>Player</th><th>Server</th><th>Server ID</th><th>Players</th><th>Join</th><th>Details</th></tr>
  </thead><tbody></tbody></table>
</div></section>

<script>
  // ---- Config ----
  // allow ?proxy=... override, otherwise use your Vercel proxy
  const urlProxy = (() => { try { return new URL(location.href).searchParams.get('proxy'); } catch { return null; } })();
  const PROXY = urlProxy || "https://fivem-vercel-proxy-ding.vercel.app/api/stream";
  const DETAIL_URL = id => `https://servers.fivem.net/servers/detail/${id}`;
  const JOIN_URL   = id => `https://cfx.re/join/${id}`;

  // ---- UI refs ----
  const form = document.getElementById('f');
  const nameEl = document.getElementById('q');
  const exactEl = document.getElementById('exact');
  const highlightEl = document.getElementById('hl');
  const capEl = document.getElementById('cap');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  const stateEl = document.getElementById('state');
  const ledEl = document.getElementById('led');
  const proxyChip = document.getElementById('proxyChip');
  const tbody = document.querySelector('#t tbody');

  // show proxy host in chip
  try { proxyChip.textContent = 'Proxy: ' + new URL(PROXY).hostname; } catch { proxyChip.textContent = 'Proxy: set error'; }

  // default: partial match
  exactEl.checked = false;

  let controller = null, stopFlag = false, resultCount = 0;

  const setState = (txt, color) => { stateEl.textContent = txt; ledEl.style.background = color; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stripFx = s => String(s || '').replace(/\^[0-9]/g, '');
  const normalize = s => stripFx(s).toLowerCase();
  const matchName = (cand, q, exact) => typeof cand === 'string' && (exact ? normalize(cand) === q : normalize(cand).includes(q));
  const fmtName = (name, q) => {
    const clean = stripFx(name);
    if (!highlightEl.checked) return esc(clean);
    const i = clean.toLowerCase().indexOf(q);
    if (i < 0) return esc(clean);
    return esc(clean.slice(0,i)) + '<mark>' + esc(clean.slice(i, i+q.length)) + '</mark>' + esc(clean.slice(i+q.length));
  };

  function renderRow(playerName, hostname, id, clients, q) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtName(playerName, q)}</td>
      <td>${esc(hostname)}</td>
      <td><code>${esc(id || '')}</code></td>
      <td>${Number(clients) || 0}</td>
      <td>${id ? `<a href="${JOIN_URL(id)}" target="_blank" rel="noopener">Join</a>` : '-'}</td>
      <td>${id ? `<a href="${DETAIL_URL(id)}" target="_blank" rel="noopener">Details</a>` : '-'}</td>
    `;
    tbody.appendChild(tr);
  }

  function handleServerObject(obj, qn, exact, rawQuery) {
    const id = obj.ID || obj.id || obj.EndPoint || obj.endpoint;
    const data = obj.Data || obj.data || {};
    const hostname = stripFx(data.hostname || data.sv_projectName || '');
    const clients = data.clients ?? obj.clients ?? 0;
    const players = Array.isArray(data.players) ? data.players : (Array.isArray(obj.players) ? obj.players : []);
    const found = players.filter(p => matchName(p?.name, qn, exact));
    for (const p of found) {
      if (!capEl.checked || resultCount < 1500) {
        renderRow(String(p?.name || '(unknown)'), hostname, id, clients, rawQuery.toLowerCase());
        resultCount++;
      }
    }
    return found.length > 0 ? 1 : 0;
  }

  async function runSearch(url, query, exact) {
    setState('Scanning…', '#2dd4bf');
    const ac = new AbortController(); controller = ac;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'Accept': 'text/event-stream' },
      cache: 'no-store',
      mode: 'cors'
    });
    if (!res.ok || !res.body) throw new Error(`Stream not available (${res.status})`);

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const qn = normalize(query);
    let serversScanned = 0, matchesFound = 0;

    // --- Path 1: proper SSE ---
    if (ct.includes('event-stream')) {
      const reader = res.body.getReader();
      const dec = new TextDecoder('utf-8');
      let buf = '', dataBuf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const frames = buf.split(/\r?\n\r?\n/);
        buf = frames.pop() || '';
        for (const frame of frames) {
          const lines = frame.split(/\r?\n/);
          for (const line of lines) if (line.startsWith('data:')) dataBuf += line.slice(5).trim();
          if (dataBuf) {
            try {
              const obj = JSON.parse(dataBuf);
              serversScanned++;
              matchesFound += handleServerObject(obj, qn, !!exact, query);
            } catch {}
            dataBuf = '';
          }
        }
        if (serversScanned % 200 === 0) statusEl.textContent = `Servers scanned: ${serversScanned.toLocaleString()} • Matches: ${matchesFound.toLocaleString()}`;
        if (stopFlag) break;
      }
      setState('Done', '#22c55e');
      statusEl.textContent = `Servers scanned: ${serversScanned.toLocaleString()} • Matches: ${matchesFound.toLocaleString()}`;
      return;
    }

    // --- Path 2: JSON dump (application/json) ---
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const list =
        Array.isArray(json) ? json :
        Array.isArray(json.servers) ? json.servers :
        Array.isArray(json.data) ? json.data :
        Array.isArray(json.result) ? json.result :
        (json.servers && typeof json.servers === 'object' ? Object.values(json.servers) : null);

      if (Array.isArray(list)) {
        for (const obj of list) {
          serversScanned++;
          matchesFound += handleServerObject(obj, qn, !!exact, query);
          if (serversScanned % 500 === 0) statusEl.textContent = `Servers scanned: ${serversScanned.toLocaleString()} • Matches: ${matchesFound.toLocaleString()}`;
        }
      } else if (json && typeof json === 'object') {
        let iter = [];
        try { iter = Object.values(json); } catch {}
        if (iter.length === 0) iter = [json];
        for (const obj of iter) {
          serversScanned++;
          matchesFound += handleServerObject(obj, qn, !!exact, query);
        }
      }
      setState('Done', '#22c55e');
      statusEl.textContent = `Servers scanned: ${serversScanned.toLocaleString()} • Matches: ${matchesFound.toLocaleString()}`;
    } catch (e) {
      setState('Error', '#ef4444');
      statusEl.textContent = `Could not parse stream JSON (${e && e.message ? e.message : 'unknown error'}).`;
    }
  }

  // wire up UI
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = nameEl.value.trim();
    if (!query) { alert('Enter a player name'); return; }
    tbody.innerHTML = '';
    resultCount = 0; stopFlag = false;
    setState('Connecting…', '#7aa2ff');
    stopBtn.disabled = false;

    runSearch(PROXY, query, exactEl.checked).catch(err => {
      setState('Error', '#ef4444');
      statusEl.textContent = `Error: ${err.message || err}`;
    }).finally(() => { stopBtn.disabled = true; });
  });

  stopBtn.addEventListener('click', () => {
    stopFlag = true;
    if (controller) controller.abort();
    setState('Stopped', '#f59e0b');
  });
</script>
</body>
</html>
