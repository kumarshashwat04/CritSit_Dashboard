const REFRESH_INTERVAL_MS = 60000;

const CATEGORY_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
const categoryColorCache = new Map();

function colorForCategory(name) {
  if (!categoryColorCache.has(name)) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    categoryColorCache.set(name, CATEGORY_COLORS[hash % CATEGORY_COLORS.length]);
  }
  return categoryColorCache.get(name);
}

// ---------- Elements ----------

const refreshBtn = document.getElementById('refreshBtn');
const refreshIcon = document.getElementById('refreshIcon');
const errorBanner = document.getElementById('errorBanner');
const errorText = document.getElementById('errorText');

const casesHead = document.getElementById('casesHead');
const casesBody = document.getElementById('casesBody');
const casesCount = document.getElementById('casesCount');
const casesEmpty = document.getElementById('casesEmpty');
const casesTable = document.getElementById('casesTable');

const SERVICES = ['aa', 'ae', 'gstore'];
const SERVICE_LABEL = { aa: 'AA', ae: 'AE', gstore: 'gStore' };
const SERVICE_COLOR = { aa: '#3B82F6', ae: '#F97316', gstore: '#8B5CF6' };

const cardEls = {};
SERVICES.forEach((key) => {
  cardEls[key] = {
    value: document.getElementById(`card-${key}-value`),
    report: document.getElementById(`tile-${key}-report`),
    ring: document.getElementById(`ring-${key}`),
    badge: document.getElementById(`badge-${key}`),
    share: document.getElementById(`share-${key}`),
    trend: document.getElementById(`trend-${key}`),
    updated: document.getElementById(`updated-${key}`),
    distCount: document.getElementById(`dist-count-${key}`),
  };
});

// ---------- Hero / health / distribution elements ----------

const heroRing = document.getElementById('heroRing');
const heroTotalValue = document.getElementById('heroTotalValue');
const heroHeadline = document.getElementById('heroHeadline');
const heroDeltaPill = document.getElementById('heroDeltaPill');
const heroStatusBadge = document.getElementById('heroStatusBadge');
const heroLastUpdated = document.getElementById('heroLastUpdated');

const healthIcon = document.getElementById('healthIcon');
const healthHeadline = document.getElementById('healthHeadline');
const healthSub = document.getElementById('healthSub');
const healthFooter = document.getElementById('healthFooter');

const distDonut = document.getElementById('distDonut');
const distTotalValue = document.getElementById('distTotalValue');

const statusBarHealthy = document.getElementById('statusBarHealthy');
const statusBarWarning = document.getElementById('statusBarWarning');
const statusBarCritical = document.getElementById('statusBarCritical');
const countHealthy = document.getElementById('count-healthy');
const countWarning = document.getElementById('count-warning');
const countCritical = document.getElementById('count-critical');

const RING_GAUGE_MAX = 20;
const WARNING_THRESHOLD = 1;
const CRITICAL_THRESHOLD = 4;

let previousCounts = null;
let previousTotal = null;

function ringPct(count) {
  return Math.max(0, 1 - Math.min(count, RING_GAUGE_MAX) / RING_GAUGE_MAX);
}

function classifyQueue(count) {
  if (count >= CRITICAL_THRESHOLD) return 'critical';
  if (count >= WARNING_THRESHOLD) return 'warning';
  return 'healthy';
}

function trendLabel(current, previous) {
  if (previous === null || current === previous) return 'No change';
  return current > previous ? `Up from ${previous}` : `Down from ${previous}`;
}

function formatTime(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = date.toLocaleString(undefined, { month: 'short' });
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${month}, ${hours}:${minutes}`;
}

// ---------- Ticket cards ----------

function updateCard(key, count) {
  const el = cardEls[key];
  el.value.textContent = count;
  el.value.classList.remove('is-loading');
}

function updateCardExtras(key, count, total, checkedAt) {
  const el = cardEls[key];
  const status = classifyQueue(count);

  el.ring.style.setProperty('--pct', ringPct(count));
  el.badge.textContent = status === 'healthy' ? 'All clear' : status === 'warning' ? 'Attention' : 'Critical';
  el.badge.className = `tcard-status-badge is-${status === 'healthy' ? 'good' : status}`;

  el.share.textContent = total > 0 ? `${Math.round((count / total) * 100)}%` : '—';
  el.trend.textContent = trendLabel(count, previousCounts ? previousCounts[key] : null);
  el.updated.textContent = `Updated ${checkedAt}`;
  if (el.distCount) el.distCount.textContent = count;
}

function updateHero(counts, checkedAt) {
  const total = SERVICES.reduce((sum, key) => sum + counts[key], 0);
  const status = SERVICES.reduce((worst, key) => {
    const s = classifyQueue(counts[key]);
    const rank = { healthy: 0, warning: 1, critical: 2 };
    return rank[s] > rank[worst] ? s : worst;
  }, 'healthy');

  heroRing.style.setProperty('--pct', ringPct(total));
  heroTotalValue.textContent = total;
  heroHeadline.textContent = total === 0 ? 'All systems clear' : `${total} Ticket${total === 1 ? '' : 's'} Open`;

  heroDeltaPill.innerHTML = previousTotal === null || total === previousTotal
    ? '<span aria-hidden="true">&rarr;</span> No change vs last check'
    : total > previousTotal
      ? `<span aria-hidden="true">&uarr;</span> ${total - previousTotal} more than last check`
      : `<span aria-hidden="true">&darr;</span> ${previousTotal - total} fewer than last check`;

  const badgeClass = status === 'healthy' ? 'good' : status;
  const badgeText = status === 'healthy' ? 'All systems clear' : status === 'warning' ? 'Needs attention' : 'Critical issues';
  heroStatusBadge.className = `hero-status-badge is-${badgeClass}`;
  heroStatusBadge.innerHTML = `<span class="hero-status-dot" aria-hidden="true"></span> ${badgeText}`;

  heroLastUpdated.textContent = checkedAt;

  return { total, status };
}

function updateHealth(counts, status, checkedAt) {
  const healthyCount = SERVICES.filter((key) => classifyQueue(counts[key]) === 'healthy').length;

  healthIcon.className = `health-icon is-${status === 'healthy' ? 'good' : status}`;
  if (status === 'healthy') {
    healthHeadline.textContent = 'All Systems Operational';
    healthSub.textContent = 'No open incidents across AA, AE, or gStore queues.';
  } else {
    const flagged = SERVICES.filter((key) => classifyQueue(counts[key]) !== 'healthy').map((key) => SERVICE_LABEL[key]);
    healthHeadline.textContent = status === 'critical' ? 'Attention Required' : 'Minor Issues Detected';
    healthSub.textContent = `${flagged.join(', ')} queue${flagged.length === 1 ? '' : 's'} need review.`;
  }
  healthFooter.textContent = `${healthyCount}/${SERVICES.length} queues clear · Checked ${checkedAt}`;
}

function updateDistribution(counts, total) {
  SERVICES.forEach((key) => {
    distDonut.style.setProperty(`--pct-${key}`, total > 0 ? counts[key] / total : 0);
  });
  distTotalValue.textContent = total;
}

function updateStatusBreakdown(counts) {
  const tally = { healthy: 0, warning: 0, critical: 0 };
  SERVICES.forEach((key) => tally[classifyQueue(counts[key])]++);

  const denom = SERVICES.length;
  statusBarHealthy.style.width = `${(tally.healthy / denom) * 100}%`;
  statusBarWarning.style.width = `${(tally.warning / denom) * 100}%`;
  statusBarCritical.style.width = `${(tally.critical / denom) * 100}%`;

  countHealthy.textContent = tally.healthy;
  countWarning.textContent = tally.warning;
  countCritical.textContent = tally.critical;
}

function countByService(rows) {
  const counts = { aa: 0, ae: 0, gstore: 0 };
  rows.forEach((row) => {
    if (row.__service in counts) counts[row.__service]++;
  });
  return counts;
}

function setReportLink(el, url) {
  if (!url) return;
  el.href = url;
  el.hidden = false;
}

// ---------- Cases table ----------

function isUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

const JOIN_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="2.5" y="6" width="13" height="12" rx="2.2" stroke="currentColor" stroke-width="1.8"/>
  <path d="M15.5 10.2 21 7v10l-5.5-3.2" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`;

function renderCell(field, value, row) {
  const td = document.createElement('td');

  if (value === null || value === undefined || value === '') {
    td.classList.add('cell-muted');
    td.textContent = '–';
    return td;
  }

  if (isUrl(value)) {
    td.innerHTML = `<a class="join-btn" href="${value}" target="_blank" rel="noopener noreferrer">${JOIN_ICON}Join</a>`;
    return td;
  }

  if (field === '__service') {
    const pill = document.createElement('span');
    pill.className = 'category-pill';
    pill.style.setProperty('--cat-color', SERVICE_COLOR[value]);
    pill.textContent = SERVICE_LABEL[value];
    td.appendChild(pill);
    return td;
  }

  if (field === 'Category__c') {
    const pill = document.createElement('span');
    pill.className = 'category-pill';
    pill.style.setProperty('--cat-color', colorForCategory(String(value)));
    pill.textContent = value;
    td.appendChild(pill);
    return td;
  }

  if (/CaseNumber$/.test(field)) {
    td.classList.add('case-number');
    if (row?.__caseUrl) {
      const link = document.createElement('a');
      link.className = 'case-number-link';
      link.href = row.__caseUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = value;
      td.appendChild(link);
    } else {
      td.textContent = value;
    }
    return td;
  }

  if (/time|aging|duration/i.test(field)) {
    td.classList.add('col-mono');
    td.textContent = value;
    return td;
  }

  td.textContent = value;
  return td;
}

function renderCases(cases) {
  casesHead.innerHTML = '';
  casesBody.innerHTML = '';

  const headRow = document.createElement('tr');
  cases.columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col.label;
    headRow.appendChild(th);
  });
  casesHead.appendChild(headRow);

  cases.rows.forEach((row) => {
    const tr = document.createElement('tr');
    cases.columns.forEach((col) => {
      tr.appendChild(renderCell(col.field, row[col.field], row));
    });
    casesBody.appendChild(tr);
  });

  casesCount.textContent = `${cases.size} item${cases.size === 1 ? '' : 's'}`;
  const empty = cases.rows.length === 0;
  casesTable.hidden = empty;
  casesEmpty.hidden = !empty;
}

// ---------- Main load ----------

let refreshTimer = null;

async function loadDashboard() {
  refreshIcon.classList.add('spinning');
  refreshBtn.disabled = true;
  try {
    const res = await fetch('/api/dashboard', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    const counts = countByService(data.cases.rows);
    SERVICES.forEach((key) => updateCard(key, counts[key]));
    setReportLink(cardEls.aa.report, data.reportUrls?.aa);
    setReportLink(cardEls.ae.report, data.reportUrls?.ae);
    setReportLink(cardEls.gstore.report, data.reportUrls?.gstore);

    renderCases(data.cases);

    const checkedAt = formatTime(new Date());
    const { total, status } = updateHero(counts, checkedAt);
    SERVICES.forEach((key) => updateCardExtras(key, counts[key], total, checkedAt));
    updateHealth(counts, status, checkedAt);
    updateDistribution(counts, total);
    updateStatusBreakdown(counts);
    previousCounts = counts;
    previousTotal = total;

    errorBanner.hidden = true;
  } catch (err) {
    errorText.textContent = `Couldn't refresh: ${err.message}`;
    errorBanner.hidden = false;
  } finally {
    refreshIcon.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

function scheduleAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDashboard, REFRESH_INTERVAL_MS);
}

refreshBtn.addEventListener('click', () => {
  loadDashboard();
});

loadDashboard();
scheduleAutoRefresh();
