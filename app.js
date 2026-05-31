/* ==============================================
   StockView - Real-time Market Data
   Yahoo Finance v8 (server.py 로컬 프록시 사용)
============================================== */

const CFG = {
  mainUpdateMs: 2000,            // 주요 지수 갱신 (2초)
  miniUpdateMs: 30000,           // 보조 지수 갱신 (30초)
  chartMs:      5 * 60 * 1000,  // 차트 전체 재로드 (5분)

  // 1순위: 로컬 프록시(server.py), 2순위: 직접, 3순위: 외부 프록시
  proxies: [
    (u) => u.replace('https://query1.finance.yahoo.com', '/api'),
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
  colors: { KOSPI: '#818cf8', SP500: '#22d3ee' },
};

const state = { charts: {}, usingDemo: false, activeRecMarket: 'US' };

/* ──────────────────────────────────────────
   추천 종목 데이터
────────────────────────────────────────── */
const RECOMMENDED = {
  US: [
    { symbol: 'NVDA',  ticker: 'NVDA',  name: 'NVIDIA',    tags: ['AI', '반도체'],       reason: 'AI 인프라의 핵심. GPU 데이터센터 수요 급증으로 독점적 시장 지위 확보.' },
    { symbol: 'AAPL',  ticker: 'AAPL',  name: 'Apple',     tags: ['테크', '서비스'],     reason: '애플 인텔리전스 AI 통합 및 서비스 수익 고성장. 견고한 생태계 유지.' },
    { symbol: 'MSFT',  ticker: 'MSFT',  name: 'Microsoft', tags: ['AI', '클라우드'],     reason: 'OpenAI 독점 파트너십과 Azure AI 결합으로 클라우드 2위 지위 강화.' },
    { symbol: 'AMZN',  ticker: 'AMZN',  name: 'Amazon',    tags: ['클라우드', '커머스'], reason: 'AWS 클라우드 1위 유지, 광고·물류 수익 다각화로 이익 개선 지속.' },
    { symbol: 'GOOGL', ticker: 'GOOGL', name: 'Alphabet',  tags: ['AI', '광고'],         reason: 'Gemini AI로 검색 경쟁력 강화, 유튜브 광고·구독 수익 안정 성장.' },
    { symbol: 'TSLA',  ticker: 'TSLA',  name: 'Tesla',     tags: ['전기차', '자율주행'], reason: 'FSD v4 상용화 및 로보택시 사업 기대. 에너지 저장 사업 고성장 중.' },
  ],
  KR: [
    { symbol: '005930.KS', ticker: '005930', name: '삼성전자',       tags: ['반도체', 'AI'],    reason: '글로벌 메모리 1위. HBM3E 양산 본격화로 AI 서버 수혜 기대.' },
    { symbol: '000660.KS', ticker: '000660', name: 'SK하이닉스',     tags: ['HBM', '반도체'],   reason: 'HBM 시장 점유율 50% 이상. 엔비디아·AMD 핵심 파트너.' },
    { symbol: '035420.KS', ticker: '035420', name: 'NAVER',          tags: ['AI', '플랫폼'],    reason: '하이퍼클로바X 기반 B2B AI 사업 확장. 라인야후 지분 재편 기대.' },
    { symbol: '373220.KS', ticker: '373220', name: 'LG에너지솔루션',  tags: ['배터리', '전기차'], reason: '글로벌 배터리 2위. 북미 IRA 보조금 수혜 및 원통형 배터리 확대.' },
    { symbol: '005380.KS', ticker: '005380', name: '현대차',          tags: ['자동차', '전기차'], reason: '아이오닉 시리즈 판매 호조. 미국·유럽 전기차 현지 생산 전략 가속.' },
    { symbol: '035720.KS', ticker: '035720', name: '카카오',          tags: ['플랫폼', 'AI'],    reason: '카카오톡 AI 에이전트 적용 및 광고·커머스 수익화 회복 기대.' },
  ],
};

/* ──────────────────────────────────────────
   API LAYER  (v8 chart 전용)
────────────────────────────────────────── */
async function apiFetch(url) {
  for (const proxy of CFG.proxies) {
    try {
      const res = await fetch(proxy(url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      if (json?.chart?.error || json?.finance?.error) continue;
      return json;
    } catch { /* 다음 프록시 시도 */ }
  }
  return null;
}

async function fetchChart(symbol, interval = '5m', range = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=false`;
  const data = await apiFetch(url);
  if (!data?.chart?.result?.[0]) return null;
  const r      = data.chart.result[0];
  const ts     = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  return {
    meta:   r.meta,
    points: ts.map((t, i) => ({ x: t * 1000, y: closes[i] })).filter(p => p.y != null && isFinite(p.y)),
  };
}

async function fetchLiveQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=false`;
  const data = await apiFetch(url);
  if (!data?.chart?.result?.[0]) return null;
  const m    = data.chart.result[0].meta;
  const prev = m.chartPreviousClose ?? m.previousClose ?? 0;
  return {
    symbol,
    regularMarketPrice:         m.regularMarketPrice,
    regularMarketChange:        prev ? m.regularMarketPrice - prev : 0,
    regularMarketChangePercent: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0,
    regularMarketOpen:          m.regularMarketOpen,
    regularMarketDayHigh:       m.regularMarketDayHigh,
    regularMarketDayLow:        m.regularMarketDayLow,
    regularMarketPreviousClose: prev,
    regularMarketTime:          m.regularMarketTime,
    marketState:                m.marketState,
  };
}

async function fetchQuotes(symbols) {
  const results = await Promise.allSettled(symbols.map(fetchLiveQuote));
  return results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

/* ──────────────────────────────────────────
   DEMO DATA FALLBACK
────────────────────────────────────────── */
function makeDemoPoints(base, hours = 6.5) {
  const points = [];
  const now    = Date.now();
  let   price  = base * (0.98 + Math.random() * 0.02);
  for (let t = now - hours * 3600000; t <= now; t += 300000) {
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
  return new Chart(ctx, {
    type: 'line',
    data: { datasets: [{ data: [], borderColor: color, backgroundColor: buildGradient(ctx, canvas, color),
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color, fill: true, tension: 0.3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'time', time: { unit: 'hour', displayFormats: { hour: 'HH:mm', minute: 'HH:mm' }, tooltipFormat: 'HH:mm' },
          grid: { color: '#ffffff08' }, ticks: { color: '#7a8fa8', maxTicksLimit: 7, font: { size: 11 } } },
        y: { position: 'right', grid: { color: '#ffffff08' },
          ticks: { color: '#7a8fa8', font: { size: 11 }, callback: (v) => v.toLocaleString() } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: '#161e2e', titleColor: '#7a8fa8', bodyColor: '#e8edf5',
          borderColor: '#1e2d45', borderWidth: 1, padding: 10,
          callbacks: { label: (ctx) => ` ${ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` } },
      },
    },
  });
}

function setChartData(chart, points) { chart.data.datasets[0].data = points; chart.update(); }

function appendPoint(chart, x, y) {
  const data = chart.data.datasets[0].data;
  if (data.length > 0 && data[data.length - 1].x === x) { data[data.length - 1].y = y; }
  else { data.push({ x, y }); if (data.length > 400) data.shift(); }
  chart.update('none');
}

/* ──────────────────────────────────────────
   UI HELPERS
────────────────────────────────────────── */
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function fmtPrice(v, decimals = 2) {
  return v == null ? '--' : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtChange(abs, pct) {
  if (abs == null) return { absStr: '--', pctStr: '--', cls: '' };
  const sign = abs >= 0 ? '+' : '';
  return { absStr: `${sign}${fmtPrice(abs)}`, pctStr: `${sign}${fmtPrice(pct)}%`, cls: abs >= 0 ? 'positive' : 'negative' };
}

function stateLabel(s) {
  return { REGULAR: '장 진행중', PRE: '프리마켓', POST: '애프터마켓', CLOSED: '장 마감' }[s] ?? '--';
}

function updateMainCard(id, q) {
  const pfx = id.toLowerCase();
  const { absStr, pctStr, cls } = fmtChange(q.regularMarketChange, q.regularMarketChangePercent);
  setText(`${pfx}-price`,        fmtPrice(q.regularMarketPrice));
  setText(`${pfx}-change`,       absStr);
  setText(`${pfx}-pct`,          pctStr);
  setText(`${pfx}-open`,         fmtPrice(q.regularMarketOpen));
  setText(`${pfx}-high`,         fmtPrice(q.regularMarketDayHigh));
  setText(`${pfx}-low`,          fmtPrice(q.regularMarketDayLow));
  setText(`${pfx}-prev`,         fmtPrice(q.regularMarketPreviousClose));
  setText(`${pfx}-market-state`, stateLabel(q.marketState));
  document.getElementById(`${pfx}-change`)?.setAttribute('class', `change-abs ${cls}`);
  document.getElementById(`${pfx}-pct`)?.setAttribute('class',    `change-pct ${cls}`);
}

function updateMiniCard(id, price, pct) {
  const sign = pct >= 0 ? '+' : '';
  setText(`${id}-price`, fmtPrice(price, 0));
  const el = document.getElementById(`${id}-change`);
  if (el) { el.textContent = `${sign}${fmtPrice(pct)}%`; el.className = `mini-change ${pct >= 0 ? 'positive' : 'negative'}`; }
}

function setConnectionStatus(status) {
  const badge = document.getElementById('conn-badge');
  const label = document.getElementById('conn-label');
  if (!badge || !label) return;
  badge.className   = `badge badge-${status}`;
  label.textContent = { online: '실시간 연결', offline: '연결 오류', connecting: '연결 중...' }[status] ?? status;
}

function updateClock() {
  const now = new Date();
  setText('clock', now.toLocaleTimeString('ko-KR'));
  setText('today-date', now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }));
}

/* ──────────────────────────────────────────
   CHART 초기 로드
────────────────────────────────────────── */
async function loadChartData(market, symbol) {
  const result    = await fetchChart(symbol, '5m', '1d');
  const loadingEl = document.getElementById(`${market.toLowerCase()}-loading`);
  if (result?.points?.length > 0) {
    setChartData(state.charts[market], result.points);
    if (loadingEl) loadingEl.classList.add('hidden');
    const m = result.meta, prev = m.chartPreviousClose ?? 0;
    updateMainCard(market, {
      regularMarketPrice: m.regularMarketPrice,
      regularMarketChange: prev ? m.regularMarketPrice - prev : 0,
      regularMarketChangePercent: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0,
      regularMarketOpen: m.regularMarketOpen, regularMarketDayHigh: m.regularMarketDayHigh,
      regularMarketDayLow: m.regularMarketDayLow, regularMarketPreviousClose: prev, marketState: m.marketState,
    });
    return true;
  }
  if (loadingEl) loadingEl.classList.add('hidden');
  const demo = getDemoData()[market];
  setChartData(state.charts[market], makeDemoPoints(demo.base));
  updateMainCard(market, { regularMarketPrice: demo.base, regularMarketChange: demo.change,
    regularMarketChangePercent: demo.pct, regularMarketOpen: demo.base * 0.99,
    regularMarketDayHigh: demo.base * 1.01, regularMarketDayLow: demo.base * 0.98,
    regularMarketPreviousClose: demo.base - demo.change, marketState: 'CLOSED' });
  return false;
}

/* ──────────────────────────────────────────
   실시간 갱신 — 주요 지수 (2초)
────────────────────────────────────────── */
async function refreshMainIndices() {
  const quotes = await fetchQuotes([CFG.symbols.KOSPI, CFG.symbols.SP500]);
  if (!quotes.length) {
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
    if (!market || !state.charts[market]) continue;
    updateMainCard(market, q);
    appendPoint(state.charts[market], (q.regularMarketTime ?? Math.floor(Date.now() / 1000)) * 1000, q.regularMarketPrice);
  }
}

/* ──────────────────────────────────────────
   보조 지수 갱신 (30초)
────────────────────────────────────────── */
async function refreshMiniIndices() {
  const quotes = await fetchQuotes([CFG.symbols.NASDAQ, CFG.symbols.KOSDAQ, CFG.symbols.NIKKEI, CFG.symbols.HSI]);
  const idMap  = { [CFG.symbols.NASDAQ]: 'nasdaq', [CFG.symbols.KOSDAQ]: 'kosdaq',
                   [CFG.symbols.NIKKEI]: 'nikkei', [CFG.symbols.HSI]: 'hsi' };
  if (!quotes.length) {
    const d = getDemoData();
    updateMiniCard('nasdaq', d.NASDAQ.base, d.NASDAQ.pct);
    updateMiniCard('kosdaq', d.KOSDAQ.base, d.KOSDAQ.pct);
    updateMiniCard('nikkei', d.NIKKEI.base, d.NIKKEI.pct);
    updateMiniCard('hsi',    d.HSI.base,    d.HSI.pct);
    return;
  }
  for (const q of quotes) { const elId = idMap[q.symbol]; if (elId) updateMiniCard(elId, q.regularMarketPrice, q.regularMarketChangePercent); }
}

/* ──────────────────────────────────────────
   추천 종목 UI
────────────────────────────────────────── */
function renderRecCards(market) {
  const grid = document.getElementById('rec-grid');
  if (!grid) return;
  grid.innerHTML = RECOMMENDED[market].map(s => `
    <div class="rec-card" id="rec-${s.symbol.replace(/\./g, '-')}">
      <div class="rec-card-top">
        <div>
          <span class="rec-ticker">${s.ticker}</span>
          <span class="rec-name">${s.name}</span>
        </div>
        <div class="rec-tags">${s.tags.map(t => `<span class="rec-tag">${t}</span>`).join('')}</div>
      </div>
      <div class="rec-price-row">
        <span class="rec-price" id="recprice-${s.symbol.replace(/\./g, '-')}">--</span>
        <span class="rec-pct"   id="recpct-${s.symbol.replace(/\./g, '-')}">--</span>
      </div>
      <p class="rec-reason">${s.reason}</p>
    </div>
  `).join('');
}

async function refreshRecPrices() {
  const market = state.activeRecMarket;
  const isKR   = market === 'KR';
  const quotes = await fetchQuotes(RECOMMENDED[market].map(s => s.symbol));
  for (const q of quotes) {
    const id  = q.symbol.replace(/\./g, '-');
    const pEl = document.getElementById(`recprice-${id}`);
    const cEl = document.getElementById(`recpct-${id}`);
    if (!pEl || !cEl) continue;
    const pct  = q.regularMarketChangePercent;
    const sign = pct >= 0 ? '+' : '';
    pEl.textContent = isKR ? `₩${fmtPrice(q.regularMarketPrice, 0)}` : `$${fmtPrice(q.regularMarketPrice, 2)}`;
    cEl.textContent = `${sign}${fmtPrice(pct)}%`;
    cEl.className   = `rec-pct ${pct >= 0 ? 'positive' : 'negative'}`;
  }
}

function initRecTabs() {
  document.querySelectorAll('.rec-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rec-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeRecMarket = btn.dataset.market;
      renderRecCards(state.activeRecMarket);
      refreshRecPrices();
    });
  });
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
  if (state.usingDemo) { setConnectionStatus('offline'); setText('conn-label', '데모 모드'); }

  await refreshMiniIndices();

  // 추천 종목 초기화
  renderRecCards(state.activeRecMarket);
  initRecTabs();
  await refreshRecPrices();

  setInterval(refreshMainIndices, CFG.mainUpdateMs);   // 2초
  setInterval(refreshMiniIndices, CFG.miniUpdateMs);   // 30초
  setInterval(refreshRecPrices,   10000);              // 10초
  setInterval(async () => {
    await loadChartData('KOSPI', CFG.symbols.KOSPI);
    await loadChartData('SP500', CFG.symbols.SP500);
  }, CFG.chartMs);                                     // 5분
}

document.addEventListener('DOMContentLoaded', init);