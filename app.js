/* ==============================================
   StockView - Real-time Market Data
   Yahoo Finance via CORS proxy
============================================== */

const CFG = {
  updateMs:  2000,            // 2-second refresh
  chartMs:   5 * 60 * 1000,  // full chart reload every 5 min
  proxies: [
    (u) => u,
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ],
  symbols: {
    KOSPI:  '^KS11',
    SP500:  '^GSPC',
    NASDAQ: '^IXIC',
    KOSDAQ: '^KQ11',
    NIKKEI: '^N225',
    HSI:    '^HSI',
  },
  colors: {
    KOSPI: '#818cf8',
    SP500: '#22d3ee',
  },
};

const state = {
  charts:      {},
  updateTimer: null,
  usingDemo:   false,
};

/* ──────────────────────────────────────────
   API LAYER
────────────────────────────────────────── */
async function apiFetch(url) {
  for (const proxy of CFG.proxies) {
    try {
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const json = await res.json();
      return json;
    } catch { /* try next proxy */ }
  }
  return null;
}

async function fetchChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=1d&includePrePost=false`;
  const data = await apiFetch(url);
  if (!data?.chart?.result?.[0]) return null;

  const r      = data.chart.result[0];
  const meta   = r.meta;
  const ts     = r.timestamp || [];
  const quotes = r.indicators?.quote?.[0] || {};
  const closes = quotes.close || [];

  const points = ts
    .map((t, i) => ({ x: t * 1000, y: closes[i] }))
    .filter(p => p.y != null && isFinite(p.y));

  return { meta, points };
}

async function fetchQuotes(symbols) {
  const joined = symbols.map(s => encodeURIComponent(s)).join('%2C');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${joined}`;
  const data = await apiFetch(url);
  if (!data?.quoteResponse?.result) return null;
  return data.quoteResponse.result;
}

/* ──────────────────────────────────────────
   DEMO DATA FALLBACK
────────────────────────────────────────── */
function makeDemoPoints(base, hours = 6.5) {
  const points = [];
  const now    = Date.now();
  const open   = now - hours * 3600 * 1000;
  let   price  = base * (0.98 + Math.random() * 0.02);

  for (let t = open; t <= now; t += 5 * 60 * 1000) {
    price += price * (Math.random() - 0.495) * 0.003;
    points.push({ x: t, y: parseFloat(price.toFixed(2)) });
  }
  return points;
}

function getDemoData() {
  return {
    KOSPI:  { base: 2680,  change:  18.5, pct:  0.69 },
    SP500:  { base: 5350,  change: -12.3, pct: -0.23 },
    NASDAQ: { base: 18750, change: -45.2, pct: -0.24 },
    KOSDAQ: { base: 870,   change:   4.1, pct:  0.47 },
    NIKKEI: { base: 38200, change:  220,  pct:  0.58 },
    HSI:    { base: 19200, change:  -88,  pct: -0.46 },
  };
}

/* ──────────────────────────────────────────
   CHART SETUP
────────────────────────────────────────── */
function buildGradient(ctx, canvas, hex) {
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 280);
  grad.addColorStop(0,   hex + '50');
  grad.addColorStop(0.6, hex + '15');
  grad.addColorStop(1,   hex + '00');
  return grad;
}

function createChart(canvasId, color) {
  const canvas = document.getElementById(canvasId);
  const ctx    = canvas.getContext('2d');
  const grad   = buildGradient(ctx, canvas, color);

  return new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        data: [],
        borderColor: color,
        backgroundColor: grad,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'hour',
            displayFormats: { hour: 'HH:mm', minute: 'HH:mm' },
            tooltipFormat: 'HH:mm',
          },
          grid:  { color: '#ffffff08' },
          ticks: { color: '#7a8fa8', maxTicksLimit: 7, font: { size: 11 } },
        },
        y: {
          position: 'right',
          grid:  { color: '#ffffff08' },
          ticks: {
            color: '#7a8fa8',
            font:  { size: 11 },
            callback: (v) => v.toLocaleString(),
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#161e2e',
          titleColor: '#7a8fa8',
          bodyColor: '#e8edf5',
          borderColor: '#1e2d45',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          },
        },
      },
    },
  });
}

function setChartData(chart, points) {
  chart.data.datasets[0].data = points;
  chart.update();
}

function appendPoint(chart, x, y) {
  const data = chart.data.datasets[0].data;
  if (data.length > 0 && data[data.length - 1].x === x) {
    data[data.length - 1].y = y;
  } else {
    data.push({ x, y });
    if (data.length > 300) data.shift();
  }
  chart.update('none');
}

/* ──────────────────────────────────────────
   UI HELPERS
────────────────────────────────────────── */
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function fmtPrice(v, decimals = 2) {
  return v == null ? '--' : v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtChange(abs, pct) {
  if (abs == null) return { absStr: '--', pctStr: '--', cls: '' };
  const sign = abs >= 0 ? '+' : '';
  return {
    absStr: `${sign}${fmtPrice(abs)}`,
    pctStr: `${sign}${fmtPrice(pct)}%`,
    cls:    abs >= 0 ? 'positive' : 'negative',
  };
}

function stateLabel(s) {
  return { REGULAR: '장 진행중', PRE: '프리마켓', POST: '애프터마켓', CLOSED: '장 마감' }[s] ?? s ?? '--';
}

function updateMainCard(id, price, chg, pct, open, high, low, prev, marketState) {
  const pfx = id.toLowerCase();
  const { absStr, pctStr, cls } = fmtChange(chg, pct);

  setText(`${pfx}-price`,        fmtPrice(price));
  setText(`${pfx}-change`,       absStr);
  setText(`${pfx}-pct`,          pctStr);
  setText(`${pfx}-open`,         fmtPrice(open));
  setText(`${pfx}-high`,         fmtPrice(high));
  setText(`${pfx}-low`,          fmtPrice(low));
  setText(`${pfx}-prev`,         fmtPrice(prev));
  setText(`${pfx}-market-state`, stateLabel(marketState));

  const absEl = document.getElementById(`${pfx}-change`);
  const pctEl = document.getElementById(`${pfx}-pct`);
  if (absEl) absEl.className = `change-abs ${cls}`;
  if (pctEl) pctEl.className = `change-pct ${cls}`;
}

function updateMiniCard(id, price, pct) {
  const cls  = pct >= 0 ? 'positive' : 'negative';
  const sign = pct >= 0 ? '+' : '';
  setText(`${id}-price`, fmtPrice(price, 0));
  const el = document.getElementById(`${id}-change`);
  if (el) {
    el.textContent = `${sign}${fmtPrice(pct)}%`;
    el.className   = `mini-change ${cls}`;
  }
}

function setConnectionStatus(status) {
  const badge = document.getElementById('conn-badge');
  const label = document.getElementById('conn-label');
  if (!badge || !label) return;
  badge.className   = `badge badge-${status}`;
  label.textContent = status === 'online'  ? '실시간 연결' :
                      status === 'offline' ? '연결 오류'   : '연결 중...';
}

function updateClock() {
  const now = new Date();
  setText('clock', now.toLocaleTimeString('ko-KR'));
  setText('today-date', now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  }));
}

/* ──────────────────────────────────────────
   INITIAL CHART LOAD
────────────────────────────────────────── */
async function loadChartData(market, symbol) {
  const result    = await fetchChart(symbol);
  const loadingEl = document.getElementById(`${market.toLowerCase()}-loading`);

  if (result?.points?.length > 0) {
    setChartData(state.charts[market], result.points);
    if (loadingEl) loadingEl.classList.add('hidden');

    const m = result.meta;
    updateMainCard(
      market,
      m.regularMarketPrice,
      m.regularMarketPrice - m.chartPreviousClose,
      ((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose) * 100,
      m.regularMarketOpen,
      m.regularMarketDayHigh,
      m.regularMarketDayLow,
      m.chartPreviousClose,
      m.marketState,
    );
    return true;
  }

  // Fallback to demo data
  if (loadingEl) loadingEl.classList.add('hidden');
  const demo = getDemoData()[market];
  setChartData(state.charts[market], makeDemoPoints(demo.base));
  updateMainCard(market, demo.base, demo.change, demo.pct,
    demo.base * 0.99, demo.base * 1.01, demo.base * 0.98,
    demo.base - demo.change, 'CLOSED');
  return false;
}

/* ──────────────────────────────────────────
   REAL-TIME UPDATE (every 2s)
────────────────────────────────────────── */
async function refreshQuotes() {
  const quotes = await fetchQuotes(Object.values(CFG.symbols));

  if (!quotes) {
    setConnectionStatus('offline');
    if (state.usingDemo) {
      for (const [, chart] of Object.entries(state.charts)) {
        const data = chart.data.datasets[0].data;
        if (!data.length) continue;
        const last = data[data.length - 1];
        appendPoint(chart, Date.now(), parseFloat((last.y * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2)));
      }
    }
    return;
  }

  setConnectionStatus('online');
  setText('last-update', `마지막 업데이트: ${new Date().toLocaleTimeString('ko-KR')}`);

  for (const q of quotes) {
    const market = Object.keys(CFG.symbols).find(k => CFG.symbols[k] === q.symbol);
    if (!market) continue;

    const price = q.regularMarketPrice;
    const time  = (q.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000;

    if (market === 'KOSPI' || market === 'SP500') {
      updateMainCard(market, price, q.regularMarketChange, q.regularMarketChangePercent,
        q.regularMarketOpen, q.regularMarketDayHigh, q.regularMarketDayLow,
        q.regularMarketPreviousClose, q.marketState);
      appendPoint(state.charts[market], time, price);
    } else {
      const idMap = { NASDAQ: 'nasdaq', KOSDAQ: 'kosdaq', NIKKEI: 'nikkei', HSI: 'hsi' };
      const elId  = idMap[market];
      if (elId) updateMiniCard(elId, price, q.regularMarketChangePercent);
    }
  }
}

/* ──────────────────────────────────────────
   INIT
────────────────────────────────────────── */
async function init() {
  updateClock();
  setInterval(updateClock, 1000);

  state.charts.KOSPI = createChart('kospi-chart', CFG.colors.KOSPI);
  state.charts.SP500 = createChart('sp500-chart', CFG.colors.SP500);

  setConnectionStatus('connecting');

  const [kospiOk, spOk] = await Promise.all([
    loadChartData('KOSPI', CFG.symbols.KOSPI),
    loadChartData('SP500', CFG.symbols.SP500),
  ]);

  state.usingDemo = !kospiOk && !spOk;
  if (state.usingDemo) {
    setConnectionStatus('offline');
    setText('conn-label', '데모 모드 (API 우회)');
    const badge = document.getElementById('conn-badge');
    if (badge) badge.className = 'badge badge-offline';
  }

  // Mini indices
  const miniSymbols = [CFG.symbols.NASDAQ, CFG.symbols.KOSDAQ, CFG.symbols.NIKKEI, CFG.symbols.HSI];
  const miniQuotes  = await fetchQuotes(miniSymbols);
  if (miniQuotes) {
    const idMap = {
      [CFG.symbols.NASDAQ]: 'nasdaq', [CFG.symbols.KOSDAQ]: 'kosdaq',
      [CFG.symbols.NIKKEI]: 'nikkei', [CFG.symbols.HSI]:    'hsi',
    };
    for (const q of miniQuotes) {
      const elId = idMap[q.symbol];
      if (elId) updateMiniCard(elId, q.regularMarketPrice, q.regularMarketChangePercent);
    }
  } else {
    const demo = getDemoData();
    updateMiniCard('nasdaq', demo.NASDAQ.base, demo.NASDAQ.pct);
    updateMiniCard('kosdaq', demo.KOSDAQ.base, demo.KOSDAQ.pct);
    updateMiniCard('nikkei', demo.NIKKEI.base, demo.NIKKEI.pct);
    updateMiniCard('hsi',    demo.HSI.base,    demo.HSI.pct);
  }

  // 2-second real-time refresh
  setInterval(refreshQuotes, CFG.updateMs);

  // Full chart reload every 5 minutes
  setInterval(async () => {
    await loadChartData('KOSPI', CFG.symbols.KOSPI);
    await loadChartData('SP500', CFG.symbols.SP500);
  }, CFG.chartMs);
}

document.addEventListener('DOMContentLoaded', init);