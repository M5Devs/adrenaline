'use strict';

/*
 * Shared renderer workload. Executed identically by Adrenaline.js (WebKitGTK)
 * and Electron (Chromium). It deliberately exercises four independent axes at
 * once so that any single-thread bottleneck in the runtime surfaces:
 *
 *   1. Massive dynamic DOM  - 10,000 virtualised records, re-sorted and
 *                             re-filtered continuously, with only the visible
 *                             window materialised into the DOM.
 *   2. IPC storm            - receives ~100 JSON packets/s and acknowledges
 *                             each one so the backend can time the round trip.
 *   3. Live regex search    - a real RegExp is compiled and executed over the
 *                             full 10k dataset on a timer.
 *   4. CSS theme churn      - CSS custom properties are rewritten continuously,
 *                             forcing style recalculation for every row.
 */

(function () {
  const ipc = window.adrenaline;
  const T = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();

  const RECORDS = 10000;
  const VISIBLE = 40;
  const HISTORY = 240;

  const SECTORS = ['Technology', 'Financials', 'Energy', 'Healthcare', 'Industrials', 'Utilities', 'Materials', 'Consumer'];
  const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM'];
  const SEARCH_TERMS = ['tech', 'fin', 'a1', 'z9', 'corp', 'holdings', 'q[0-9]', '^A', 'grp$'];

  // ---- dataset -----------------------------------------------------------
  const data = new Array(RECORDS);
  for (let i = 0; i < RECORDS; i++) {
    data[i] = {
      id: i,
      symbol: 'SYM' + i.toString(36).toUpperCase().padStart(5, '0'),
      price: 10 + (i % 9000) / 10,
      change: ((i % 21) - 10) / 10,
      volume: (i * 7919) % 1000000,
      sector: SECTORS[i % SECTORS.length],
      region: REGIONS[i % REGIONS.length],
      notes: 'record ' + i + ' ' + (i % 3 === 0 ? 'corp holdings' : 'grp') + ' ' + (i % 7 === 0 ? 'tech' : 'fin'),
    };
  }

  let view = data;          // current sorted + filtered view
  let sortKey = 'id';
  let sortDir = 1;
  const SORT_KEYS = ['id', 'price', 'change', 'volume', 'symbol'];
  let sortIdx = 0;
  let searchTerm = '';
  let re = null;
  let termIdx = 0;

  // ---- virtualised DOM ---------------------------------------------------
  const tableEl = document.getElementById('table');
  const rowPool = [];
  for (let i = 0; i < VISIBLE; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    for (let c = 0; c < 5; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (c >= 2 && c <= 4 ? ' num' : '');
      row.appendChild(cell);
    }
    rowPool.push(row);
    tableEl.appendChild(row);
  }

  function paintRows() {
    const n = Math.min(VISIBLE, view.length);
    for (let i = 0; i < VISIBLE; i++) {
      const cells = rowPool[i].children;
      if (i < n) {
        const r = view[i];
        cells[0].textContent = r.id;
        cells[1].textContent = r.symbol;
        cells[2].textContent = r.price.toFixed(2);
        cells[3].textContent = (r.change >= 0 ? '+' : '') + r.change.toFixed(2);
        cells[3].className = 'cell num ' + (r.change >= 0 ? 'up' : 'down');
        cells[4].textContent = r.volume;
        if (rowPool[i].style.display === 'none') rowPool[i].style.display = '';
      } else {
        if (rowPool[i].style.display !== 'none') rowPool[i].style.display = 'none';
      }
    }
  }

  // ---- HUD + sparkline ---------------------------------------------------
  const hud = {
    rows: document.getElementById('s-rows'),
    filtered: document.getElementById('s-filtered'),
    ipc: document.getElementById('s-ipc'),
    frames: document.getElementById('s-frames'),
    last: document.getElementById('s-last'),
    sort: document.getElementById('s-sort'),
    ticker: document.getElementById('ticker'),
  };
  const spark = document.getElementById('spark');
  const sctx = spark.getContext('2d');
  const history = [];
  function drawSpark() {
    const w = spark.width, h = spark.height;
    sctx.clearRect(0, 0, w, h);
    if (history.length < 2) return;
    let max = 1;
    for (let i = 0; i < history.length; i++) if (history[i] > max) max = history[i];
    sctx.strokeStyle = '#4f8cff';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = (i / (history.length - 1)) * w;
      const y = h - (history[i] / max) * (h - 2) - 1;
      if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
    }
    sctx.stroke();
  }

  // ---- counters ----------------------------------------------------------
  let ipcRecv = 0;
  let frames = 0;
  let lastFrameTs = T();
  let lastTickMs = 0;
  let renderPasses = 0;

  // ---- IPC ingress -------------------------------------------------------
  if (ipc && ipc.on) {
    ipc.on('ipc-data', function (payload) {
      ipcRecv++;
      const now = T();
      // Mutate a slice of the live dataset on every packet so the receive path
      // also drives data churn, mirroring a real streaming dashboard.
      const start = payload.seq % (RECORDS - 16);
      for (let k = 0; k < 16; k++) {
        const r = data[start + k];
        if (r) { r.price = payload.metrics[k]; r.change = payload.metrics[k] - r.price; }
      }
      hud.ticker.textContent = payload.symbol + ' ' + payload.metrics[0].toFixed(2) + ' @ ' + new Date().toISOString();
      if (ipc.send) {
        // Acknowledge immediately: the backend timestamps the matching arrival
        // to derive the exact round-trip latency for this packet.
        ipc.send('ipc-ack', { seq: payload.seq, recv: now });
      }
    });
  }

  // ---- timers ------------------------------------------------------------
  function mutate() {
    const t0 = T();
    for (let i = 0; i < 250; i++) {
      const r = data[(Math.random() * RECORDS) | 0];
      r.price += (Math.random() - 0.5) * 4;
      if (r.price < 0.5) r.price = 0.5;
      r.change = (Math.random() - 0.5) * 8;
      r.volume = (r.volume + ((Math.random() * 5000) | 0)) % 1000000;
    }
    lastTickMs = T() - t0;
    hud.last.textContent = lastTickMs.toFixed(2);
  }

  function doSort() {
    sortIdx = (sortIdx + 1) % SORT_KEYS.length;
    sortKey = SORT_KEYS[sortIdx];
    sortDir = (sortIdx % 2 === 0) ? 1 : -1;
    hud.sort.textContent = sortKey + (sortDir > 0 ? '▲' : '▼');
    applyView();
  }

  function applyView() {
    let rows = data;
    if (re) {
      const acc = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (re.test(r.symbol) || re.test(r.notes) || re.test(r.sector)) acc.push(r);
      }
      rows = acc;
    }
    const k = sortKey, d = sortDir;
    if (k === 'symbol') {
      rows = rows.slice().sort((a, b) => a.symbol < b.symbol ? -d : a.symbol > b.symbol ? d : 0);
    } else {
      rows = rows.slice().sort((a, b) => (a[k] - b[k]) * d);
    }
    view = rows;
    renderPasses++;
    paintRows();
    hud.rows.textContent = RECORDS;
    hud.filtered.textContent = view.length;
  }

  function doSearch() {
    termIdx = (termIdx + 1) % SEARCH_TERMS.length;
    searchTerm = SEARCH_TERMS[termIdx];
    try { re = new RegExp(searchTerm, 'i'); } catch (e) { re = null; }
    applyView();
  }

  const THEMES = [
    { bg: '#0b1020', fg: '#e6ecff', accent: '#4f8cff', a: '#121a33', b: '#0e1528' },
    { bg: '#1a0b10', fg: '#ffe6ec', accent: '#ff4f8c', a: '#33121a', b: '#280e15' },
    { bg: '#0b1a10', fg: '#e6ffec', accent: '#4fff8c', a: '#12331a', b: '#0e2815' },
    { bg: '#1a150b', fg: '#fff4e6', accent: '#ffc14f', a: '#332a12', b: '#28200e' },
  ];
  let themeIdx = 0;
  function doTheme() {
    themeIdx = (themeIdx + 1) % THEMES.length;
    const t = THEMES[themeIdx];
    const root = document.documentElement.style;
    root.setProperty('--bg', t.bg);
    root.setProperty('--fg', t.fg);
    root.setProperty('--accent', t.accent);
    root.setProperty('--row-a', t.a);
    root.setProperty('--row-b', t.b);
    // Force a synchronous layout + style recalculation across every row.
    void document.body.offsetHeight;
  }

  function frame() {
    frames++;
    const now = T();
    const dt = now - lastFrameTs;
    lastFrameTs = now;
    history.push(dt);
    if (history.length > HISTORY) history.shift();
    if (frames % 30 === 0) {
      hud.frames.textContent = frames;
      hud.ipc.textContent = ipcRecv;
      drawSpark();
    }
    requestAnimationFrame(frame);
  }

  // ---- periodic telemetry back to the backend ---------------------------
  setInterval(function () {
    if (ipc && ipc.send) {
      ipc.send('render-stats', {
        frames,
        ipcRecv,
        renderPasses,
        viewLen: view.length,
        lastTickMs,
        t: Date.now(),
      });
    }
  }, 1000);

  // ---- start -------------------------------------------------------------
  // Render the initial view immediately, then hand control to the backend: the
  // idle window between 'render-ready' and 'stress-start' is what lets the
  // profiler capture a clean Idle Memory (PSS) baseline.
  applyView();
  requestAnimationFrame(frame);

  if (ipc && ipc.on) {
    ipc.on('stress-start', function () {
      startStress();
    });
  }

  let stressStarted = false;
  function startStress() {
    if (stressStarted) return;
    stressStarted = true;
    setInterval(mutate, 100);
    setInterval(doSort, 1000);
    setInterval(doSearch, 1500);
    setInterval(doTheme, 750);
  }

  // Signal the very first painted frame back to the backend, which converts it
  // into "startup time to first paint". Two rAF ticks guarantee a real paint.
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      if (ipc && ipc.send) {
        ipc.send('first-paint', { t: Date.now(), perf: T() });
        ipc.send('render-ready', { t: Date.now() });
      }
    });
  });
})();
