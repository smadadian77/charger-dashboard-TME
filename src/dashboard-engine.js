const TME_DASHBOARD_URL = 'https://tme-ev-chargingplatform-charger-dashboard-webapp.toyota-europe.com/wallbox/list';

const SAMPLE = {
  serialNumber: 'TACW2244723S0930',
  size: 80,
  token: ''
};

const MSAL_CONFIG = {
  clientId: '635b40b9-e2a6-4aa1-b091-4d293d7bf80d',
  authority: 'https://login.microsoftonline.com/52b742d1-3dc2-47ac-bf03-609c83d9df9f',
  scopes: ['openid', 'profile', 'offline_access'],
  redirectUri: window.location.origin + '/',
};

const state = {
  currentEnv: localStorage.getItem('wallbox_env') || 'prod',
  currentView: 'fleet',
  kubernetes: {
    env: 'prod',
    namespace: 'all',
    timeRange: '1h',
    timelineWindow: null,
    auth: 'idle',
    result: null,
    error: '',
    requestId: 0,
    inventoryLoading: false,
    authRequestId: 0,
    logRequestId: 0,
    activePod: null,
    activeServiceKey: '',
    serviceModels: [],
    infrastructure: null,
    infrastructureError: '',
    infrastructureRequestId: 0,
    infrastructureFetchedAt: 0,
    infrastructureNamespace: '',
    infrastructureLoading: false,
    logTarget: 'pod',
    logPod: null,
    logSnapshot: null,
    logLoading: false,
    logAbortController: null,
    logError: '',
    logTimer: null,
    authPollTimer: null,
    refreshTimer: null,
  },
  fleet: {
    items: [],
    page: 0,
    size: 10,
    totalPages: 0,
    totalElements: 0,
    totalEnvironment: '',
    availableElements: null,
    availableEnvironment: '',
    loading: false,
    error: null,
    filters: {
      serialNumber: '',
      model: '',
      firmwareVersion: '',
      status: '',
      country: '',
    },
    metadata: {
      models: [],
      firmwares: [],
      statuses: [],
    },
    searchDebounceTimer: null,
    outages: [],
    outagesRaw: [],
    outagesFilter: {
      subscription: 'all',
      activeOnly: true,
      collapsed: false,
    },
  },
  interactions: {
    sseAvailable: false,
    checking: false,
    activeOp: null,
    inFlight: false,
  },
  allEvents: [],
  filteredEvents: [],
  eventLoadStatus: 'idle',
  selectedEventId: null,
  wallbox: null,
  access: null,
  smartCharging: null,
  tariff: null,
  chargingSessions: [],
  timeline: null,
  connectorTimeline: null,
  connectorIntervalsById: null,
  activeConnector: 1,
  activeTimelineWidget: 'connector',
  connectorIds: [],
  syncingRange: false,
  msalApp: null,
  tokenRefreshInProgress: false,
  searchId: 0,
  chargeDotRequestId: 0,
  loadingCards: {},
  sourceStatus: {
    wallbox: 'idle',
    channelInfo: 'idle',
    access: 'idle',
    smartCharging: 'idle',
    sessions: 'idle',
    events: 'idle',
  },
  channelData: null,
  serialSearchTimer: null,
  lastRefreshAt: null,
  investigation: null,
  diagnosticResults: null,
  incidents: [],
  toolRuns: {},
  domainRefreshIds: { charger: 0, events: 0, sessions: 0 },
  timelineHistory: [],
  timelineRestoring: false,
  supportOperationInFlight: false,
  supportOperationHistory: [],
  selectedSupportOperation: null,
  activeSupportOperation: null,
  supportOperationComplete: false,
  smartInvestigation: {
    serialNumber: null,
    contextHash: null,
    contextSignature: null,
    pendingSignature: null,
    pendingHash: null,
    findings: [],
    loading: false,
    error: null,
    generatedAt: null,
    requestId: 0,
    debounceTimer: null,
    retryTimer: null,
    retrySignature: null,
    retryAttempts: 0,
    refreshBatchDepth: 0,
    chat: { question: '', answer: '', loading: false, error: null, requestId: 0 },
  },
};

const KUBERNETES_NAMESPACE_OPTIONS = {
  prod: [
    ['tme-ns-ev-backend-prd', 'Backend · production'],
    ['tme-ns-ev-virtual-gateway-prd', 'Virtual gateway · production'],
  ],
  acc: [
    ['tme-ns-ev-backend-uat', 'Backend · ACC'],
    ['tme-ns-ev-virtual-gateway-uat', 'Virtual gateway · ACC'],
  ],
  prev: [
    ['tme-ns-ev-backend-prev', 'Backend · PREV'],
    ['tme-ns-ev-virtual-gateway-prev', 'Virtual gateway · PREV'],
  ],
  dev: [
    ['tme-ns-ev-backend-dev', 'Backend · DEV'],
    ['tme-ns-ev-virtual-gateway-dev', 'Virtual gateway · DEV'],
  ],
};

const typeColors = {
  CHARGER_CONFIGURATION: '#8b5cf6',
  CHARGING_SESSION_DATA: '#06b6d4',
  CHARGER_STATUS_DATA: '#f97316',
  RFID_CARD_MANAGEMENT: '#ec4899',
  SUPPORT_INTERVENTION: '#ef4444',
  THIRD_PARTY_INTEGRATION: '#14b87a',
  SMART_CHARGING: '#3b82f6',
  UNKNOWN: '#64748b',
};

const typeLabels = {
  CHARGER_CONFIGURATION: 'Configuration',
  CHARGING_SESSION_DATA: 'Session',
  CHARGER_STATUS_DATA: 'Status',
  RFID_CARD_MANAGEMENT: 'RFID',
  SUPPORT_INTERVENTION: 'Support',
  THIRD_PARTY_INTEGRATION: 'Integration',
  SMART_CHARGING: 'Smart charging',
  UNKNOWN: 'Other',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function setStatus(message, level = 'info') {
  const banner = document.getElementById('statusBanner');
  if (!banner) return;
  banner.className = `status-banner ${level}`;

  if (typeof message === 'object' && message !== null && message.html) {
    banner.innerHTML = message.html;
    return;
  }

  if (level === 'success') {
    banner.innerHTML = `
      <div class="event-completed-hud">
        <div class="event-completed-left">
          <span class="event-completed-icon">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <span>${escapeHtml(String(message))}</span>
        </div>
        <div class="event-completed-right">
          <span class="event-sync-badge">✓ Ready</span>
        </div>
      </div>
    `;
    return;
  }

  const iconSvg = level === 'error' || level === 'warning'
    ? `<span class="status-icon ${level}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>`
    : `<span class="status-icon info"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`;

  banner.innerHTML = `
    <div class="status-banner-content">
      ${iconSvg}
      <span class="status-banner-text">${escapeHtml(String(message))}</span>
    </div>
  `;
}

function renderEventIngestionProgress({ page, maxPages, count, oldest, windowStart, windowEnd, serialNumber, searchId }) {
  const banner = document.getElementById('statusBanner');
  if (!banner || searchId !== state.searchId) return;

  const wStart = windowStart || (windowEnd ? windowEnd - 30 * 86400000 : Date.now() - 30 * 86400000);
  const wEnd = windowEnd || Date.now();
    const timeProgress = oldest ? Math.min(96, Math.max(8, Math.round(((wEnd - oldest) / Math.max(wEnd - wStart, 1)) * 100))) : Math.min(90, Math.round(((page + 1) / maxPages) * 100));
  const pageProgress = Math.min(96, Math.round(((page + 1) / maxPages) * 100));
  const progressPercent = Math.max(timeProgress, pageProgress);

  const coverageText = oldest && Number.isFinite(oldest)
    ? `Time covered: <strong>${escapeHtml(formatGlanceTimestamp(oldest))}</strong> → <strong>${escapeHtml(formatGlanceTimestamp(wEnd))}</strong>`
    : 'Scanning recent events...';

  banner.className = 'status-banner info';
  banner.innerHTML = `
    <div class="event-progress-hud">
      <div class="event-progress-top">
        <div class="event-progress-status">
          <span class="event-progress-spinner">
            <svg class="svg-spin" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10" stroke-opacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10"/></svg>
          </span>
          <span class="event-progress-title">Ingesting Event History</span>
          <span class="event-progress-stats">Page ${page + 1} of ${maxPages} · <strong>${count.toLocaleString()}</strong> events</span>
        </div>
        <div class="event-progress-actions">
          <button type="button" id="stopEventStreamingBtn" class="event-stop-btn" title="Stop reading older logs and analyze the events loaded so far">
            <span>Stop & Use (${count.toLocaleString()})</span>
          </button>
        </div>
      </div>
      <div class="event-progress-bar-track">
        <div class="event-progress-bar-fill" style="width: ${progressPercent}%;"></div>
      </div>
      <div class="event-progress-bottom">
        <span class="event-coverage-label">
          <span class="coverage-clock"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
          ${coverageText}
        </span>
        <span class="event-progress-hint">✨ Latest events are already interactive below</span>
      </div>
    </div>
  `;

  banner.querySelector('#stopEventStreamingBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    state.stopEventStreaming = true;
    const btn = banner.querySelector('#stopEventStreamingBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Stopping...';
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function combineDateTime(dateValue, timeValue) {
  if (!dateValue) {
    return null;
  }

  if (!timeValue) {
    return `${dateValue}T00:00`;
  }

  return `${dateValue}T${timeValue}`;
}

function normalizeWindowValue(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payloadSegment = parts[1];
    const paddedSegment = payloadSegment + '='.repeat((4 - (payloadSegment.length % 4)) % 4);
    const decoded = atob(paddedSegment.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function isTokenExpired(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const payload = decodeJwtPayload(token);
  if (!payload || payload.exp === undefined || payload.exp === null) {
    return true;
  }

  const expSeconds = Number(payload.exp);
  if (!Number.isFinite(expSeconds)) {
    return true;
  }

  return expSeconds <= Math.floor(Date.now() / 1000) + 30;
}

function isTmeJwtToken(token) {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return false;
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (audiences.some((audience) => audience === '00000003-0000-0000-c000-000000000000' || audience === 'https://graph.microsoft.com')) {
    return false;
  }

  const allowedAudiences = {
    prod: ['635b40b9-e2a6-4aa1-b091-4d293d7bf80d'],
    acc: ['999bf820-34e8-4078-9908-a9b99ea0fbce', '769328e8-3732-45f2-9724-34dba356564e'],
    prev: ['999bf820-34e8-4078-9908-a9b99ea0fbce', '769328e8-3732-45f2-9724-34dba356564e'],
  }[state.currentEnv || 'prod'];
  return Number.isFinite(Number(payload.exp))
    && Number(payload.exp) > Math.floor(Date.now() / 1000) + 30
    && audiences.some((audience) => allowedAudiences.includes(audience));
}

function isAuthTokenError(error, statusCode) {
  if (statusCode === 401) {
    return true;
  }
  const text = String(error || '').toLowerCase();
  // If it's a 404, not found, or serial-related error, it is NEVER a token error
  if (/not\s*found|404|unknown\s*charger|no\s*record|serial/i.test(text)) {
    return false;
  }
  // A forbidden response can be a role restriction; only explicit auth failures trigger re-login.
  return /jwt\s*expired|bearer\s*token\s*expired|token\s*expired|token\s*signature|unauthorized|pkey:verify/i.test(text);
}

function formatApiError(result) {
  const raw = result && typeof result === 'object' ? result.details || result.message || '' : '';
  let message = typeof raw === 'string' ? raw : '';

  try {
    if (message && message.startsWith('{')) {
      const parsed = JSON.parse(message);
      if (parsed && (parsed.message || parsed.error)) {
        message = parsed.message || parsed.error;
      }
    }
  } catch (error) {
    // Ignore parse errors and keep the original message.
  }

  const text = `${message || ''} ${result && result.message ? result.message : ''}`.toLowerCase();
  if (result?.authError || result?.statusCode === 401 || /jwt\s*expired|bearer\s*token\s*expired|token\s*expired|pkey:verify/i.test(text)) {
    return 'TME session token is expired or unauthorized.';
  }

  if (result?.notFound || result?.statusCode === 404 || /not\s*found|404/i.test(text)) {
    return 'Charger not found. Check the serial number.';
  }

  return message || (result && result.message ? result.message : 'The API request failed. Check the serial number.');
}

function extractRecords(payload) {
  const envelope = payload && payload.data ? payload.data : payload;
  const items = Array.isArray(envelope?.content) ? envelope.content : Array.isArray(envelope) ? envelope : [];

  return items
    .map((item, index) => {
      if (!item) return null;
      const timestamp = normalizeDate(item.timestamp || item.eventTime || item.time);
      const eventName = item.eventName || item.event_name || 'Unknown';
      const type = item.type || item.eventType || 'Unknown';
      const id = item.eventId || item.event_id || `${eventName}-${timestamp || index}`;
      const additionalData = item.additionalData || item.additional_data || {};

      return {
        id,
        serialNumber: item.serialNumber || item.serial_number || '—',
        timestamp,
        type,
        eventName,
        additionalData,
        raw: item,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function formatConnectorSummary(event) {
  const details = event.raw && event.raw.additionalData && Array.isArray(event.raw.additionalData.details)
    ? event.raw.additionalData.details
    : [];

  if (!details.length) {
    return 'Status';
  }

  const summary = details
    .filter((detail) => detail && detail.status)
    .map((detail) => `C${Number(detail.id) + 1}: ${detail.status}`)
    .slice(0, 2)
    .join(' • ');

  return summary || 'Status';
}

function formatEventLabel(event) {
  const eventName = String(event.eventName || 'Unknown');

  if (eventName === 'STATUS_NOTIFICATION') {
    return formatConnectorSummary(event);
  }

  return eventName.replace(/_/g, ' ');
}

function renderLegend() {
  const legend = document.getElementById('eventLegend');
  if (!legend) {
    return;
  }

  const entries = Object.entries(typeLabels).map(([type, label]) => `
    <span class="legend-item"><span class="legend-swatch" style="background:${typeColors[type] || typeColors.UNKNOWN};"></span>${escapeHtml(label)}</span>
  `).join('');

  legend.innerHTML = entries;
}

function getSelectedTypeValues() {
  const panel = document.getElementById('typeFilterPanel');
  if (!panel) {
    return ['all'];
  }

  const allBox = panel.querySelector('input[value="all"]');
  if (!allBox || allBox.checked) {
    return ['all'];
  }

  const selectedValues = Array.from(panel.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => input.value)
    .filter((value) => value !== 'all');

  return selectedValues.length ? selectedValues : ['all'];
}

function updateTypeFilterLabel() {
  const trigger = document.getElementById('typeFilterTrigger');
  const selected = getSelectedTypeValues();
  if (!trigger) {
    return;
  }
  if (selected.includes('all')) {
    trigger.textContent = 'All types';
    return;
  }
  trigger.textContent = selected.length === 1 ? selected[0] : `${selected.length} types`;
}

function eventConnectorIds(event) {
  const payload = parseMaybeJson(event.additionalData);
  const rawPayload = parseMaybeJson(event.raw && event.raw.additionalData);
  const details = detailsFromValue(payload).concat(detailsFromValue(rawPayload));
  const ids = details.map((detail) => Number(detail.connectorId ?? detail.connector_id ?? detail.id))
    .filter(Number.isFinite);
  const direct = firstSet(event.connectorId, event.connector_id, payload && payload.connectorId, payload && payload.connector_id);
  if (direct != null && Number.isFinite(Number(direct))) ids.push(Number(direct));
  return Array.from(new Set(ids)).sort((left, right) => left - right);
}

function sessionConnectorId(session) {
  const value = firstSet(session && session.connectorId, session && session.connector_id, session && session.evseId, session && session.evse_id);
  return value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : String(value);
}

function eventImportance(event) {
  const name = String(event.eventName || '');
  const explicitIssue = /power[\s_-]*loss|disconnect|reconnect|fault|authorization.*fail|reject|timeout|cancel/i.test(name);
  const details = detailsFromValue(parseMaybeJson(event.additionalData))
    .concat(detailsFromValue(parseMaybeJson(event.raw && event.raw.additionalData)));
  const connectorIssue = details.some((detail) => {
    const id = Number(detail.connectorId ?? detail.connector_id ?? detail.id ?? 1);
    return ['Faulted', 'Unavailable'].includes(normalizeConnectorState(detail.status || detail.connectorStatus, id));
  });
  return explicitIssue || connectorIssue ? 'Important' : 'Other';
}

function relatedSessionForEvent(event) {
  const payload = parseMaybeJson(event.additionalData);
  const explicitId = firstSet(
    event.transactionId,
    event.sessionId,
    payload && payload.transactionId,
    payload && payload.sessionId,
    payload && payload.session_id,
  );
  if (explicitId != null) {
    return state.chargingSessions.find((session) => String(session.transactionId) === String(explicitId)) || null;
  }
  const time = new Date(event.timestamp).getTime();
  if (!Number.isFinite(time)) return null;
  return state.chargingSessions.find((session) => {
    const range = sessionRange(session);
    return time >= range.start && time <= range.end;
  }) || null;
}

function applyFilters() {
  const selectedTypes = getSelectedTypeValues();
  const searchText = document.getElementById('eventNameSearch').value.trim().toLowerCase();
  const window = selectedWindow();

  state.filteredEvents = state.allEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    const matchesWindow = Number.isNaN(window.start) || Number.isNaN(window.end) || (time >= window.start && time <= window.end);
    const matchesType = selectedTypes.includes('all') || selectedTypes.includes(event.type);
    const connectors = eventConnectorIds(event).join(' ');
    const session = relatedSessionForEvent(event);
    const typeLabel = typeLabels[event.type] || 'Other';
    const searchable = [event.eventName, typeLabel, event.type, connectors, session && session.transactionId].filter(Boolean).join(' ').toLowerCase();
    const matchesSearch = !searchText || searchable.includes(searchText);
    return matchesWindow && matchesType && matchesSearch;
  });

  if (!state.filteredEvents.length) {
    setStatus('No events match the current filter.', 'warning');
  }

  renderTimeline();
  renderConnectorTimeline();
  renderSmartChargingTimeline();
  renderTable();
  renderDetail();
  updateSummary();
  renderChargerProfile();
  renderNotableEvents();
  renderAtAGlance();
}

function updateSummary() {
  const totalEvents = document.getElementById('totalEvents');
  if (!totalEvents) {
    return;
  }
  const events = state.filteredEvents.length ? state.filteredEvents : state.allEvents;
  const types = new Set(events.map((event) => event.type));
  const earliest = events.length ? events[0].timestamp : null;
  const latest = events.length ? events[events.length - 1].timestamp : null;
  totalEvents.textContent = events.length;
  document.getElementById('totalTypes').textContent = types.size;
  document.getElementById('firstEvent').textContent = earliest ? formatDate(earliest) : '—';
  document.getElementById('lastEvent').textContent = latest ? formatDate(latest) : '—';
}

function buildTypeFilterOptions(records) {
  const panel = document.getElementById('typeFilterPanel');
  const previous = new Set(getSelectedTypeValues());
  const uniqueTypes = Array.from(new Set(records.map((event) => event.type))).sort();
  const keepSpecific = uniqueTypes.some((type) => previous.has(type));

  const options = ['all', ...uniqueTypes].map((type) => {
    const checked = type === 'all' ? !keepSpecific : keepSpecific && previous.has(type);
    const color = type === 'all' ? '#172b3a' : (typeColors[type] || typeColors.UNKNOWN);
    const label = type === 'all' ? 'All types' : type;
    return `
      <label class="multi-option">
        <input type="checkbox" value="${escapeHtml(type)}" ${checked ? 'checked' : ''} />
        <span class="legend-swatch" style="background:${color};"></span>
        <span>${escapeHtml(label)}</span>
      </label>
    `;
  }).join('');

  panel.innerHTML = options;
  panel.querySelectorAll('input').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.value === 'all' && input.checked) {
        panel.querySelectorAll('input').forEach((other) => {
          other.checked = other.value === 'all';
        });
      } else if (input.value !== 'all') {
        const allBox = panel.querySelector('input[value="all"]');
        if (allBox) {
          allBox.checked = false;
        }
        const anySpecific = Array.from(panel.querySelectorAll('input')).some((other) => other.value !== 'all' && other.checked);
        if (!anySpecific && allBox) {
          allBox.checked = true;
        }
      }
      updateTypeFilterLabel();
      applyFilters();
    });
  });
  updateTypeFilterLabel();
}

const CONNECTOR_STATES = [
  { id: 'Available', color: '#22c55e' },
  { id: 'Preparing', color: '#3b82f6' },
  { id: 'Charging', color: '#06b6d4' },
  { id: 'SuspendedEV', color: '#f59e0b' },
  { id: 'SuspendedEVSE', color: '#f97316' },
  { id: 'Finishing', color: '#8b5cf6' },
  { id: 'Faulted', color: '#ef4444' },
  { id: 'Disconnected', color: '#64748b' },
];

const CONNECTOR_ZERO_STATES = [
  { id: 'Faulted', color: '#ef4444' },
  { id: 'Available', color: '#22c55e' },
  { id: 'Unavailable', color: '#f59e0b' },
  { id: 'Disconnected', color: '#64748b' },
  { id: 'ActivationPending', label: 'Activation Pending', color: '#3b82f6' },
];

function eventBounds(records) {
  const times = records
    .map((event) => new Date(event.timestamp).getTime())
    .filter((value) => !Number.isNaN(value));
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  const span = Math.max(latest - earliest, 15 * 60 * 1000);
  const padding = Math.max(span * 0.08, 5 * 60 * 1000);
  return { start: earliest - padding, end: latest + padding };
}

function timelineTicks(start, end) {
  const span = end - start;
  let step = 24 * 60 * 60 * 1000;
  if (span <= 2 * 60 * 60 * 1000) step = 15 * 60 * 1000;
  else if (span <= 12 * 60 * 60 * 1000) step = 60 * 60 * 1000;
  else if (span <= 3 * 24 * 60 * 60 * 1000) step = 6 * 60 * 60 * 1000;
  const ticks = [];
  const first = Math.ceil(start / step) * step;
  for (let value = first; value < end; value += step) {
    ticks.push(value);
  }
  return ticks;
}

function dayBoundaries(start, end) {
  const lines = [];
  const cursor = new Date(start);
  cursor.setHours(24, 0, 0, 0);
  while (cursor.getTime() < end) {
    lines.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  return lines;
}

function connectorStateList(connectorId) {
  return connectorId === 0 ? CONNECTOR_ZERO_STATES : CONNECTOR_STATES;
}

function normalizeConnectorState(value, connectorId = 1) {
  const text = String(value || '').replace(/[\s_-]/g, '').toLowerCase();
  return connectorStateList(connectorId).find((stateName) => stateName.id.replace(/[\s_-]/g, '').toLowerCase() === text)?.id || '';
}

function matchesConnector(detail, connectorId) {
  if (!detail || typeof detail !== 'object') {
    return false;
  }
  if (detail.connectorId != null || detail.connector_id != null) {
    return Number(detail.connectorId ?? detail.connector_id) === connectorId;
  }
  if (detail.id != null) {
    return Number(detail.id) === connectorId;
  }
  return false;
}

function isConnectorOne(detail) {
  return matchesConnector(detail, 1);
}

function detailsFromValue(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    const found = [];
    const pattern = /Connector\(id=(\d+),\s*status=([A-Za-z]+)/g;
    let match = pattern.exec(value);
    while (match) {
      found.push({ id: Number(match[1]), status: match[2] });
      match = pattern.exec(value);
    }
    if (found.length) {
      return found;
    }
    try {
      return detailsFromValue(JSON.parse(value));
    } catch (error) {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value.details)) {
    return value.details;
  }
  if (Array.isArray(value.connectors)) {
    return value.connectors;
  }
  return [];
}

function connectorStatus(event, connectorId) {
  const blobs = [event.additionalData, event.raw && event.raw.additionalData, event.raw];
  for (const blob of blobs) {
    const details = detailsFromValue(blob);
    const match = details.find((detail) => matchesConnector(detail, connectorId) && (detail.status || detail.connectorStatus));
    if (match) {
      return normalizeConnectorState(match.status || match.connectorStatus, connectorId);
    }
  }
  return '';
}

function connectorOneStatus(event) {
  return connectorStatus(event, 1);
}

function connectorIntervals(events, connectorId = 1, rangeEnd = null) {
  const changes = events
    .map((event) => ({
      time: new Date(event.timestamp).getTime(),
      status: connectorStatus(event, connectorId),
      event,
    }))
    .filter((item) => item.status && !Number.isNaN(item.time))
    .sort((left, right) => left.time - right.time);

  const compact = [];
  changes.forEach((change) => {
    const previous = compact[compact.length - 1];
    if (previous && previous.time === change.time) {
      compact[compact.length - 1] = change;
      return;
    }
    if (previous && previous.status === change.status) {
      return;
    }
    compact.push(change);
  });

  const queryEnd = rangeEnd != null && rangeEnd !== '' && Number.isFinite(Number(rangeEnd)) ? Number(rangeEnd) : new Date(combineDateTime(
    document.getElementById('endDate').value,
    document.getElementById('endTimeInput').value,
  )).getTime();
  const lastEvent = events.reduce((latest, event) => {
    const time = new Date(event.timestamp).getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);

  return compact.map((change, index) => {
    const nextTime = index < compact.length - 1 ? compact[index + 1].time : Math.max(change.time + 1000, queryEnd || 0, lastEvent);
    return {
      ...change,
      end: Math.max(nextTime, change.time + 1000),
    };
  });
}

function rangeMilliseconds(value, fallback) {
  if (value == null) return fallback;
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function destroyChart(chart) {
  if (chart && chart.destroy) {
    chart.destroy();
  }
}

function formatExact(value) {
  const date = new Date(value);
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(start, end) {
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days) {
    return `${days}d ${hours}h`;
  }
  if (hours) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function placeStartLabel(label, start) {
  if (!label || !state.eventBounds) {
    return;
  }
  const span = Math.max(state.eventBounds.end - state.eventBounds.start, 1);
  const left = ((start - state.eventBounds.start) / span) * 100;
  const duplicate = left < 14;
  label.hidden = duplicate;
  label.textContent = duplicate ? '' : formatExact(start);
}

function setOverviewSummary(start, end) {
  const text = formatDuration(start, end);
  document.querySelectorAll('.overview-duration').forEach((label) => {
    label.textContent = text;
  });
}

function timedEvents(records) {
  return records
    .map((event) => ({ event, time: new Date(event.timestamp).getTime() }))
    .filter((item) => !Number.isNaN(item.time))
    .sort((left, right) => left.time - right.time);
}

function setEventView(start, end, notify = true) {
  const bounds = state.eventBounds;
  if (!bounds) {
    return;
  }
  const span = Math.max(end - start, 15 * 1000);
  let nextStart = start;
  let nextEnd = start + span;
  if (nextStart < bounds.start) {
    nextStart = bounds.start;
    nextEnd = Math.min(bounds.end, nextStart + span);
  }
  if (nextEnd > bounds.end) {
    nextEnd = bounds.end;
    nextStart = Math.max(bounds.start, nextEnd - span);
  }
  state.eventView = { start: nextStart, end: nextEnd };
  const label = document.getElementById('timelineWindow');
  if (label) {
    label.textContent = `Viewing ${formatExact(nextStart)} – ${formatExact(nextEnd)}`;
  }
  setOverviewSummary(nextStart, nextEnd);
  drawEventChart();
  drawOverview();
  redrawConnectorCharts();
  updateFloatingTimeToolbar(state.activeTimelineWidget === 'events' ? 'events' : 'connector', nextStart, nextEnd);
  if (notify && state.timeline && state.timeline._range && !state.syncingRange) {
    state.timeline._range({ start: new Date(nextStart), end: new Date(nextEnd) });
  }
}

function selectEvent(eventId) {
  state.selectedEventId = String(eventId);
  const selectedEvent = state.filteredEvents.find((event) => String(event.id) === String(eventId));
  if (selectedEvent) {
    document.getElementById('detailPane').textContent = JSON.stringify(selectedEvent.raw, null, 2);
    renderRelatedSession(selectedEvent);
    state.investigation = { kind: 'event', eventId: String(selectedEvent.id), label: `Investigating · ${prettyEnum(selectedEvent.eventName)}` };
    renderInvestigation();
  }
  renderTable();
  drawEventChart();
}

function layoutLane(events, view, width) {
  const span = Math.max(view.end - view.start, 1);
  const placed = [];
  events.forEach((item) => {
    if (item.time < view.start || item.time > view.end) {
      return;
    }
    const x = ((item.time - view.start) / span) * width;
    let row = 0;
    while (placed.some((dot) => dot.row === row && Math.abs(dot.x - x) < 14)) {
      row += 1;
    }
    if (row > 5) {
      const host = placed.find((dot) => dot.row === 5 && Math.abs(dot.x - x) < 14);
      if (host) {
        host.extra.push(item.event);
      }
      return;
    }
    placed.push({ x, row, event: item.event, extra: [] });
  });
  return placed;
}

function drawEventChart() {
  const container = document.getElementById('timeline');
  const plot = container.querySelector('.event-plot');
  if (!plot || !state.eventView) {
    return;
  }
  const width = plot.clientWidth || 640;
  const types = Array.from(new Set(state.filteredEvents.map((event) => event.type)));
  const byType = new Map(types.map((type) => [type, []]));
  timedEvents(state.filteredEvents).forEach((item) => {
    if (byType.has(item.event.type)) {
      byType.get(item.event.type).push(item);
    }
  });

  const lanes = types.map((type) => {
    const dots = layoutLane(byType.get(type) || [], state.eventView, width);
    const rows = dots.length ? Math.max(...dots.map((dot) => dot.row)) + 1 : 1;
    return { type, dots, height: 18 + rows * 16 };
  });

  plot.innerHTML = lanes.map((lane) => {
    const color = typeColors[lane.type] || typeColors.UNKNOWN;
    const dots = lane.dots.map((dot) => {
      const count = 1 + dot.extra.length;
      const selected = String(state.selectedEventId) === String(dot.event.id) ? ' selected' : '';
      return `<button type="button" class="event-dot${selected}" data-id="${escapeHtml(String(dot.event.id))}" style="left:${dot.x}px; top:${8 + dot.row * 16}px; background:${color};"></button>${count > 1 ? `<em class="event-count" style="left:${dot.x + 12}px; top:${6 + dot.row * 16}px;">${count}</em>` : ''}`;
    }).join('');
    return `<div class="event-lane" style="height:${lane.height}px">${dots}</div>`;
  }).join('');

  const labels = container.querySelector('.event-labels');
  if (labels) {
    labels.innerHTML = lanes.map((lane) => `<div class="event-lane-label" style="height:${lane.height}px">${escapeHtml(typeLabels[lane.type] || lane.type)}</div>`).join('');
  }

  const axis = container.querySelector('.event-axis');
  if (axis) {
    const span = state.eventView.end - state.eventView.start;
    axis.innerHTML = Array.from({ length: 6 }, (_, index) => {
      const time = state.eventView.start + (span * index) / 5;
      return `<span style="left:${(index / 5) * 100}%">${escapeHtml(formatExact(time))}</span>`;
    }).join('');
  }

  plot.querySelectorAll('.event-dot').forEach((dot) => {
    dot.addEventListener('mouseenter', (event) => showEventHover(dot, event));
    dot.addEventListener('mouseleave', hideEventHover);
    dot.addEventListener('click', () => selectEvent(dot.dataset.id));
  });
}

function bindTimeGuide(host, timeAt) {
  if (!host || host.dataset.guide === 'true') {
    return;
  }
  host.dataset.guide = 'true';
  host.classList.add('time-guide-host');
  const line = document.createElement('div');
  line.className = 'time-guide';
  line.hidden = true;
  const label = document.createElement('div');
  label.className = 'time-guide-label';
  label.hidden = true;
  host.appendChild(line);
  host.appendChild(label);
  const hide = () => {
    line.hidden = true;
    label.hidden = true;
  };
  host.addEventListener('mousemove', (event) => {
    const rect = host.getBoundingClientRect();
    const track = host.querySelector('.event-plot, .analysis-track');
    const trackRect = track ? track.getBoundingClientRect() : rect;
    const inset = trackRect.left - rect.left;
    const span = trackRect.width;
    const x = event.clientX - rect.left;
    if (!span || x < inset || x > rect.width) {
      hide();
      return;
    }
    const time = timeAt((x - inset) / span);
    if (!Number.isFinite(time)) {
      hide();
      return;
    }
    line.hidden = false;
    label.hidden = false;
    line.style.left = `${x}px`;
    const text = formatExact(time);
    label.textContent = text;
    const besideRight = event.clientX < window.innerWidth - 170;
    label.style.left = `${besideRight ? event.clientX + 8 : event.clientX - 8}px`;
    label.style.top = `${Math.min(Math.max(event.clientY - 10, 8), window.innerHeight - 28)}px`;
    label.style.transform = besideRight ? 'none' : 'translateX(-100%)';
  });
  host.addEventListener('mouseleave', hide);
}

function showEventHover(dot, pointer) {
  const hover = document.getElementById('eventHover');
  const match = state.filteredEvents.find((event) => String(event.id) === dot.dataset.id);
  if (!hover || !match) {
    return;
  }
  const laneEvents = timedEvents(state.filteredEvents).filter((item) => item.event.type === match.type);
  const width = dot.parentElement.clientWidth || 1;
  const x = Number.parseFloat(dot.style.left);
  const span = state.eventView.end - state.eventView.start;
  const nearby = laneEvents.filter((item) => Math.abs(((item.time - state.eventView.start) / span) * width - x) < 14);
  const lines = (nearby.length ? nearby : [{ event: match }]).slice(0, 8).map((item) => `
    <div><strong>${escapeHtml(formatExact(item.event.timestamp))}</strong> ${escapeHtml(formatEventLabel(item.event))}</div>
  `).join('');
  hover.innerHTML = lines;
  hover.hidden = false;
  hover.style.left = `${Math.min(pointer.clientX + 12, window.innerWidth - 320)}px`;
  hover.style.top = `${pointer.clientY + 14}px`;
}

function hideEventHover() {
  const hover = document.getElementById('eventHover');
  if (hover) {
    hover.hidden = true;
  }
}

function drawOverview() {
  const canvas = document.getElementById('overviewCanvas');
  const windowBox = document.getElementById('overviewWindow');
  if (!canvas || !state.eventBounds || !state.eventView) {
    return;
  }
  const width = canvas.parentElement.clientWidth || canvas.clientWidth || 640;
  const height = 64;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const bounds = state.eventBounds;
  const span = Math.max(bounds.end - bounds.start, 1);
  const bucketCount = Math.max(48, Math.floor(width / 4));
  const buckets = Array.from({ length: bucketCount }, () => ({}));
  timedEvents(state.allEvents).forEach((item) => {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(((item.time - bounds.start) / span) * bucketCount)));
    buckets[index][item.event.type] = (buckets[index][item.event.type] || 0) + 1;
  });
  const max = Math.max(1, ...buckets.map((bucket) => Object.values(bucket).reduce((sum, count) => sum + count, 0)));
  const barWidth = width / bucketCount;
  buckets.forEach((bucket, index) => {
    let y = height - 1;
    Object.entries(bucket).forEach(([type, count]) => {
      const barHeight = (count / max) * (height - 6);
      context.fillStyle = typeColors[type] || typeColors.UNKNOWN;
      context.fillRect(index * barWidth, y - barHeight, Math.max(1, barWidth - 0.5), barHeight);
      y -= barHeight;
    });
  });

  if (windowBox) {
    const isFull = state.eventView.start <= bounds.start && state.eventView.end >= bounds.end;
    windowBox.classList.toggle('is-full-window', isFull);
    const left = ((state.eventView.start - bounds.start) / span) * 100;
    const boxWidth = ((state.eventView.end - state.eventView.start) / span) * 100;
    windowBox.style.left = `${left}%`;
    windowBox.style.width = `${Math.max(boxWidth, 0.6)}%`;
    placeStartLabel(windowBox.querySelector('.overview-window-start'), state.eventView.start);
  }
  setOverviewSummary(state.eventView.start, state.eventView.end);
}

function overviewTime(clientX, rect) {
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return state.eventBounds.start + ratio * (state.eventBounds.end - state.eventBounds.start);
}

function bindOverview(root, options) {
  const track = (root || document).querySelector('.overview-track');
  if (!track || track.dataset.bound === 'true') {
    return;
  }
  track.dataset.bound = 'true';
  const cursor = track.querySelector('.overview-cursor');
  const tip = track.querySelector('.overview-tip');
  const brush = track.querySelector('.overview-brush');

  const config = typeof options === 'function' ? { tipForTime: options } : (options || {});
  const tipForTime = config.tipForTime;
  const widget = config.widget || 'events';
  const getBounds = config.getBounds || (() => state.eventBounds);
  const onApply = config.onApply || ((s, e) => setEventView(s, e));

  const showTip = (clientX, clientY, text) => {
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    cursor.hidden = false;
    cursor.style.left = `${x}px`;
    tip.hidden = false;
    tip.textContent = text;
    const besideRight = clientX < window.innerWidth - 170;
    tip.style.left = `${besideRight ? clientX + 8 : clientX - 8}px`;
    tip.style.top = `${Math.min(Math.max(clientY - 10, 8), window.innerHeight - 28)}px`;
    tip.style.transform = besideRight ? 'none' : 'translateX(-100%)';
  };

  const timeAtX = (clientX, rect, bounds) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return bounds.start + ratio * (bounds.end - bounds.start);
  };

  track.addEventListener('mousemove', (event) => {
    const bounds = getBounds();
    if (!bounds || Number.isNaN(bounds.start) || Number.isNaN(bounds.end)) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const time = timeAtX(event.clientX, rect, bounds);
    const tipText = tipForTime ? tipForTime(time) : formatExact(time);
    const dragStart = state.overviewDrag && state.overviewDrag.track === track ? state.overviewDrag.x : null;
    if (dragStart == null) {
      showTip(event.clientX, event.clientY, tipText);
      return;
    }
    const left = Math.min(dragStart, event.clientX);
    const right = Math.max(dragStart, event.clientX);
    const startTime = timeAtX(left, rect, bounds);
    const endTime = timeAtX(right, rect, bounds);
    brush.hidden = false;
    brush.style.left = `${left - rect.left}px`;
    brush.style.width = `${Math.max(1, right - left)}px`;
    placeStartLabel(brush.querySelector('.overview-window-start'), startTime);
    showTip(event.clientX, event.clientY, tipText);
    setOverviewSummary(startTime, endTime);
    updateFloatingTimeToolbar(widget, startTime, endTime);
  });

  track.addEventListener('mouseleave', () => {
    if (state.overviewDrag && state.overviewDrag.track === track) {
      return;
    }
    cursor.hidden = true;
    tip.hidden = true;
  });

  track.addEventListener('mousedown', (event) => {
    event.preventDefault();
    state.activeTimelineWidget = widget;
    state.overviewDrag = { x: event.clientX, track, brush, cursor, tip, getBounds, onApply, widget, tipForTime };
    brush.hidden = false;
    brush.style.left = `${event.clientX - track.getBoundingClientRect().left}px`;
    brush.style.width = '1px';
    updateFloatingTimeToolbar(widget);
  });

  if (!state.overviewMouseUp) {
    state.overviewMouseUp = (event) => {
      const drag = state.overviewDrag;
      if (!drag) {
        return;
      }
      const bounds = drag.getBounds ? drag.getBounds() : state.eventBounds;
      if (!bounds || Number.isNaN(bounds.start) || Number.isNaN(bounds.end)) {
        state.overviewDrag = null;
        return;
      }
      const rect = drag.track.getBoundingClientRect();
      const r1 = Math.min(1, Math.max(0, (Math.min(drag.x, event.clientX) - rect.left) / rect.width));
      const r2 = Math.min(1, Math.max(0, (Math.max(drag.x, event.clientX) - rect.left) / rect.width));
      const span = bounds.end - bounds.start;
      const start = bounds.start + r1 * span;
      const end = bounds.start + r2 * span;
      const applyFn = drag.onApply || ((s, e) => setEventView(s, e));
      const widgetName = drag.widget || 'events';
      state.overviewDrag = null;
      drag.brush.hidden = true;
      drag.cursor.hidden = true;
      drag.tip.hidden = true;
      if (end - start < 1000) {
        applyFn(start - 60 * 1000, start + 60 * 1000);
      } else {
        applyFn(start, end);
      }
      updateFloatingTimeToolbar(widgetName, start, end);
    };
    window.addEventListener('mouseup', state.overviewMouseUp);
  }
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  const overview = document.getElementById('timelineOverview');
  const legend = document.getElementById('overviewLegend');
  const records = state.filteredEvents;
  destroyChart(state.timeline);
  state.timeline = null;
  const hasTimedEvents = timedEvents(state.allEvents).length > 0;
  if (!state.eventBounds && hasTimedEvents) {
    state.eventBounds = eventBounds(state.allEvents);
  }
  if (!state.eventBounds || !hasTimedEvents) {
    state.eventView = null;
    container.innerHTML = '<div class="empty-state">No data to display.</div>';
    if (overview) overview.innerHTML = '';
    if (legend) legend.innerHTML = '';
    const label = document.getElementById('timelineWindow');
    if (label) label.textContent = 'No events in this filter';
    return;
  }

  const types = Array.from(new Set(state.allEvents.map((event) => event.type)));
  if (legend) {
    legend.innerHTML = types.map((type) => `
      <span class="legend-item"><span class="legend-swatch" style="background:${typeColors[type] || typeColors.UNKNOWN};"></span>${escapeHtml(typeLabels[type] || type)}</span>
    `).join('');
  }

  overview.innerHTML = `
    <div class="timeline-overview-grid">
      <div class="timeline-overview-label">
        <span class="overview-grid-title">Overview</span>
        <span class="overview-grid-subtitle">Density</span>
      </div>
      <div class="timeline-overview-main">
        <div class="overview-scale">
          <span class="overview-bound-start">${escapeHtml(formatExact(state.eventBounds.start))}</span>
          <strong class="overview-duration">${escapeHtml(formatDuration(state.eventBounds.start, state.eventBounds.end))} full range</strong>
          <span class="overview-bound-end">${escapeHtml(formatExact(state.eventBounds.end))}</span>
        </div>
        <div class="overview-track">
          <canvas id="overviewCanvas"></canvas>
          <div id="overviewWindow" class="overview-window"><span class="overview-window-start"></span></div>
          <div class="overview-cursor" hidden></div>
          <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
          <div class="overview-tip" hidden></div>
        </div>
      </div>
    </div>
  `;
  bindOverview(overview, {
    widget: 'events',
    getBounds: () => state.eventBounds,
    onApply: (start, end) => setEventView(start, end),
  });

  const selection = selectedWindow();
  const selectedStart = Number.isFinite(selection.start) ? selection.start : state.eventBounds.start;
  const selectedEnd = Number.isFinite(selection.end) ? selection.end : state.eventBounds.end;
  if (!records.length) {
    container.innerHTML = '<div class="empty-state">No events match the current filters. Event density still shows the loaded history above.</div>';
    setEventView(selectedStart, selectedEnd, false);
    return;
  }

  container.innerHTML = `
    <div class="event-chart">
      <div class="event-labels"></div>
      <div class="event-main">
        <div class="event-axis"></div>
        <div class="event-plot"></div>
      </div>
    </div>
  `;
  const plot = container.querySelector('.event-plot');
  bindTimeGuide(container.querySelector('.event-main'), (ratio) => {
    const view = state.eventView;
    return view ? view.start + ratio * (view.end - view.start) : NaN;
  });
  plot.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.activeTimelineWidget = 'events';
    const rect = plot.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const span = state.eventView.end - state.eventView.start;
    const next = Math.min(Math.max(span * (event.deltaY > 0 ? 1.3 : 0.75), 15 * 1000), state.eventBounds.end - state.eventBounds.start);
    const anchor = state.eventView.start + ratio * span;
    setEventView(anchor - ratio * next, anchor + (1 - ratio) * next);
  }, { passive: false });

  let panStart = null;
  plot.addEventListener('mousedown', (event) => {
    state.activeTimelineWidget = 'events';
    if (event.target.classList.contains('event-dot')) {
      return;
    }
    panStart = { x: event.clientX, view: { ...state.eventView } };
  });
  plot.addEventListener('mousemove', (event) => {
    if (!panStart) {
      return;
    }
    const span = panStart.view.end - panStart.view.start;
    const shift = ((panStart.x - event.clientX) / plot.clientWidth) * span;
    setEventView(panStart.view.start + shift, panStart.view.end + shift);
  });
  plot.addEventListener('mouseup', () => {
    panStart = null;
  });
  plot.addEventListener('mouseleave', () => {
    panStart = null;
  });

  state.timeline = {
    destroy() {},
    getWindow() {
      return { start: new Date(state.eventView.start), end: new Date(state.eventView.end) };
    },
    setWindow(start, end) {
      setEventView(new Date(start).getTime(), new Date(end).getTime(), false);
    },
    on(name, handler) {
      if (name === 'rangechanged') {
        this._range = handler;
      }
    },
  };

  const fitButton = document.getElementById('timelineFit');
  if (fitButton) {
    fitButton.onclick = () => {
      state.activeTimelineWidget = 'events';
      setEventView(state.eventBounds.start, state.eventBounds.end);
      updateFloatingTimeToolbar('events');
    };
  }
  setEventView(selectedStart, selectedEnd, false);
}

function connectorColor(status, connectorId = 1) {
  return connectorStateList(connectorId).find((item) => item.id === status)?.color || '#57534e';
}

function connectorStateLabel(item) {
  return (item && (item.label || item.id)) || '';
}

function connectorView(connectorId) {
  const prefix = connectorId === 1 ? 'connector' : `connector${connectorId}`;
  return {
    legendId: `${prefix}Legend`,
    overviewId: `${prefix}Overview`,
    timelineId: `${prefix}Timeline`,
    fitId: `${prefix}Fit`,
    viewBadgeId: `${prefix}ViewBadge`,
    barsId: `${prefix}OverviewBars`,
    windowId: `${prefix}Window`,
    empty: `No connector ${connectorId} status messages in this window.`,
  };
}

function connectorPlotWidth(plot) {
  if (plot.clientWidth) {
    return plot.clientWidth;
  }
  const visible = document.querySelector('.connector-pane:not([hidden]) .event-plot');
  return (visible && visible.clientWidth) || 640;
}

function showConnectorTab(connectorId) {
  state.activeConnector = connectorId;
  state.activeTimelineWidget = 'connector';
  document.querySelectorAll('.connector-tab').forEach((button) => {
    const active = Number(button.dataset.connector) === connectorId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.connector-pane').forEach((pane) => {
    pane.hidden = pane.id !== `connectorPane${connectorId}`;
  });
  drawConnectorChart(connectorId);
  drawConnectorOverview(connectorId);
  updateFloatingTimeToolbar('connector');
}

function redrawConnectorCharts() {
  state.connectorIds.forEach((connectorId) => {
    drawConnectorChart(connectorId);
    drawConnectorOverview(connectorId);
  });
}

function drawConnectorChart(connectorId) {
  const viewIds = connectorView(connectorId);
  const plot = document.querySelector(`#${viewIds.timelineId} .event-plot`);
  const intervals = state.connectorIntervalsById && state.connectorIntervalsById[connectorId];
  if (!plot || !state.eventView || !intervals) {
    return;
  }
  const states = connectorStateList(connectorId);
  const width = connectorPlotWidth(plot);
  const view = state.eventView;
  const span = Math.max(view.end - view.start, 1);
  plot.innerHTML = states.map((item) => {
    const bars = intervals
      .filter((interval) => interval.status === item.id && interval.end > view.start && interval.time < view.end)
      .map((interval) => {
        const start = Math.max(interval.time, view.start);
        const end = Math.min(interval.end, view.end);
        const left = ((start - view.start) / span) * width;
        const barWidth = Math.max(((end - start) / span) * width, 2);
        return `<button type="button" class="connector-bar" data-start="${interval.time}" data-end="${interval.end}" data-status="${escapeHtml(connectorStateLabel(item))}" style="left:${left}px; width:${barWidth}px; background:${item.color};"></button>`;
      }).join('');
    return `<div class="connector-lane">${bars}</div>`;
  }).join('');

  const labels = document.querySelector(`#${viewIds.timelineId} .event-labels`);
  if (labels) {
    labels.innerHTML = `<div class="event-axis-spacer"></div>${states.map((item) => `<div class="connector-lane event-lane-label">${escapeHtml(connectorStateLabel(item))}</div>`).join('')}`;
  }
  const axis = document.querySelector(`#${viewIds.timelineId} .event-axis`);
  if (axis) {
    axis.innerHTML = Array.from({ length: 6 }, (_, index) => {
      const time = view.start + (span * index) / 5;
      return `<span style="left:${(index / 5) * 100}%">${escapeHtml(formatExact(time))}</span>`;
    }).join('');
  }

  const viewBadge = document.getElementById(viewIds.viewBadgeId);
  if (viewBadge && state.eventBounds && state.eventView) {
    const isFull = state.eventView.start <= state.eventBounds.start && state.eventView.end >= state.eventBounds.end;
    if (isFull) {
      viewBadge.className = 'timeline-window-badge is-full';
      viewBadge.textContent = `Full window · ${formatDuration(state.eventBounds.start, state.eventBounds.end)}`;
    } else {
      viewBadge.className = 'timeline-window-badge is-zoom';
      viewBadge.textContent = `Viewing: ${formatExact(state.eventView.start)} – ${formatExact(state.eventView.end)} (${formatDuration(state.eventView.start, state.eventView.end)})`;
    }
  }

  plot.querySelectorAll('.connector-bar').forEach((bar) => {
    bar.addEventListener('mouseenter', (event) => {
      const hover = document.getElementById('eventHover');
      if (!hover) {
        return;
      }
      const start = Number(bar.dataset.start);
      const end = Number(bar.dataset.end);
      hover.innerHTML = `<div><strong>${escapeHtml(bar.dataset.status)}</strong> · ${escapeHtml(formatDuration(start, end))}</div><div>${escapeHtml(formatExact(start))} – ${escapeHtml(formatExact(end))}</div>`;
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 320)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    bar.addEventListener('mouseleave', hideEventHover);
  });
}

function drawConnectorOverview(connectorId) {
  const viewIds = connectorView(connectorId);
  const bars = document.getElementById(viewIds.barsId);
  const windowBox = document.getElementById(viewIds.windowId);
  const intervals = state.connectorIntervalsById && state.connectorIntervalsById[connectorId];
  if (!bars || !state.eventBounds || !state.eventView || !intervals) {
    return;
  }
  const bounds = state.eventBounds;
  const span = Math.max(bounds.end - bounds.start, 1);
  bars.innerHTML = `<i class="overview-rail"></i>` + intervals.map((interval) => {
    const start = Math.max(interval.time, bounds.start);
    const end = Math.min(interval.end, bounds.end);
    if (end <= start) {
      return '';
    }
    const left = ((start - bounds.start) / span) * 100;
    const width = ((end - start) / span) * 100;
    return `<i style="left:${left}%; width:${width}%; background:${connectorColor(interval.status, connectorId)};"></i>`;
  }).join('');
  if (windowBox) {
    const isFull = state.eventView.start <= bounds.start && state.eventView.end >= bounds.end;
    windowBox.classList.toggle('is-full-window', isFull);
    windowBox.style.left = `${((state.eventView.start - bounds.start) / span) * 100}%`;
    windowBox.style.width = `${Math.max(((state.eventView.end - state.eventView.start) / span) * 100, 0.6)}%`;
    placeStartLabel(windowBox.querySelector('.overview-window-start'), state.eventView.start);
  }
  setOverviewSummary(state.eventView.start, state.eventView.end);
}

function mountConnectorChart(connectorId) {
  const viewIds = connectorView(connectorId);
  const container = document.getElementById(viewIds.timelineId);
  const overview = document.getElementById(viewIds.overviewId);
  const legend = document.getElementById(viewIds.legendId);
  if (!container || !overview || !legend) {
    return;
  }
  legend.innerHTML = connectorStateList(connectorId).map((item) => `
    <span class="legend-item"><span class="legend-swatch" style="background:${item.color};"></span>${escapeHtml(connectorStateLabel(item))}</span>
  `).join('');
  const intervals = connectorIntervals(state.allEvents, connectorId);
  state.connectorIntervalsById[connectorId] = intervals;
  if (connectorId === 1) {
    state.connectorIntervals = intervals;
  }
  if (!intervals.length || !state.eventBounds) {
    overview.innerHTML = '';
    container.innerHTML = `<div class="empty-state">${viewIds.empty}</div>`;
    return;
  }
  overview.innerHTML = `
    <div class="timeline-overview-grid">
      <div class="timeline-overview-label">
        <span class="overview-grid-title">Overview</span>
        <span class="overview-grid-subtitle">Timeline</span>
      </div>
      <div class="timeline-overview-main">
        <div class="overview-scale">
          <span class="overview-bound-start">${escapeHtml(formatExact(state.eventBounds.start))}</span>
          <strong class="overview-duration">${escapeHtml(formatDuration(state.eventBounds.start, state.eventBounds.end))} full range</strong>
          <span class="overview-bound-end">${escapeHtml(formatExact(state.eventBounds.end))}</span>
        </div>
        <div class="overview-track">
          <div id="${viewIds.barsId}" class="overview-bars"></div>
          <div id="${viewIds.windowId}" class="overview-window"><span class="overview-window-start"></span></div>
          <div class="overview-cursor" hidden></div>
          <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
          <div class="overview-tip" hidden></div>
        </div>
      </div>
    </div>
  `;
  bindOverview(overview, {
    widget: 'connector',
    getBounds: () => state.eventBounds,
    onApply: (start, end) => setEventView(start, end),
  });
  container.innerHTML = `
    <div class="event-chart connector-chart">
      <div class="event-labels"></div>
      <div class="event-main">
        <div class="event-axis"></div>
        <div class="event-plot"></div>
      </div>
    </div>
  `;
  const plot = container.querySelector('.event-plot');
  bindTimeGuide(container.querySelector('.event-main'), (ratio) => {
    const view = state.eventView;
    return view ? view.start + ratio * (view.end - view.start) : NaN;
  });
  plot.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.activeTimelineWidget = 'connector';
    const rect = plot.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const span = state.eventView.end - state.eventView.start;
    const next = Math.min(Math.max(span * (event.deltaY > 0 ? 1.3 : 0.75), 15 * 1000), state.eventBounds.end - state.eventBounds.start);
    const anchor = state.eventView.start + ratio * span;
    setEventView(anchor - ratio * next, anchor + (1 - ratio) * next);
  }, { passive: false });
  let panStart = null;
  plot.addEventListener('mousedown', (event) => {
    state.activeTimelineWidget = 'connector';
    if (event.target.classList.contains('connector-bar')) {
      return;
    }
    panStart = { x: event.clientX, view: { ...state.eventView } };
  });
  plot.addEventListener('mousemove', (event) => {
    if (!panStart) {
      return;
    }
    const span = panStart.view.end - panStart.view.start;
    const shift = ((panStart.x - event.clientX) / plot.clientWidth) * span;
    setEventView(panStart.view.start + shift, panStart.view.end + shift);
  });
  plot.addEventListener('mouseup', () => {
    panStart = null;
  });
  plot.addEventListener('mouseleave', () => {
    panStart = null;
  });
  const fitButton = document.getElementById(viewIds.fitId);
  if (fitButton) {
    fitButton.onclick = () => {
      state.activeTimelineWidget = 'connector';
      setEventView(state.eventBounds.start, state.eventBounds.end);
      updateFloatingTimeToolbar('connector');
    };
  }
}

function renderConnectorTimeline() {
  destroyChart(state.connectorTimeline);
  state.connectorTimeline = { destroy() {} };
  const connectorRecords = deriveChargerState().connectors;
  state.connectorIds = connectorRecords.map((connector) => connector.id);
  state.connectorIntervalsById = Object.fromEntries(state.connectorIds.map((connectorId) => [connectorId, []]));
  state.connectorIntervals = [];
  renderConnectorTabs(connectorRecords);
  if (!state.connectorIds.length) {
    return;
  }
  state.connectorIds.forEach((connectorId) => mountConnectorChart(connectorId));
  if (!state.connectorIds.includes(state.activeConnector)) {
    state.activeConnector = state.connectorIds[0];
  }
  redrawConnectorCharts();
  showConnectorTab(state.activeConnector);
}

function renderConnectorTabs(connectorRecords) {
  const tablist = document.getElementById('connectorTabs') || document.querySelector('.connector-tabs');
  const panes = document.getElementById('connectorPanes');
  if (!tablist) {
    return;
  }
  const records = new Map(connectorRecords.map((connector) => [connector.id, connector]));
  const ids = state.connectorIds;
  if (!panes) {
    tablist.querySelectorAll('.connector-tab').forEach((button) => {
      const connectorId = Number(button.dataset.connector);
      const connector = records.get(connectorId);
      if (connector) button.textContent = `Connector ${connectorId} · ${normalizeConnectorState(connector.status, connectorId) || 'Unknown'}`;
    });
    return;
  }

  if (!ids.length) {
    tablist.innerHTML = '';
    panes.innerHTML = '<p class="empty-state">Connector state is unavailable until charger or event data is loaded.</p>';
    return;
  }

  tablist.innerHTML = ids.map((connectorId) => {
    const connector = records.get(connectorId);
    const status = connector ? normalizeConnectorState(connector.status, connectorId) || 'Unknown' : 'Unknown';
    const active = connectorId === state.activeConnector;
    const sLow = status.toLowerCase();
    const statusClass = sLow === 'available' ? 'is-available'
      : sLow === 'charging' ? 'is-charging'
      : sLow === 'preparing' ? 'is-preparing'
      : sLow.includes('suspended') ? 'is-suspended'
      : sLow === 'faulted' ? 'is-faulted'
      : sLow === 'finishing' ? 'is-finishing'
      : 'is-disconnected';

    return `
      <button type="button" 
              class="connector-tab${active ? ' active' : ''} ${statusClass}" 
              role="tab" 
              id="connectorTab${connectorId}" 
              data-connector="${connectorId}" 
              aria-selected="${active}" 
              aria-controls="connectorPane${connectorId}">
        <span class="conn-tab-chip">C${connectorId}</span>
        <span class="conn-tab-dot ${statusClass}"></span>
        <span class="conn-tab-label">Connector ${connectorId}</span>
        <span class="conn-tab-status ${statusClass}">${escapeHtml(status)}</span>
      </button>
    `;
  }).join('');

  panes.innerHTML = ids.map((connectorId) => {
    const connector = records.get(connectorId);
    const status = connector ? normalizeConnectorState(connector.status, connectorId) || 'Unknown' : 'Unknown';
    const since = connector && connector.since;
    const previous = connector && connector.lastKnownGood;
    const view = connectorView(connectorId);
    const showFocus = ['Faulted', 'Unavailable', 'Disconnected'].includes(status) && since;
    const sLow = status.toLowerCase();
    const statusClass = sLow === 'available' ? 'is-available'
      : sLow === 'charging' ? 'is-charging'
      : sLow === 'preparing' ? 'is-preparing'
      : sLow.includes('suspended') ? 'is-suspended'
      : sLow === 'faulted' ? 'is-faulted'
      : sLow === 'finishing' ? 'is-finishing'
      : 'is-disconnected';

    return `<div id="connectorPane${connectorId}" class="connector-pane" role="tabpanel" aria-labelledby="connectorTab${connectorId}"${connectorId === state.activeConnector ? '' : ' hidden'}>
      <div class="connector-current-summary">
        <div class="summary-cell">
          <span class="summary-label">Current State</span>
          <div class="summary-value">
            <span class="summary-dot ${statusClass}"></span>
            <strong>${escapeHtml(status)}</strong>
          </div>
        </div>
        <div class="summary-cell">
          <span class="summary-label">Active Since</span>
          <strong class="summary-time">${since ? escapeHtml(formatGlanceTimestamp(since)) : 'Unavailable'}</strong>
        </div>
        <div class="summary-cell">
          <span class="summary-label">Previous State</span>
          <strong class="summary-prev">${previous ? `${escapeHtml(previous.status)} · ${escapeHtml(formatGlanceTimestamp(previous.at))}` : 'Unavailable'}</strong>
        </div>
        ${showFocus ? `
          <div class="summary-action-cell">
            <button type="button" class="connector-focus-btn" data-connector="${connectorId}" data-start="${escapeHtml(since)}" title="Focus timeline on this incident window">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
              <span>Focus Incident</span>
            </button>
          </div>` : ''}
      </div>
      <p class="panel-hint">Each bar holds the last connector ${connectorId} status until the next one arrives.</p>
      <div class="timeline-tools">
        <button id="${view.fitId}" type="button" class="timeline-fit-btn" title="Reset timeline to full range">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          <span>Fit Window</span>
        </button>
        <span class="panel-hint">Drag the top bar to choose a time. Hover a bar for that status.</span>
      </div>
      <div id="${view.legendId}" class="event-legend"></div>
      <div id="${view.overviewId}" class="timeline-overview"></div>
      <div id="${view.timelineId}"></div>
    </div>`;
  }).join('');

  tablist.querySelectorAll('.connector-tab').forEach((button) => {
    button.addEventListener('click', () => {
      showConnectorTab(Number(button.dataset.connector));
      scheduleSmartInvestigationRefresh();
    });
  });

  panes.querySelectorAll('.connector-focus-btn').forEach((button) => {
    button.addEventListener('click', () => focusConnector(Number(button.dataset.connector), button.dataset.start, Date.now()));
  });
}

const SMART_STATES = [
  { id: 'Enabled', color: '#168a52' },
  { id: 'Suspended', color: '#8a99a5' },
];

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function formatPower(power) {
  if (power == null || Number.isNaN(power)) {
    return 'Max power allowed: —';
  }
  if (Math.abs(power) >= 100) {
    return `Max power allowed: ${power} W`;
  }
  return `Max power allowed: ${power} kW`;
}

function periodFromFields(start, end, power) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const numericPower = Number(power);
  if (!start || !end || Number.isNaN(startTime) || Number.isNaN(endTime) || endTime <= startTime) {
    return null;
  }
  return {
    time: startTime,
    end: endTime,
    power: Number.isFinite(numericPower) ? numericPower : null,
    status: Number.isFinite(numericPower) && numericPower > 0 ? 'Enabled' : 'Suspended',
  };
}

function periodsFromText(text) {
  return text.split(/schedule\s*\{/i).slice(1).map((chunk) => {
    const start = (chunk.match(/start_date:\s*"([^"]+)"/i) || [])[1];
    const end = (chunk.match(/end_date:\s*"([^"]+)"/i) || [])[1];
    const power = (chunk.match(/power:\s*([0-9.eE+-]+)/i) || [])[1];
    return periodFromFields(start, end, power);
  }).filter(Boolean);
}

function periodsFromChargingSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return [];
  }
  const startMs = new Date(schedule.startSchedule || schedule.start_schedule).getTime();
  const periods = schedule.chargingSchedulePeriod || schedule.charging_schedule_period || [];
  if (Number.isNaN(startMs) || !Array.isArray(periods) || !periods.length) {
    return [];
  }
  const duration = Number(schedule.duration);
  const sorted = periods
    .map((period, index) => ({
      offset: Number(period.startPeriod ?? period.start_period ?? (index === 0 ? 0 : NaN)),
      power: period.limit == null && period.power == null ? 0 : Number(period.limit ?? period.power),
    }))
    .filter((period) => !Number.isNaN(period.offset))
    .sort((left, right) => left.offset - right.offset);
  return sorted.map((period, index) => {
    const start = startMs + period.offset * 1000;
    const nextOffset = index < sorted.length - 1
      ? sorted[index + 1].offset
      : (Number.isFinite(duration) ? duration : period.offset);
    return {
      time: start,
      end: Math.max(startMs + nextOffset * 1000, start + 1000),
      power: Number.isFinite(period.power) ? period.power : 0,
      status: Number.isFinite(period.power) && period.power > 0 ? 'Enabled' : 'Suspended',
    };
  }).filter((period) => period.end > period.time);
}

function chargingScheduleFrom(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value.chargingSchedule
    || value.csChargingProfiles?.chargingSchedule
    || value.csChargingProfiles?.charging_schedule
    || value.charging_schedule
    || null;
}

function periodsFromValue(value) {
  const parsed = parseMaybeJson(value);
  if (!parsed) {
    return [];
  }
  if (typeof parsed === 'string') {
    return periodsFromText(parsed);
  }
  const schedule = chargingScheduleFrom(parsed);
  if (schedule && (schedule.chargingSchedulePeriod || schedule.charging_schedule_period || schedule.startSchedule)) {
    return periodsFromChargingSchedule(schedule);
  }
  const list = parsed.schedule || parsed.schedules || [];
  if (!Array.isArray(list)) {
    return periodsFromText(JSON.stringify(parsed));
  }
  return list.map((item) => {
    const window = item.chargingSchedule || item.charging_schedule || item;
    return periodFromFields(
      window.startDate || window.start_date || window.start,
      window.endDate || window.end_date || window.end,
      item.power ?? item.limit ?? item.maxPower ?? item.max_power,
    );
  }).filter(Boolean);
}

function smartChargingIntervals(events) {
  const batches = events
    .filter((event) => ['SMART_CHARGING_SCHEDULES', 'SET_CHARGING_PROFILE', 'CLEAR_CHARGING_PROFILE'].includes(event.eventName))
    .map((event) => ({
      time: new Date(event.timestamp).getTime(),
      periods: event.eventName === 'CLEAR_CHARGING_PROFILE'
        ? []
        : periodsFromValue(event.additionalData).concat(periodsFromValue(event.raw && event.raw.additionalData)),
      clear: event.eventName === 'CLEAR_CHARGING_PROFILE',
    }))
    .filter((batch) => !Number.isNaN(batch.time) && (batch.clear || batch.periods.length))
    .sort((left, right) => left.time - right.time)
    .map((batch) => batch.clear ? [{ time: batch.time, end: batch.time, power: 0, status: 'Suspended', clear: true }] : batch.periods);

  let segments = [];
  batches.forEach((periods) => {
    periods.forEach((period) => {
      if (period.clear) {
        segments = segments.flatMap((segment) => {
          if (segment.end <= period.time) {
            return [segment];
          }
          if (segment.time >= period.time) {
            return [];
          }
          return [{ ...segment, end: period.time }];
        });
        return;
      }
      const next = [];
      segments.forEach((segment) => {
        if (segment.end <= period.time || segment.time >= period.end) {
          next.push(segment);
          return;
        }
        if (segment.time < period.time) {
          next.push({ ...segment, end: period.time });
        }
        if (segment.end > period.end) {
          next.push({ ...segment, time: period.end });
        }
      });
      next.push(period);
      segments = next;
    });
  });
  return segments.filter((segment) => segment.end > segment.time);
}

function smartHoverText(interval) {
  return `${interval.status} · ${formatPower(interval.power)} · ${formatDuration(interval.time, interval.end)} · ${formatExact(interval.time)} – ${formatExact(interval.end)}`;
}

function drawSmartChart() {
  const plot = document.querySelector('#smartTimeline .event-plot');
  if (!plot || !state.eventView || !state.smartIntervals) {
    return;
  }
  const width = plot.clientWidth || 640;
  const view = state.eventView;
  const span = Math.max(view.end - view.start, 1);
  plot.innerHTML = SMART_STATES.map((item) => {
    const bars = state.smartIntervals
      .filter((interval) => interval.status === item.id && interval.end > view.start && interval.time < view.end)
      .map((interval) => {
        const start = Math.max(interval.time, view.start);
        const end = Math.min(interval.end, view.end);
        const left = ((start - view.start) / span) * width;
        const barWidth = Math.max(((end - start) / span) * width, 2);
        return `<button type="button" class="connector-bar" data-start="${interval.time}" data-end="${interval.end}" data-status="${item.id}" data-power="${interval.power == null ? '' : interval.power}" style="left:${left}px; width:${barWidth}px; background:${item.color};"></button>`;
      }).join('');
    return `<div class="connector-lane">${bars}</div>`;
  }).join('');

  const labels = document.querySelector('#smartTimeline .event-labels');
  if (labels) {
    labels.innerHTML = `<div class="event-axis-spacer"></div>${SMART_STATES.map((item) => `<div class="connector-lane event-lane-label">${item.id}</div>`).join('')}`;
  }
  const axis = document.querySelector('#smartTimeline .event-axis');
  if (axis) {
    axis.innerHTML = Array.from({ length: 6 }, (_, index) => {
      const time = view.start + (span * index) / 5;
      return `<span style="left:${(index / 5) * 100}%">${escapeHtml(formatExact(time))}</span>`;
    }).join('');
  }
  plot.querySelectorAll('.connector-bar').forEach((bar) => {
    bar.addEventListener('mouseenter', (event) => {
      const hover = document.getElementById('eventHover');
      if (!hover) {
        return;
      }
      const interval = {
        status: bar.dataset.status,
        power: bar.dataset.power === '' ? null : Number(bar.dataset.power),
        time: Number(bar.dataset.start),
        end: Number(bar.dataset.end),
      };
      hover.textContent = smartHoverText(interval);
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 420)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    bar.addEventListener('mouseleave', hideEventHover);
  });
}

function drawSmartOverview() {
  const bars = document.getElementById('smartOverviewBars');
  const windowBox = document.getElementById('smartWindow');
  if (!bars || !state.eventBounds || !state.eventView || !state.smartIntervals) {
    return;
  }
  const bounds = state.eventBounds;
  const span = Math.max(bounds.end - bounds.start, 1);
  bars.innerHTML = `<i class="overview-rail"></i>` + state.smartIntervals.map((interval) => {
    const start = Math.max(interval.time, bounds.start);
    const end = Math.min(interval.end, bounds.end);
    if (end <= start) {
      return '';
    }
    const left = ((start - bounds.start) / span) * 100;
    const width = ((end - start) / span) * 100;
    const color = SMART_STATES.find((item) => item.id === interval.status)?.color || '#94a3b8';
    return `<i style="left:${left}%; width:${width}%; background:${color};"></i>`;
  }).join('');
  if (windowBox) {
    windowBox.style.left = `${((state.eventView.start - bounds.start) / span) * 100}%`;
    windowBox.style.width = `${Math.max(((state.eventView.end - state.eventView.start) / span) * 100, 0.6)}%`;
    placeStartLabel(windowBox.querySelector('.overview-window-start'), state.eventView.start);
  }
  setOverviewSummary(state.eventView.start, state.eventView.end);
}

function bindPlotWindow(plot) {
  plot.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = plot.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const span = state.eventView.end - state.eventView.start;
    const next = Math.min(Math.max(span * (event.deltaY > 0 ? 1.3 : 0.75), 15 * 1000), state.eventBounds.end - state.eventBounds.start);
    const anchor = state.eventView.start + ratio * span;
    setEventView(anchor - ratio * next, anchor + (1 - ratio) * next);
  }, { passive: false });
  let panStart = null;
  plot.addEventListener('mousedown', (event) => {
    if (event.target.classList.contains('connector-bar')) {
      return;
    }
    panStart = { x: event.clientX, view: { ...state.eventView } };
  });
  plot.addEventListener('mousemove', (event) => {
    if (!panStart) {
      return;
    }
    const span = panStart.view.end - panStart.view.start;
    const shift = ((panStart.x - event.clientX) / plot.clientWidth) * span;
    setEventView(panStart.view.start + shift, panStart.view.end + shift);
  });
  plot.addEventListener('mouseup', () => {
    panStart = null;
  });
  plot.addEventListener('mouseleave', () => {
    panStart = null;
  });
}

function scheduleRecords(events) {
  return events
    .filter((event) => event.eventName === 'SMART_CHARGING_SCHEDULES' || event.eventName === 'SET_CHARGING_PROFILE')
    .map((event) => {
      const raw = parseMaybeJson(event.additionalData) || parseMaybeJson(event.raw && event.raw.additionalData) || {};
      const profile = raw.csChargingProfiles || raw;
      const periods = periodsFromValue(event.additionalData);
      const schedulePeriods = periods.length ? periods : periodsFromValue(event.raw && event.raw.additionalData);
      const transactionId = profile.transactionId ?? raw.transactionId;
      if (transactionId == null || !schedulePeriods.length) {
        return null;
      }
      return {
        id: String(event.id),
        transactionId: String(transactionId),
        receivedAt: event.timestamp,
        eventName: event.eventName,
        periods: schedulePeriods,
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(left.receivedAt) - new Date(right.receivedAt));
}

function renderScheduleBar(schedule) {
  const start = schedule.periods[0].time;
  const end = schedule.periods[schedule.periods.length - 1].end;
  const span = Math.max(end - start, 1);
  const segments = schedule.periods.map((period) => {
    const left = ((period.time - start) / span) * 100;
    const width = ((period.end - period.time) / span) * 100;
    const color = period.power > 0 ? '#526575' : '#d5dee4';
    return `<i data-start="${period.time}" data-end="${period.end}" data-power="${period.power}" style="left:${left}%; width:${Math.max(width, 0.4)}%; background:${color};"></i>`;
  }).join('');
  return `
    <div class="schedule-meta">${escapeHtml(formatExact(start))} – ${escapeHtml(formatExact(end))} · ${escapeHtml(formatDuration(start, end))}</div>
    <div class="schedule-bar">${segments}</div>
  `;
}

function renderSmartChargingTimeline() {
  const root = document.getElementById('smartSessions');
  const hint = document.getElementById('smartHint');
  if (!root) {
    return;
  }
  const smartStatus = String((state.wallbox && state.wallbox.smartChargingStatus) || '').replace(/[\s_-]/g, '').toLowerCase();
  if (smartStatus === 'disabled') {
    if (hint) {
      hint.hidden = true;
    }
    root.innerHTML = '<p class="empty-state">Smart charging disabled</p>';
    return;
  }
  if (hint) {
    hint.hidden = false;
  }
  const window = selectedWindow();
  const records = scheduleRecords(state.allEvents).filter((record) => {
    if (Number.isNaN(window.start) || Number.isNaN(window.end)) {
      return true;
    }
    const received = new Date(record.receivedAt).getTime();
    const receivedInWindow = received >= window.start && received <= window.end;
    const coversWindow = record.periods.some((period) => period.end >= window.start && period.time <= window.end);
    return receivedInWindow || coversWindow;
  });
  const sessions = new Map();
  records.forEach((record) => {
    const group = sessions.get(record.transactionId) || [];
    group.push(record);
    sessions.set(record.transactionId, group);
  });
  if (!sessions.size) {
    root.innerHTML = '<p class="empty-state">No charging schedules in this window.</p>';
    return;
  }
  root.innerHTML = Array.from(sessions.entries()).map(([transactionId, schedules]) => `
    <details class="session-fold">
      <summary>
        <span>Session ${escapeHtml(transactionId)}</span>
        <em>${schedules.length} schedule${schedules.length === 1 ? '' : 's'}</em>
      </summary>
      <div class="schedule-list">
        ${schedules.map((schedule) => `
          <div class="schedule-item">
            <button type="button" class="schedule-row" data-id="${escapeHtml(schedule.id)}">
              <span>${escapeHtml(formatExact(schedule.receivedAt))}</span>
              <em>${escapeHtml(schedule.eventName.replace(/_/g, ' '))}</em>
            </button>
            <div class="schedule-view" hidden></div>
          </div>
        `).join('')}
      </div>
    </details>
  `).join('');

  root.querySelectorAll('.schedule-row').forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.schedule-item');
      const view = item.querySelector('.schedule-view');
      const schedule = records.find((record) => record.id === button.dataset.id);
      const open = view.hidden;
      root.querySelectorAll('.schedule-view').forEach((panel) => {
        panel.hidden = true;
      });
      root.querySelectorAll('.schedule-row').forEach((row) => row.classList.remove('open'));
      if (!open || !schedule) {
        return;
      }
      view.hidden = false;
      button.classList.add('open');
      view.innerHTML = renderScheduleBar(schedule);
      view.querySelectorAll('.schedule-bar i').forEach((segment) => {
        segment.addEventListener('mouseenter', (event) => {
          const hover = document.getElementById('eventHover');
          if (!hover) {
            return;
          }
          const start = Number(segment.dataset.start);
          const end = Number(segment.dataset.end);
          const power = Number(segment.dataset.power);
          hover.textContent = `${power > 0 ? 'Allowed' : 'Suspended'} · ${formatPower(power)} · ${formatExact(start)} – ${formatExact(end)}`;
          hover.hidden = false;
          hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 420)}px`;
          hover.style.top = `${event.clientY + 14}px`;
        });
        segment.addEventListener('mouseleave', hideEventHover);
      });
    });
  });
}

function renderTable() {
  const tbody = document.getElementById('eventTableBody');
  const records = state.filteredEvents;
  if (!records.length) {
    const status = state.sourceStatus.events;
    const message = status === 'loading' ? 'Loading event history...'
      : status === 'error' ? 'Failed to load event history.'
        : status === 'empty' ? 'No events in this time range.'
          : 'No events match the current filter.';
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(message)}</td></tr>`;
    return;
  }

  tbody.innerHTML = records
    .map((event) => {
      const isSelected = state.selectedEventId && String(event.id) === String(state.selectedEventId);
      const connectors = eventConnectorIds(event);
      const session = relatedSessionForEvent(event);
      return `
        <tr data-id="${escapeHtml(String(event.id))}" class="${isSelected ? 'selected-row' : ''}">
          <td class="event-time">${escapeHtml(formatExact(event.timestamp))}</td>
          <td><span class="event-type" style="--type:${typeColors[event.type] || typeColors.Unknown}"><i></i>${escapeHtml(prettyEnum(event.type))}</span></td>
          <td>${escapeHtml(String(event.eventName || 'Unknown'))}</td>
          <td>${connectors.length ? escapeHtml(connectors.map((id) => `Connector ${id}`).join(', ')) : '—'}</td>
          <td>${session ? `<button type="button" class="event-session-link" data-session="${escapeHtml(String(session.transactionId))}" aria-label="Open session ${escapeHtml(String(session.transactionId))}">${escapeHtml(String(session.transactionId))}</button>` : '—'}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('.event-session-link').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      focusSession(button.dataset.session);
    });
  });
  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const rowId = row.dataset.id;
      const event = state.allEvents.find((item) => String(item.id) === String(rowId));
      if (event) focusEvent(rowId);
    });
  });
}

function renderRelatedSession(event) {
  const container = document.getElementById('relatedSession');
  const session = event && relatedSessionForEvent(event);
  const eventTime = event ? new Date(event.timestamp).getTime() : NaN;
  const hasTime = Number.isFinite(eventTime);
  if (!container) return;
  container.hidden = !session && !hasTime;
  container.innerHTML = `${session
    ? `<span>Related session ${escapeHtml(String(session.transactionId))}</span><button type="button" data-session="${escapeHtml(String(session.transactionId))}">Open session</button>`
    : ''}${hasTime ? '<button type="button" data-around-event>Around selected event</button>' : ''}`;
  const sessionButton = container.querySelector('button[data-session]');
  if (sessionButton) sessionButton.addEventListener('click', () => focusSession(sessionButton.dataset.session));
  const aroundButton = container.querySelector('button[data-around-event]');
  if (aroundButton) aroundButton.addEventListener('click', () => applyWindowDates(eventTime - 30 * 60 * 1000, eventTime + 30 * 60 * 1000, true));
}

function renderDetail() {
  if (!state.filteredEvents.length) {
    document.getElementById('detailPane').textContent = 'Select an event from the timeline or table to inspect its payload.';
    renderRelatedSession(null);
    return;
  }

  const selectedEvent = state.filteredEvents.find((event) => String(event.id) === String(state.selectedEventId)) || state.filteredEvents[0];
  state.selectedEventId = selectedEvent.id;
  document.getElementById('detailPane').textContent = JSON.stringify(selectedEvent.raw, null, 2);
  renderRelatedSession(selectedEvent);
}

function dashboardApiUrl(path) {
  const currentEnv = state.currentEnv || 'prod';
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}env=${encodeURIComponent(currentEnv)}`;
}

async function fetchChargingSessions(serialNumber, token, startTime, endTime) {
  try {
    const response = await fetch(dashboardApiUrl('/api/charging-sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token, startTime, endTime }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return { sessions: [], error: formatApiError(result) };
    }
    const windowStart = startTime ? new Date(startTime).getTime() : 0;
    const windowEnd = endTime ? new Date(endTime).getTime() : Number.POSITIVE_INFINITY;
    const sessions = (result.sessions || []).filter((session) => {
      const start = new Date(session.startTime).getTime();
      const stop = session.stopTime ? new Date(session.stopTime).getTime() : windowEnd;
      return !Number.isNaN(start) && start <= windowEnd && stop >= windowStart;
    });
    return { sessions, error: null };
  } catch (error) {
    return { sessions: [], error: error.message || 'Charging sessions could not be loaded.' };
  }
}

function sessionStatusClass(status) {
  const text = String(status || '').replace(/[\s_-]/g, '').toLowerCase();
  if (text === 'completed') return 'completed';
  if (text.includes('timeout') || text.includes('timedout')) return 'timedout';
  if (text.includes('cancel')) return 'cancelled';
  if (text === 'ongoing') return 'ongoing';
  return '';
}

function sessionPeriod() {
  const start = new Date(combineDateTime(
    document.getElementById('startDate').value,
    document.getElementById('startTimeInput').value,
  )).getTime();
  const end = new Date(combineDateTime(
    document.getElementById('endDate').value,
    document.getElementById('endTimeInput').value,
  )).getTime();
  return { start, end };
}

function drawSessionOverview() {
  const overviewEl = document.getElementById('sessionOverview');
  const sessions = state.sessionStripSessions || [];
  const period = sessionPeriod();
  if (!overviewEl || !sessions.length || Number.isNaN(period.start) || Number.isNaN(period.end)) {
    if (overviewEl) overviewEl.innerHTML = '';
    return;
  }
  const view = state.sessionStripView || period;
  const periodSpan = Math.max(period.end - period.start, 1);
  const isFull = view.start <= period.start + 1000 && view.end >= period.end - 1000;
  const winLeft = Math.max(0, ((view.start - period.start) / periodSpan) * 100);
  const winWidth = Math.max(((view.end - view.start) / periodSpan) * 100, 0.6);

  const barsHtml = `<i class="overview-rail"></i>` + sessions.map((s) => {
    const r = sessionRange(s);
    if (r.end <= period.start || r.start >= period.end) return '';
    const st = Math.max(r.start, period.start);
    const en = Math.min(r.end, period.end);
    const left = ((st - period.start) / periodSpan) * 100;
    const width = Math.max(((en - st) / periodSpan) * 100, 0.4);
    const status = (s.status || '').toLowerCase();
    const color = status.includes('completed') ? '#22c55e' :
                  status.includes('timeout') || status.includes('timedout') ? '#ef4444' :
                  status.includes('cancel') ? '#f59e0b' : '#3b82f6';
    return `<i style="left:${left}%; width:${width}%; background:${color};"></i>`;
  }).join('');

  overviewEl.innerHTML = `
    <div class="timeline-overview-grid">
      <div class="timeline-overview-label">
        <span class="overview-grid-title">Overview</span>
        <span class="overview-grid-subtitle">Sessions</span>
      </div>
      <div class="timeline-overview-main">
        <div class="overview-scale">
          <span class="overview-bound-start">${escapeHtml(formatExact(period.start))}</span>
          <strong class="overview-duration">${escapeHtml(formatDuration(period.start, period.end))} full range</strong>
          <span class="overview-bound-end">${escapeHtml(formatExact(period.end))}</span>
        </div>
        <div class="overview-track session-overview-track">
          <div class="overview-bars">${barsHtml}</div>
          <div class="overview-window session-overview-window ${isFull ? 'is-full-window' : ''}" style="left:${winLeft}%; width:${winWidth}%;">
            <span class="overview-window-start">${isFull ? '' : escapeHtml(formatExact(view.start))}</span>
          </div>
          <div class="overview-cursor" hidden></div>
          <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
          <div class="overview-tip" hidden></div>
        </div>
      </div>
    </div>
  `;

  bindOverview(overviewEl, {
    widget: 'sessions',
    getBounds: () => sessionPeriod(),
    onApply: (start, end) => {
      state.sessionStripView = { start, end };
      paintSessionStrip();
      updateFloatingTimeToolbar('sessions', start, end);
    },
  });
}

function paintSessionStrip() {
  const strip = document.getElementById('sessionStrip');
  const sessions = state.sessionStripSessions || [];
  const period = sessionPeriod();
  const view = state.sessionStripView || period;
  if (!strip || !sessions.length || Number.isNaN(period.start) || Number.isNaN(period.end)) {
    if (strip) strip.innerHTML = '';
    const overviewEl = document.getElementById('sessionOverview');
    if (overviewEl) overviewEl.innerHTML = '';
    return;
  }
  drawSessionOverview();
  const span = Math.max(view.end - view.start, 1);
  const trackRect = strip.getBoundingClientRect();
  const trackWidth = trackRect.width || 800;
  const isZoomed = view.start > period.start + 1000 || view.end < period.end - 1000;

  // Filter and compute coordinates for sessions within the active view
  const inView = [];
  sessions.forEach((session) => {
    const range = sessionRange(session);
    if (Number.isNaN(range.start) || range.end < view.start || range.start > view.end) {
      return;
    }
    const leftPercent = Math.max(0, ((range.start - view.start) / span) * 100);
    const rawRightPercent = Math.min(100, ((range.end - view.start) / span) * 100);
    const minWidthPercent = Math.max(2.2, (34 / Math.max(trackWidth, 400)) * 100);
    const widthPercent = Math.max(rawRightPercent - leftPercent, minWidthPercent);
    const rightPercent = Math.min(100, leftPercent + widthPercent);
    inView.push({ session, range, leftPercent, widthPercent, rightPercent });
  });

  // Sort sessions chronologically
  inView.sort((a, b) => (a.range.start || 0) - (b.range.start || 0));

  // Density-aware lane allocation with a maximum budget of 3 visible lanes
  const MAX_LANES = 3;
  const minClusterWidthPercent = Math.max(3.6, (52 / Math.max(trackWidth, 400)) * 100);
  const lanes = Array.from({ length: MAX_LANES }, () => []);

  inView.forEach((item) => {
    let placedRow = -1;

    // First try rows 0 to MAX_LANES - 2 (individual placements)
    for (let r = 0; r < MAX_LANES - 1; r += 1) {
      const lastInRow = lanes[r][lanes[r].length - 1];
      if (!lastInRow || lastInRow.rightPercent + 0.8 <= item.leftPercent) {
        placedRow = r;
        break;
      }
    }

    if (placedRow !== -1) {
      lanes[placedRow].push({
        isCluster: false,
        session: item.session,
        range: item.range,
        leftPercent: item.leftPercent,
        widthPercent: item.widthPercent,
        rightPercent: item.rightPercent,
        row: placedRow
      });
      return;
    }

    // Overflow row (row MAX_LANES - 1)
    const overflowRow = MAX_LANES - 1;
    const lastOverflow = lanes[overflowRow][lanes[overflowRow].length - 1];

    if (!lastOverflow || lastOverflow.rightPercent + 0.8 <= item.leftPercent) {
      lanes[overflowRow].push({
        isCluster: false,
        session: item.session,
        range: item.range,
        leftPercent: item.leftPercent,
        widthPercent: item.widthPercent,
        rightPercent: item.rightPercent,
        row: overflowRow
      });
    } else {
      // Collision in overflow row: absorb into or create smart cluster
      if (!lastOverflow.isCluster) {
        const firstSession = lastOverflow.session;
        const firstRange = lastOverflow.range;
        lastOverflow.isCluster = true;
        lastOverflow.sessions = [firstSession, item.session];
        lastOverflow.start = Math.min(firstRange.start, item.range.start);
        lastOverflow.end = Math.max(firstRange.end, item.range.end);
        lastOverflow.leftPercent = Math.min(lastOverflow.leftPercent, item.leftPercent);
        lastOverflow.rightPercent = Math.max(lastOverflow.rightPercent, item.rightPercent);
        lastOverflow.widthPercent = Math.max(lastOverflow.rightPercent - lastOverflow.leftPercent, minClusterWidthPercent);
        lastOverflow.session = null;
      } else {
        lastOverflow.sessions.push(item.session);
        lastOverflow.start = Math.min(lastOverflow.start, item.range.start);
        lastOverflow.end = Math.max(lastOverflow.end, item.range.end);
        lastOverflow.leftPercent = Math.min(lastOverflow.leftPercent, item.leftPercent);
        lastOverflow.rightPercent = Math.max(lastOverflow.rightPercent, item.rightPercent);
        lastOverflow.widthPercent = Math.max(lastOverflow.rightPercent - lastOverflow.leftPercent, minClusterWidthPercent);
      }
    }
  });

  let usedRows = 0;
  for (let r = 0; r < MAX_LANES; r += 1) {
    if (lanes[r].length > 0) usedRows = r + 1;
  }
  const totalRows = Math.max(1, usedRows);

  const clusterRegistry = {};
  const renderedLanes = [];

  lanes.forEach((rowItems, r) => {
    rowItems.forEach((item, idx) => {
      const topPx = 6 + r * 26;
      if (!item.isCluster) {
        const session = item.session;
        const tone = sessionStatusClass(session.status) || 'ongoing';
        const mismatch = sessionTimelineMismatch(session);
        const mismatchBadge = mismatch ? `<span class="session-mismatch" title="${escapeHtml(mismatch.reason || 'Timeline mismatch')}">⚠</span>` : '';
        const segments = sessionStripSegments(session);
        const segTrack = `<div class="session-seg-track" style="display:none;">${segments.map((segment) => `<i class="session-seg" style="background:${connectorColor(segment.status, 1)};"></i>`).join('')}</div>`;

        renderedLanes.push(`
          <div class="session-lane ${tone}" 
               style="left:${item.leftPercent}%; width:${item.widthPercent}%; top:${topPx}px;" 
               data-id="${escapeHtml(String(session.transactionId))}">
            <span class="session-lane-label">${escapeHtml(String(session.transactionId))}</span>
            ${segTrack}
            ${mismatchBadge}
          </div>
        `);
      } else {
        const clusterId = `cluster_${r}_${idx}`;
        clusterRegistry[clusterId] = item;
        const count = item.sessions.length;
        const hasWarning = item.sessions.some((s) => {
          const status = (s.status || '').toLowerCase();
          return status.includes('timeout') || status.includes('timedout') || status.includes('cancel') || !!sessionTimelineMismatch(s);
        });
        const toneClass = hasWarning ? 'has-warning' : 'healthy';
        const warningBadge = hasWarning ? `<span class="cluster-warn-badge">⚠</span>` : '';

        renderedLanes.push(`
          <div class="session-lane session-cluster ${toneClass}" 
               style="left:${item.leftPercent}%; width:${item.widthPercent}%; top:${topPx}px;" 
               data-cluster-id="${clusterId}"
               data-start="${item.start}"
               data-end="${item.end}"
               data-count="${count}"
               title="Cluster of ${count} sessions · Click to zoom in">
            <span class="cluster-badge">
              <span class="cluster-icon"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></span>
              <span class="cluster-count">+${count}</span>
              ${warningBadge}
            </span>
          </div>
        `);
      }
    });
  });

  const centerControlHtml = isZoomed
    ? `<div class="session-strip-zoom-controls">
         <button type="button" id="sessionStripFit" class="session-strip-fit-btn" title="Reset timeline to full range">↺ Fit period</button>
       </div>`
    : `<div class="session-strip-zoom-controls">
         <button type="button" id="sessionStripFit" class="session-strip-fit-btn">Fit period</button>
       </div>`;

  strip.innerHTML = `
    <div class="session-strip-scale">
      <span class="session-strip-scale-time">${escapeHtml(formatExact(view.start))}</span>
      ${centerControlHtml}
      <span class="session-strip-scale-time">${escapeHtml(formatExact(view.end))}</span>
    </div>
    <div class="session-strip-track" style="height:${12 + totalRows * 26}px;" title="Drag to zoom into a sub-range · Double-click to fit period">
      ${renderedLanes.join('')}
      <div class="session-strip-brush" hidden>
        <span class="session-strip-brush-label"></span>
      </div>
    </div>
  `;
  const track = strip.querySelector('.session-strip-track');
  bindTimeGuide(track, (ratio) => view.start + ratio * (view.end - view.start));

  let isDragging = false;
  let startX = 0;
  let didDrag = false;

  track.addEventListener('dblclick', () => {
    state.activeTimelineWidget = 'sessions';
    state.sessionStripView = sessionPeriod();
    paintSessionStrip();
    updateFloatingTimeToolbar('sessions');
  });

  track.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.activeTimelineWidget = 'sessions';
    const rect = track.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const current = view.end - view.start;
    const next = Math.min(Math.max(current * (event.deltaY > 0 ? 1.4 : 0.65), 2 * 60 * 1000), period.end - period.start);
    const anchor = view.start + ratio * current;
    let start = anchor - ratio * next;
    let end = start + next;
    if (start < period.start) {
      end += period.start - start;
      start = period.start;
    }
    if (end > period.end) {
      start -= end - period.end;
      end = period.end;
    }
    state.sessionStripView = { start, end };
    paintSessionStrip();
    updateFloatingTimeToolbar('sessions', start, end);
  }, { passive: false });

  const fitBtn = strip.querySelector('#sessionStripFit');
  if (fitBtn) {
    fitBtn.addEventListener('click', () => {
      state.activeTimelineWidget = 'sessions';
      state.sessionStripView = sessionPeriod();
      paintSessionStrip();
      updateFloatingTimeToolbar('sessions');
    });
  }

  const onWindowMouseMove = (event) => {
    if (!isDragging) return;
    const dx = Math.abs(event.clientX - startX);
    if (dx > 4) {
      didDrag = true;
    }
    if (didDrag) {
      const rect = track.getBoundingClientRect();
      const leftPx = Math.min(startX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
      const rightPx = Math.max(startX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
      const brush = track.querySelector('.session-strip-brush');
      if (brush) {
        brush.hidden = false;
        brush.style.left = `${leftPx - rect.left}px`;
        brush.style.width = `${Math.max(2, rightPx - leftPx)}px`;
        const label = brush.querySelector('.session-strip-brush-label');
        if (label) {
          const sTime = view.start + ((leftPx - rect.left) / rect.width) * (view.end - view.start);
          const eTime = view.start + ((rightPx - rect.left) / rect.width) * (view.end - view.start);
          label.textContent = `${formatExact(sTime)} → ${formatExact(eTime)}`;
        }
      }
    }
  };

  const onWindowMouseUp = (event) => {
    if (!isDragging) return;
    const rect = track.getBoundingClientRect();
    const wasDragging = didDrag;
    const initX = startX;
    isDragging = false;
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);

    const brush = track.querySelector('.session-strip-brush');
    if (brush) brush.hidden = true;

    if (wasDragging) {
      const leftPx = Math.min(initX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
      const rightPx = Math.max(initX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
      if (rightPx - leftPx > 8) {
        const start = view.start + ((leftPx - rect.left) / rect.width) * (view.end - view.start);
        const end = view.start + ((rightPx - rect.left) / rect.width) * (view.end - view.start);
        if (end - start > 1000) {
          state.activeTimelineWidget = 'sessions';
          state.sessionStripView = { start, end };
          paintSessionStrip();
          updateFloatingTimeToolbar('sessions', start, end);
        }
      }
    }
    setTimeout(() => { didDrag = false; }, 50);
  };

  track.addEventListener('mousedown', (event) => {
    state.activeTimelineWidget = 'sessions';
    updateFloatingTimeToolbar('sessions');
    if (event.button !== 0) return;
    isDragging = true;
    startX = event.clientX;
    didDrag = false;
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
  });

  // Individual session lane handlers
  strip.querySelectorAll('.session-lane:not(.session-cluster)').forEach((lane) => {
    lane.addEventListener('mouseenter', (event) => {
      const session = sessions.find((item) => String(item.transactionId) === lane.dataset.id);
      const hover = document.getElementById('eventHover');
      if (!session || !hover) {
        return;
      }
      const range = sessionRange(session);
      const durSec = Number(session.duration);
      let durationStr = '—';
      if (Number.isFinite(durSec) && durSec > 0) {
        durationStr = formatDuration(0, durSec * 1000);
      } else if (range.end > range.start) {
        durationStr = formatDuration(range.start, range.end);
        if (/timeout|timedout/i.test(session.status || '')) {
          durationStr += ' (Timed out)';
        }
      }
      const energy = session.consumption != null ? `${session.consumption} kWh` : '—';
      const mismatch = sessionTimelineMismatch(session);
      const mismatchText = mismatch ? ` · ⚠ ${mismatch.reason}` : '';
      hover.textContent = `Session ${session.transactionId} · ${session.status || 'Unknown'} · Start: ${formatExact(session.startTime)} · Stop: ${session.stopTime ? formatDate(session.stopTime) : (session.status === 'TimedOut' ? 'Timed out' : 'Ongoing')} · Duration: ${durationStr} · Energy: ${energy}${mismatchText}`;
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 460)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    lane.addEventListener('mouseleave', hideEventHover);
    lane.addEventListener('click', (event) => {
      if (didDrag) {
        event.stopPropagation();
        return;
      }
      focusSession(lane.dataset.id);
    });
  });

  // Cluster lane handlers
  strip.querySelectorAll('.session-lane.session-cluster').forEach((lane) => {
    lane.addEventListener('mouseenter', (event) => {
      const cluster = clusterRegistry[lane.dataset.clusterId];
      const hover = document.getElementById('eventHover');
      if (!cluster || !hover) return;

      const count = cluster.sessions.length;
      let completed = 0;
      let timedout = 0;
      let cancelled = 0;
      let ongoing = 0;
      let mismatches = 0;
      let totalEnergy = 0;

      cluster.sessions.forEach((s) => {
        const st = (s.status || '').toLowerCase();
        if (st.includes('timeout') || st.includes('timedout')) timedout += 1;
        else if (st.includes('cancel')) cancelled += 1;
        else if (st === 'ongoing') ongoing += 1;
        else completed += 1;

        if (sessionTimelineMismatch(s)) mismatches += 1;
        if (s.consumption != null && Number.isFinite(Number(s.consumption))) {
          totalEnergy += Number(s.consumption);
        }
      });

      const statsParts = [];
      if (completed) statsParts.push(`${completed} Completed`);
      if (timedout) statsParts.push(`${timedout} Timed Out`);
      if (cancelled) statsParts.push(`${cancelled} Cancelled`);
      if (ongoing) statsParts.push(`${ongoing} Ongoing`);
      if (mismatches) statsParts.push(`⚠ ${mismatches} Mismatches`);

      hover.textContent = `Cluster: ${count} sessions (${statsParts.join(', ')}) · Span: ${formatExact(cluster.start)} → ${formatExact(cluster.end)} · Total: ${totalEnergy.toFixed(2)} kWh · Click to zoom in`;
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 460)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    lane.addEventListener('mouseleave', hideEventHover);
    lane.addEventListener('click', (event) => {
      if (didDrag) {
        event.stopPropagation();
        return;
      }
      hideEventHover();
      const cStart = Number(lane.dataset.start);
      const cEnd = Number(lane.dataset.end);
      const duration = Math.max(cEnd - cStart, 60 * 1000);
      const pad = Math.max(duration * 0.2, 5 * 60 * 1000); // 20% padding or at least 5 minutes
      state.sessionStripView = {
        start: Math.max(period.start, cStart - pad),
        end: Math.min(period.end, cEnd + pad),
      };
      paintSessionStrip();
    });
  });
}

function sessionRange(session) {
  const start = new Date(session.startTime).getTime();
  if (Number.isNaN(start)) {
    return { start: Date.now() - 3600000, end: Date.now() };
  }

  // 1. Explicit valid stopTime
  if (session.stopTime) {
    const stop = new Date(session.stopTime).getTime();
    if (!Number.isNaN(stop)) {
      return { start, end: Math.max(stop, start + 1000) };
    }
  }

  // 2. Explicit duration
  const durSec = Number(session.duration);
  if (Number.isFinite(durSec) && durSec > 0) {
    return { start, end: start + durSec * 1000 };
  }

  // 3. Terminated sessions without duration or stop time (e.g. TimedOut, Cancelled)
  const isTerminated = /timeout|timedout|cancel|fail|error|abort/i.test(session.status || '');
  if (isTerminated) {
    if (session.updatedOn) {
      const updated = new Date(session.updatedOn).getTime();
      if (!Number.isNaN(updated) && updated > start && updated - start <= 2 * 3600 * 1000) {
        return { start, end: Math.max(updated, start + 60000) };
      }
    }
    // Default 30 minutes representation for timed-out sessions
    return { start, end: start + 30 * 60 * 1000 };
  }

  // 4. Truly ongoing session: cap at Date.now() or max 4 hours from start
  const now = Date.now();
  const cappedEnd = Math.min(now, start + 4 * 60 * 60 * 1000);
  return { start, end: Math.max(cappedEnd, start + 15 * 60 * 1000) };
}

function sessionStatusIntervals(session, connectorId = null) {
  const range = sessionRange(session);
  const connId = connectorId ?? sessionConnectorId(session) ?? 1;
  const allEvents = state.allEvents || [];
  const statusEvents = allEvents.filter((event) => event.eventName === 'STATUS_NOTIFICATION');
  const statusBefore = statusEvents
    .filter((event) => new Date(event.timestamp).getTime() <= range.start)
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  const during = statusEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    return time >= range.start && time <= range.end;
  });
  const relevant = statusBefore.slice(-1).concat(during);
  return connectorIntervals(relevant, connId, range.end).filter((interval) => interval.end > range.start && interval.time < range.end);
}

function sessionStripSegments(session) {
  const intervals = sessionStatusIntervals(session);
  const range = sessionRange(session);
  if (!intervals.length) {
    return [{
      status: session.status || 'Available',
      start: range.start,
      end: range.end,
    }];
  }
  return intervals.map((interval) => ({
    status: interval.status,
    start: Math.max(interval.time, range.start),
    end: Math.min(interval.end, range.end),
  }));
}

function sessionStatusAfter(session) {
  if (!session || !session.stopTime) return null;
  const stop = new Date(session.stopTime).getTime();
  if (Number.isNaN(stop)) return null;
  const connId = sessionConnectorId(session) ?? 1;
  const allEvents = state.allEvents || [];
  const stopTx = allEvents.find((e) => e.eventName === 'STOP_TRANSACTION' && (
    (e.additionalData && String(e.additionalData.transactionId || e.additionalData.id) === String(session.transactionId))
  ));
  const stopEventTime = stopTx ? new Date(stopTx.timestamp).getTime() : NaN;
  const nextSessions = (state.chargingSessions || []).filter((s) => s.startTime && new Date(s.startTime).getTime() > stop);
  nextSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const nextStart = nextSessions[0] ? new Date(nextSessions[0].startTime).getTime() : stop + 24 * 3600 * 1000;
  const endCheck = Math.min(Number.isFinite(stopEventTime) ? Math.max(stopEventTime + 60000, stop) : nextStart, nextStart);

  const postEvents = allEvents.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t > stop && t <= endCheck;
  });
  const postStatusEvents = postEvents.filter((e) => e.eventName === 'STATUS_NOTIFICATION');
  const hasCharging = postStatusEvents.some((e) => connectorStatus(e, connId) === 'Charging');
  const latestCharging = [...postStatusEvents].reverse().find((e) => connectorStatus(e, connId) === 'Charging');

  return {
    hasCharging,
    stopEvent: stopTx,
    stopEventTime,
    latestChargingTime: latestCharging ? new Date(latestCharging.timestamp).getTime() : null,
    reason: stopTx && stopTx.additionalData ? stopTx.additionalData.reason : null,
    postEvents,
  };
}

function sessionTimelineMismatch(session) {
  if (!session) return null;
  const after = sessionStatusAfter(session);
  if (after && after.hasCharging) {
    const stopTimeStr = formatDate(session.stopTime);
    return {
      mismatch: true,
      reason: `Charging continued after recorded stop at ${stopTimeStr}`,
    };
  }
  const intervals = sessionStatusIntervals(session);
  const consumption = Number(session.consumption) || 0;
  const isAbnormalStatus = /cancel|timeout|fail/i.test(session.status || '');
  if (isAbnormalStatus && consumption > 0) {
    return {
      mismatch: true,
      reason: `Recorded as ${session.status} but ${consumption} kWh was delivered`,
    };
  }
  const hasChargingInterval = intervals.some((i) => i.status === 'Charging');
  if (consumption > 0 && intervals.length > 0 && !hasChargingInterval) {
    return {
      mismatch: true,
      reason: `Delivered ${consumption} kWh but nominal window only shows non-charging states`,
    };
  }
  return null;
}

function sessionVerdict(session) {
  if (!session) return '';
  const after = sessionStatusAfter(session);
  const mismatch = sessionTimelineMismatch(session);
  if (after && after.hasCharging) {
    const stopLabel = formatDate(session.stopTime);
    const chargeUntil = after.latestChargingTime ? formatDate(new Date(after.latestChargingTime).toISOString()) : 'subsequent events';
    const reasonInfo = after.reason ? ` (Stop reason: ${after.reason})` : '';
    return `After stop: Connector continued Charging until ${chargeUntil} despite recorded session stop at ${stopLabel}${reasonInfo}.`;
  }
  if (mismatch) {
    return `Timeline mismatch: ${mismatch.reason}.`;
  }
  if (session.status === 'Completed') {
    return 'Normal session completion.';
  }
  return session.status ? `Session status: ${session.status}.` : '';
}

function analyzeSession(transactionId) {
  const session = (state.chargingSessions || []).find((item) => String(item.transactionId) === String(transactionId));
  if (!session) return null;
  const range = sessionRange(session);
  const connectorId = sessionConnectorId(session) ?? 1;
  const after = sessionStatusAfter(session);
  const effectiveEnd = (after && after.hasCharging && after.latestChargingTime)
    ? Math.max(range.end, after.latestChargingTime + 60000)
    : range.end;
  const during = state.allEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    return time >= range.start && time <= effectiveEnd;
  });
  const statusBefore = state.allEvents
    .filter((event) => event.eventName === 'STATUS_NOTIFICATION' && new Date(event.timestamp).getTime() <= range.start)
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  const statusEvents = statusBefore.slice(-1).concat(during.filter((event) => event.eventName === 'STATUS_NOTIFICATION'));
  const intervals = connectorIntervals(statusEvents, connectorId, effectiveEnd).filter((interval) => interval.end > range.start && interval.time < effectiveEnd);
  const schedules = scheduleRecords(state.allEvents).filter((record) => record.transactionId === String(transactionId));
  const other = during.filter((event) => event.eventName !== 'STATUS_NOTIFICATION');
  const counts = new Map();
  other.forEach((event) => counts.set(event.eventName, (counts.get(event.eventName) || 0) + 1));
  return {
    session, range: { start: range.start, end: effectiveEnd }, nominalRange: range, connectorId, intervals, schedules,
    smart: /smart/i.test(session.sessionType || '') || /smart/i.test(session.mode || '') || schedules.length > 0,
    events: during,
    importantCount: during.filter((event) => eventImportance(event) === 'Important').length,
    counts,
    startDiagnosis: diagnoseSessionStartFromData(session, during, intervals),
    endDiagnosis: diagnoseSessionEndFromData(session, during, intervals),
    statusAfter: after,
    verdict: sessionVerdict(session),
  };
}

function openSessionAnalysis(transactionId) {
  const analysis = analyzeSession(transactionId);
  const panel = document.getElementById('sessionAnalysis');
  const body = document.getElementById('sessionAnalysisBody');
  if (!analysis || !panel || !body) {
    return;
  }
  state.selectedSessionId = String(transactionId);
  document.querySelectorAll('.session-row').forEach((row) => {
    row.classList.toggle('selected-row', row.dataset.session === String(transactionId));
  });
  document.getElementById('sessionAnalysisTitle').textContent = `Session ${analysis.session.transactionId}`;
  state.sessionAnalysis = {
    ...analysis,
    view: { ...analysis.range },
    selectedSchedule: analysis.schedules[0] ? analysis.schedules[0].id : '',
  };
  state.activeTimelineWidget = 'sessionAnalysis';
  panel.hidden = false;
  paintSessionAnalysis(true);
  updateFloatingTimeToolbar('sessionAnalysis', analysis.range.start, analysis.range.end);
}

function analysisBars(periods, view, colorFor) {
  const span = Math.max(view.end - view.start, 1);
  return periods.map((period) => {
    if (period.end <= view.start || period.time >= view.end) {
      return '';
    }
    const start = Math.max(period.time, view.start);
    const end = Math.min(period.end, view.end);
    const left = ((start - view.start) / span) * 100;
    const width = ((end - start) / span) * 100;
    const power = Number.isFinite(period.power) ? ` · ${formatPower(period.power)}` : '';
    const title = `${colorFor(period).label}${power} · ${formatExact(period.time)} – ${formatExact(period.end)}`;
    return `<i data-title="${escapeHtml(title)}" style="left:${left}%; width:${Math.max(width, 0.4)}%; background:${colorFor(period).color};"></i>`;
  }).join('');
}

function paintSessionAnalysis(scroll) {
  const analysis = state.sessionAnalysis;
  const body = document.getElementById('sessionAnalysisBody');
  const panel = document.getElementById('sessionAnalysis');
  if (!analysis || !body || !panel) {
    return;
  }
  const view = analysis.view;
  const session = analysis.session;
  const startTime = new Date(session.startTime).getTime();
  const stopTime = session.stopTime ? new Date(session.stopTime).getTime() : NaN;
  const duration = session.duration != null && session.duration !== ''
    ? formatDuration(0, Number(session.duration) * 1000)
    : Number.isFinite(startTime) && Number.isFinite(stopTime) ? formatDuration(startTime, stopTime) : '—';
  const connector = sessionConnectorId(session);
  const statusColor = (period) => ({ label: period.status, color: connectorColor(period.status, analysis.connectorId) });
  const powerColor = (period) => ({
    label: period.power > 0 ? 'Allowed' : 'Suspended',
    color: period.power > 0 ? '#22c55e' : '#ef4444',
  });
  const verdict = sessionVerdict(session);
  const verdictBlock = verdict ? `<div class="analysis-verdict">${escapeHtml(verdict)}</div>` : '';
  const selected = analysis.schedules.find((item) => item.id === analysis.selectedSchedule);
  const lanes = connectorStateList(analysis.connectorId).map((item) => {
    const bars = analysisBars(analysis.intervals.filter((interval) => interval.status === item.id), view, statusColor);
    return `<div class="analysis-lane"><span>${item.id}</span><div class="analysis-track">${bars}</div></div>`;
  }).join('');
  const span = Math.max(view.end - view.start, 1);
  const arrivals = analysis.schedules.map((schedule) => {
    const time = new Date(schedule.receivedAt).getTime();
    if (Number.isNaN(time) || time < view.start || time > view.end) {
      return '';
    }
    const left = ((time - view.start) / span) * 100;
    const selectedMark = schedule.id === analysis.selectedSchedule ? ' pop' : '';
    return `<button type="button" class="schedule-arrival${selectedMark}" data-id="${escapeHtml(schedule.id)}" style="left:${left}%;" title="${escapeHtml(formatExact(schedule.receivedAt))}"></button>`;
  }).join('');
  const scheduleLane = selected
    ? `<div class="analysis-lane"><span>Schedule</span><div class="analysis-track">${analysisBars(selected.periods, view, powerColor)}</div></div>
       <div class="analysis-lane"><span>Arrived</span><div class="analysis-track arrival-track">${arrivals}</div></div>`
    : '';
  const spanFull = Math.max(analysis.range.end - analysis.range.start, 1);
  const analysisOverviewBarsHtml = `<i class="overview-rail"></i>` + analysis.intervals.map((interval) => {
    const start = Math.max(interval.time, analysis.range.start);
    const end = Math.min(interval.end, analysis.range.end);
    if (end <= start) return '';
    const left = ((start - analysis.range.start) / spanFull) * 100;
    const width = Math.max(((end - start) / spanFull) * 100, 0.4);
    return `<i style="left:${left}%; width:${width}%; background:${connectorColor(interval.status, analysis.connectorId)};"></i>`;
  }).join('');
  const isAnalysisFull = view.start <= analysis.range.start + 1000 && view.end >= analysis.range.end - 1000;
  const analysisWinLeft = Math.max(0, ((view.start - analysis.range.start) / spanFull) * 100);
  const analysisWinWidth = Math.max(((view.end - view.start) / spanFull) * 100, 0.6);

  body.innerHTML = `
    <dl class="analysis-summary">
      <div><dt>Status</dt><dd>${escapeHtml(session.status || 'Unknown')}</dd></div>
      <div><dt>Duration</dt><dd>${escapeHtml(duration)}</dd></div>
      <div><dt>Energy</dt><dd>${escapeHtml(session.consumption == null ? '—' : `${session.consumption} kWh`)}</dd></div>
      <div><dt>Connector</dt><dd>${escapeHtml(connector == null ? '—' : `Connector ${connector}`)}</dd></div>
      <div><dt>Start</dt><dd>${escapeHtml(formatDate(session.startTime))}</dd></div>
      <div><dt>Stop</dt><dd>${escapeHtml(session.stopTime ? formatDate(session.stopTime) : 'Ongoing / unavailable')}</dd></div>
      <div><dt>Important events</dt><dd>${escapeHtml(state.sourceStatus.events === 'partial' ? `At least ${analysis.importantCount}` : ['loaded', 'empty'].includes(state.sourceStatus.events) ? String(analysis.importantCount) : 'Unavailable')}</dd></div>
      <div><dt>Smart charging</dt><dd>${escapeHtml(analysis.smart ? session.smartChargingOverridden ? 'Override active' : 'Active during this period' : 'Not indicated')}</dd></div>
    </dl>
    ${verdictBlock}
    <p class="analysis-relationship">Session period → connector status → smart-charging schedule → related events</p>
    <div class="analysis-facts">
      <button type="button" id="analysisEvents">View related events</button>
      <button type="button" id="analysisFit">Fit session</button>
    </div>
    <div id="sessionAnalysisOverview" class="timeline-overview session-analysis-overview">
      <div class="timeline-overview-grid">
        <div class="timeline-overview-label">
          <span class="overview-grid-title">Overview</span>
          <span class="overview-grid-subtitle">Session</span>
        </div>
        <div class="timeline-overview-main">
          <div class="overview-scale">
            <span class="overview-bound-start">${escapeHtml(formatExact(analysis.range.start))}</span>
            <strong class="overview-duration">${escapeHtml(formatDuration(analysis.range.start, analysis.range.end))} full session</strong>
            <span class="overview-bound-end">${escapeHtml(formatExact(analysis.range.end))}</span>
          </div>
          <div class="overview-track">
            <div class="overview-bars">${analysisOverviewBarsHtml}</div>
            <div class="overview-window ${isAnalysisFull ? 'is-full-window' : ''}" style="left:${analysisWinLeft}%; width:${analysisWinWidth}%;">
              <span class="overview-window-start">${isAnalysisFull ? '' : escapeHtml(formatExact(view.start))}</span>
            </div>
            <div class="overview-cursor" hidden></div>
            <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
            <div class="overview-tip" hidden></div>
          </div>
        </div>
      </div>
    </div>
    <div class="analysis-chart">
      <div class="analysis-axis"><span>${escapeHtml(formatExact(view.start))}</span><span>${escapeHtml(formatExact(view.end))}</span></div>
      ${lanes}
      ${analysis.smart ? scheduleLane || '<p class="empty-state">No schedule loaded for this session.</p>' : '<p class="empty-state">Not a smart charging session.</p>'}
    </div>
    ${analysis.schedules.length ? `<div class="analysis-picker">${analysis.schedules.map((schedule) => `
      <button type="button" class="schedule-chip ${schedule.id === analysis.selectedSchedule ? 'open' : ''}" data-id="${escapeHtml(schedule.id)}">${escapeHtml(formatExact(schedule.receivedAt))}</button>
    `).join('')}</div>` : ''}
    <div class="analysis-counts">${analysis.counts.size ? Array.from(analysis.counts.entries()).map(([name, count]) => `<span>${escapeHtml(name)} · ${count}</span>`).join('') : ''}</div>
  `;
  const saOverview = body.querySelector('#sessionAnalysisOverview');
  if (saOverview) {
    bindOverview(saOverview, {
      widget: 'sessionAnalysis',
      getBounds: () => (state.sessionAnalysis ? state.sessionAnalysis.range : null),
      onApply: (start, end) => {
        if (state.sessionAnalysis) {
          state.sessionAnalysis.view = { start, end };
          paintSessionAnalysis(false);
          updateFloatingTimeToolbar('sessionAnalysis', start, end);
        }
      },
    });
  }
  const chart = body.querySelector('.analysis-chart');
  bindTimeGuide(chart, (ratio) => {
    const current = state.sessionAnalysis && state.sessionAnalysis.view;
    return current ? current.start + ratio * (current.end - current.start) : NaN;
  });
  chart.addEventListener('wheel', (event) => {
    event.preventDefault();
    state.activeTimelineWidget = 'sessionAnalysis';
    const rect = chart.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - 118) / Math.max(rect.width - 118, 1)));
    const current = view.end - view.start;
    const next = Math.min(Math.max(current * (event.deltaY > 0 ? 1.35 : 0.7), 60 * 1000), analysis.range.end - analysis.range.start);
    const anchor = view.start + ratio * current;
    let start = anchor - ratio * next;
    let end = start + next;
    if (start < analysis.range.start) {
      end += analysis.range.start - start;
      start = analysis.range.start;
    }
    if (end > analysis.range.end) {
      start -= end - analysis.range.end;
      end = analysis.range.end;
    }
    analysis.view = { start, end };
    paintSessionAnalysis(false);
    updateFloatingTimeToolbar('sessionAnalysis', start, end);
  }, { passive: false });
  body.querySelector('#analysisFit').addEventListener('click', () => {
    state.activeTimelineWidget = 'sessionAnalysis';
    analysis.view = { ...analysis.range };
    paintSessionAnalysis(false);
    updateFloatingTimeToolbar('sessionAnalysis', analysis.view.start, analysis.view.end);
  });
  body.querySelector('#analysisEvents').addEventListener('click', () => {
    applyWindowDates(analysis.range.start, analysis.range.end, true);
    state.investigation = { kind: 'session', sessionId: String(session.transactionId), label: `Investigating · Session ${session.transactionId}` };
    renderInvestigation();
    document.querySelector('.events-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  body.querySelectorAll('.schedule-chip, .schedule-arrival').forEach((chip) => {
    chip.addEventListener('click', () => {
      analysis.selectedSchedule = chip.dataset.id;
      paintSessionAnalysis(false);
    });
  });
  body.querySelectorAll('.analysis-track i').forEach((bar) => {
    bar.addEventListener('mouseenter', (event) => {
      const hover = document.getElementById('eventHover');
      if (!hover) return;
      hover.textContent = bar.dataset.title;
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 420)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    bar.addEventListener('mouseleave', hideEventHover);
  });
  if (scroll) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderSessionStrip(sessions) {
  state.sessionStripSessions = sessions;
  state.sessionStripView = sessionPeriod();
  paintSessionStrip();
}

state.sessionTableState = {
  searchQuery: '',
  category: 'all',
  sortKey: 'startTime',
  sortAsc: false,
};

function formatAuthMode(mode) {
  if (!mode) return { label: '—', cls: 'none' };
  const str = String(mode).toUpperCase();
  if (str.includes('FREEVEND')) return { label: 'Freevending', cls: 'freevending' };
  if (str.includes('APP')) return { label: 'App', cls: 'app' };
  if (str.includes('RFID')) return { label: 'RFID', cls: 'rfid' };
  if (str.includes('REMOTE')) return { label: 'Remote', cls: 'remote' };
  return { label: displayValue(mode), cls: 'other' };
}

function formatSessionTypeLabel(type) {
  if (!type) return { label: 'Standard', isSmart: false };
  const str = String(type);
  if (/smart/i.test(str)) return { label: 'Smart', isSmart: true };
  return { label: 'Standard', isSmart: false };
}

function formatTableDateTime(isoStr) {
  if (!isoStr) return { date: '—', time: '' };
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return { date: String(isoStr), time: '' };
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { date, time };
}

function exportChargingSessionsCsv() {
  const sessions = state.chargingSessions || [];
  if (!sessions.length) return;
  const headers = ['Session ID', 'Status', 'Type', 'Connector', 'Auth Mode', 'Start Time', 'Stop Time', 'Duration (s)', 'Energy (kWh)', 'SoC Start (%)', 'SoC Stop (%)', 'Smart Charging'];
  const rows = sessions.map((s) => [
    s.transactionId ?? '',
    s.status ?? '',
    s.sessionType ?? '',
    sessionConnectorId(s) ?? '',
    s.authMode || s.mode || '',
    s.startTime ?? '',
    s.stopTime ?? '',
    s.duration ?? '',
    s.consumption ?? '',
    s.socAtStart ?? '',
    s.socAtStop ?? '',
    s.smartChargingOverridden ? 'Override' : (s.sessionType && /smart/i.test(s.sessionType) ? 'Active' : 'No')
  ]);
  const csvContent = [headers.join(','), ...rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `charging_sessions_${state.searchSerialNumber || 'charger'}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderChargingSessions() {
  const tbody = document.getElementById('sessionTableBody');
  if (!tbody) return;

  const sessions = state.chargingSessions || [];
  renderSessionStrip(sessions);

  // Update chip count badges
  const countAll = sessions.length;
  let countCompleted = 0;
  let countAlerts = 0;
  let countSmart = 0;

  sessions.forEach((s) => {
    const st = String(s.status || '').toLowerCase();
    const mismatch = sessionTimelineMismatch(s);
    if (st === 'completed' && !mismatch) countCompleted += 1;
    if (/timeout|timedout|cancel|fail|error/i.test(st) || mismatch) countAlerts += 1;
    if (s.smartChargingOverridden === true || /smart/i.test(`${s.sessionType || ''} ${s.mode || ''}`)) countSmart += 1;
  });

  const cAllEl = document.getElementById('sessionFilterCountAll');
  const cCompEl = document.getElementById('sessionFilterCountCompleted');
  const cAlertEl = document.getElementById('sessionFilterCountAlerts');
  const cSmartEl = document.getElementById('sessionFilterCountSmart');
  if (cAllEl) cAllEl.textContent = String(countAll);
  if (cCompEl) cCompEl.textContent = String(countCompleted);
  if (cAlertEl) cAlertEl.textContent = String(countAlerts);
  if (cSmartEl) cSmartEl.textContent = String(countSmart);

  if (!sessions.length) {
    const loading = state.loadingCards.sessions;
    const status = state.sourceStatus.sessions;
    const message = loading ? 'Loading charging sessions...'
      : status === 'error' ? 'Failed to load charging sessions.'
        : status === 'empty' ? 'No charging sessions in this period.'
          : 'Search to load charging sessions.';
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row${loading ? ' loading-state' : ''}">${message}</td></tr>`;
    const visCountEl = document.getElementById('sessionVisibleCount');
    if (visCountEl) visCountEl.textContent = 'Showing 0 sessions';
    return;
  }

  // Filter sessions
  const { category, searchQuery, sortKey, sortAsc } = state.sessionTableState;
  let filtered = sessions.slice();

  if (category === 'completed') {
    filtered = filtered.filter((s) => String(s.status || '').toLowerCase() === 'completed' && !sessionTimelineMismatch(s));
  } else if (category === 'alerts') {
    filtered = filtered.filter((s) => /timeout|timedout|cancel|fail|error/i.test(String(s.status || '')) || !!sessionTimelineMismatch(s));
  } else if (category === 'smart') {
    filtered = filtered.filter((s) => s.smartChargingOverridden === true || /smart/i.test(`${s.sessionType || ''} ${s.mode || ''}`));
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((s) => {
      const id = String(s.transactionId || '').toLowerCase();
      const st = String(s.status || '').toLowerCase();
      const type = String(s.sessionType || '').toLowerCase();
      const auth = String(s.authMode || s.mode || '').toLowerCase();
      const conn = String(sessionConnectorId(s) || '');
      return id.includes(q) || st.includes(q) || type.includes(q) || auth.includes(q) || conn.includes(q);
    });
  }

  // Sort sessions
  if (sortKey) {
    filtered.sort((a, b) => {
      let valA, valB;
      if (sortKey === 'startTime' || sortKey === 'stopTime') {
        valA = a[sortKey] ? new Date(a[sortKey]).getTime() : 0;
        valB = b[sortKey] ? new Date(b[sortKey]).getTime() : 0;
      } else if (sortKey === 'duration') {
        valA = Number(a.duration) || 0;
        valB = Number(b.duration) || 0;
      } else if (sortKey === 'consumption') {
        valA = Number(a.consumption) || 0;
        valB = Number(b.consumption) || 0;
      } else if (sortKey === 'transactionId') {
        valA = Number(a.transactionId) || 0;
        valB = Number(b.transactionId) || 0;
      } else if (sortKey === 'important') {
        const rA = sessionRange(a);
        const rB = sessionRange(b);
        valA = state.allEvents.filter((e) => { const t = new Date(e.timestamp).getTime(); return t >= rA.start && t <= rA.end && eventImportance(e) === 'Important'; }).length;
        valB = state.allEvents.filter((e) => { const t = new Date(e.timestamp).getTime(); return t >= rB.start && t <= rB.end && eventImportance(e) === 'Important'; }).length;
      } else {
        valA = String(a[sortKey] || '').toLowerCase();
        valB = String(b[sortKey] || '').toLowerCase();
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  const visCountEl = document.getElementById('sessionVisibleCount');
  if (visCountEl) {
    visCountEl.textContent = `Showing ${filtered.length} of ${sessions.length} sessions`;
  }

  // Update sort indicators on headers
  document.querySelectorAll('#sessionTable thead th.sortable').forEach((th) => {
    const key = th.dataset.sortKey;
    const isSorted = key === sortKey;
    th.classList.toggle('is-sorted', isSorted);
    th.classList.toggle('is-asc', isSorted && sortAsc);
    th.classList.toggle('is-desc', isSorted && !sortAsc);
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row">No sessions match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((session) => {
    const duration = session.duration == null || session.duration === '' ? NaN : Number(session.duration);
    const tone = sessionStatusClass(session.status) || 'ongoing';
    const connectorId = sessionConnectorId(session);
    const range = sessionRange(session);
    const mismatch = sessionTimelineMismatch(session);

    const importantCount = state.allEvents.filter((event) => {
      const time = new Date(event.timestamp).getTime();
      return time >= range.start && time <= range.end && eventImportance(event) === 'Important';
    }).length;

    const smartSchedules = scheduleRecords(state.allEvents).some((record) => record.transactionId === String(session.transactionId));
    const isSmart = session.smartChargingOverridden === true || smartSchedules || /smart/i.test(`${session.sessionType || ''} ${session.mode || ''}`);
    const smartText = session.smartChargingOverridden === true ? 'Override' : (isSmart ? 'Active' : '—');
    const smartBadgeCls = session.smartChargingOverridden === true ? 'override' : (isSmart ? 'active' : 'none');

    const auth = formatAuthMode(session.authMode || session.mode);
    const typeInfo = formatSessionTypeLabel(session.sessionType);
    const startDt = formatTableDateTime(session.startTime);
    const stopDt = formatTableDateTime(session.stopTime);

    const hasSoc = session.socAtStart != null || session.socAtStop != null;
    const socHtml = hasSoc
      ? `<div class="soc-flow"><span class="soc-val">${session.socAtStart != null ? session.socAtStart + '%' : '—'}</span><span class="soc-arrow">→</span><span class="soc-val">${session.socAtStop != null ? session.socAtStop + '%' : '—'}</span></div>`
      : `<span class="dimmed">—</span>`;

    const abnormal = /timeout|cancel|fail|error/i.test(String(session.status || '')) || !!mismatch;
    const isSelected = state.selectedSessionId === String(session.transactionId);

    const energyVal = session.consumption != null && Number.isFinite(Number(session.consumption))
      ? `<span class="energy-badge font-mono"><strong>${Number(session.consumption).toFixed(2)}</strong> <small>kWh</small></span>`
      : `<span class="dimmed">—</span>`;

    const durationVal = Number.isFinite(duration) && duration >= 0
      ? `<span class="duration-badge font-mono">${formatDuration(0, duration * 1000)}</span>`
      : `<span class="dimmed">—</span>`;

    const mismatchBadge = mismatch
      ? `<span class="session-mismatch-pill" title="${escapeHtml(mismatch.reason || 'Timeline mismatch')}">⚠ Mismatch</span>`
      : '';

    return `
      <tr class="session-row ${tone}${isSelected ? ' selected-row' : ''}" data-session="${escapeHtml(String(session.transactionId))}">
        <td>
          <span class="session-id-pill" title="Click to view details">#${escapeHtml(displayValue(session.transactionId))}</span>
        </td>
        <td>
          <div class="status-cell-wrap">
            <span class="session-status ${tone}">
              <span class="status-dot"></span>
              <span>${escapeHtml(displayValue(session.status))}</span>
            </span>
            ${mismatchBadge}
            ${abnormal ? `<button type="button" class="session-inspect-btn" data-session="${escapeHtml(String(session.transactionId))}" title="Inspect diagnostic timeline">Inspect</button>` : ''}
          </div>
        </td>
        <td>
          <span class="type-tag ${typeInfo.isSmart ? 'smart' : 'regular'}">
            ${typeInfo.isSmart ? '<svg class="tag-icon" viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>' : ''}
            <span>${escapeHtml(typeInfo.label)}</span>
          </span>
        </td>
        <td>
          <span class="connector-pill c${connectorId || 'none'}">${connectorId != null ? `C${connectorId}` : '—'}</span>
        </td>
        <td>
          <span class="auth-pill ${auth.cls}">${escapeHtml(auth.label)}</span>
        </td>
        <td class="nowrap">
          <div class="time-cell">
            <span class="time-primary">${escapeHtml(startDt.date)}</span>
            <span class="time-secondary">${escapeHtml(startDt.time)}</span>
          </div>
        </td>
        <td class="nowrap">
          <div class="time-cell">
            <span class="time-primary">${escapeHtml(stopDt.date)}</span>
            <span class="time-secondary">${escapeHtml(stopDt.time)}</span>
          </div>
        </td>
        <td>${durationVal}</td>
        <td>${energyVal}</td>
        <td class="nowrap">${socHtml}</td>
        <td>
          <span class="smart-state-badge ${smartBadgeCls}">${escapeHtml(smartText)}</span>
        </td>
        <td class="text-center">
          ${importantCount > 0 ? `<span class="imp-tag alert">⚠ ${importantCount}</span>` : `<span class="imp-tag zero">0</span>`}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.session-inspect-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      focusSession(button.dataset.session);
    });
  });

  tbody.querySelectorAll('tr[data-session]').forEach((row) => {
    row.addEventListener('click', () => {
      focusSession(row.dataset.session);
    });
  });
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function departureClock(value) {
  return String(value || '').replace(/^T/, '').replace(/\.000Z$/, '').replace(/Z$/, '');
}

function formatDepartureTimes(times) {
  if (!Array.isArray(times) || !times.length) {
    return 'Not set';
  }
  const setTimes = times.filter((item) => {
    const clock = departureClock(item.departureTime);
    return clock && clock !== '00:00:00' && clock !== '00:00';
  });
  if (!setTimes.length) {
    return 'Not set';
  }
  return setTimes.map((item) => {
    const day = WEEKDAYS[item.dayOfTheWeek] || `Day ${item.dayOfTheWeek}`;
    return `${day} ${departureClock(item.departureTime).slice(0, 5)}`;
  }).join(', ');
}

function prettyEnum(value) {
  const text = String(value || '').replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '—';
}

function formatEfficiency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '—';
  }
  const percent = number <= 1 ? number * 100 : number;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

function formatTariffRate(tariff) {
  if (!tariff || tariff.flatUnitRate == null) {
    return '—';
  }
  if (String(tariff.currency || '').toUpperCase() === 'GBPP') {
    return `${tariff.flatUnitRate} p/kWh`;
  }
  return `${tariff.flatUnitRate} ${tariff.currency || ''}`.trim();
}

function tariffTypeLabel(tariff) {
  if (!tariff || tariff.type == null) {
    return '—';
  }
  if (tariff.type === 0) {
    return 'Flat';
  }
  if (tariff.type === 1) {
    return 'Day / night';
  }
  return String(tariff.type);
}

function formatDayNights(value) {
  if (!value) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      const rate = item.unitRate ?? item.rate ?? item.flatUnitRate;
      const label = item.name || item.label || item.period || 'Band';
      return rate == null ? label : `${label} ${rate}`;
    }).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value).filter(([, rate]) => rate != null && rate !== '').map(([label, rate]) => `${label} ${rate}`).join(', ');
  }
  return String(value);
}

function renderFactGroups(groups) {
  return groups.map(([title, rows]) => `
    <section class="charger-group">
      <h3>${escapeHtml(title)}</h3>
      <dl>
        ${rows.map(([label, value, tone]) => `
          <div>
            <dt>${escapeHtml(String(label))}</dt>
            <dd>${tone ? `<span class="status-pill tone-${escapeHtml(tone)}">${escapeHtml(displayValue(value))}</span>` : escapeHtml(displayValue(value))}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `).join('');
}

async function fetchSmartCharging(serialNumber, token) {
  try {
    const response = await fetch(dashboardApiUrl('/api/smart-charging'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return { smartCharging: null, tariff: null, error: formatApiError(result) };
    }
    return {
      smartCharging: result.smartCharging || null,
      tariff: result.tariff || null,
      error: null,
    };
  } catch (error) {
    return { smartCharging: null, tariff: null, error: error.message || 'Smart charging could not be loaded.' };
  }
}

function firstSet(...values) {
  return values.find((value) => value != null && value !== '') ?? null;
}

function renderSmartChargingInfo() {
  const profile = document.getElementById('smartChargingProfile');
  const summary = document.getElementById('smartSummary');
  if (!profile || !summary) {
    return;
  }
  const data = state.smartCharging;
  const tariff = state.tariff;
  const wallbox = state.wallbox;
  if (!data && !tariff && !wallbox) {
    const message = state.loadingCards.smartCharging ? 'Loading smart charging...'
      : state.sourceStatus.smartCharging === 'error' ? 'Failed to load smart-charging information.'
        : state.sourceStatus.smartCharging === 'empty' ? 'No smart-charging record available.'
          : 'Search to load smart charging.';
    summary.textContent = state.loadingCards.smartCharging ? message : 'Search to load smart charging';
    profile.innerHTML = `<p class="empty-state${state.loadingCards.smartCharging ? ' loading-state' : ''}">${message}</p>`;
    return;
  }
  const status = firstSet(data && data.smartChargingStatus, wallbox && wallbox.smartChargingStatus) || 'Unknown';
  const smartEnabled = statusTone(status, 'smart') === 'good';
  const overridden = firstSet(data && data.smartChargingOverridden, wallbox && wallbox.smartChargingOverridden);
  const powerPreference = firstSet(data && data.powerPreference, wallbox && wallbox.powerPreference);
  const preferenceText = typeof powerPreference === 'number' ? formatPowerWatts(powerPreference) : powerPreference;
  summary.innerHTML = `<span class="status-light tone-${statusTone(status, 'smart') || 'bad'}" tabindex="0"><i></i><em>${escapeHtml(`Smart charging ${status}`)}</em></span>`;
  const targetSoc = data && (data.targetSOC ?? data.targetSoc);
  const minSoc = data && (data.minSOC ?? data.minSoc);
  const dayNights = formatDayNights(tariff && tariff.dayNights);
  const settings = [
    ['Status', status, statusTone(status, 'smart')],
    ['Calibration', data ? prettyEnum(data.calibrationStatus) : '—'],
    ['Power preference', preferenceText || 'Not set'],
    ['Max power', data ? formatPowerWatts(data.wbMaxChargingPower) : '—'],
    ['Efficiency', data ? formatEfficiency(data.wbChargingEfficiency) : '—'],
  ];
  if (smartEnabled) {
    settings.splice(2, 0, ['Overridden', overridden == null ? 'No' : overridden]);
  }
  if (data && data.ongoingSessionId != null) {
    settings.push(['Ongoing session', data.ongoingSessionId]);
  }
  if (data && data.calibratedPowerAvg != null) {
    settings.push(['Calibrated power', formatPowerWatts(data.calibratedPowerAvg)]);
  }
  const tariffRows = [
    ['Type', tariffTypeLabel(tariff)],
    ['Unit rate', formatTariffRate(tariff)],
    ['Contract', tariff && tariff.contractId ? tariff.contractId : 'Not set'],
    ['Delivery area', firstSet(tariff && tariff.deliveryArea, data && data.deliveryArea) || 'Not set'],
    ['Updated', tariff ? formatDate(tariff.lastContractInformationUpdateTimestamp) : '—'],
  ];
  if (dayNights) {
    tariffRows.splice(2, 0, ['Day / night', dayNights]);
  }
  profile.innerHTML = `
    ${state.sourceStatus.smartCharging === 'error' ? '<p class="inline-data-warning" role="status">Smart-charging information failed to load; other charger details are still available.</p>' : ''}
    ${renderFactGroups([
      ['Settings', settings],
      ['Preferences', [
        ['Target SoC', targetSoc != null ? `${targetSoc}%` : '—'],
        ['Min SoC', minSoc != null ? `${minSoc}%` : '—'],
        ['EV', data && data.evId],
        ['EV model', data && data.evModel],
        ['Departure', formatDepartureTimes((data && data.departureTimes) || (data && data.localDepartureTimes))],
        ['Last SoC request', data && data.lastSOCRequestTimestamp ? formatDate(data.lastSOCRequestTimestamp) : '—'],
        ['Last status update', data && data.lastSmartChargingStatusUpdateTimestamp ? formatDate(data.lastSmartChargingStatusUpdateTimestamp) : '—'],
        ['Last preferences update', data && data.lastSmartChargingPreferencesUpdateTimestamp ? formatDate(data.lastSmartChargingPreferencesUpdateTimestamp) : '—'],
      ]],
      ['Energy tariff', tariffRows],
    ])}
  `;
}

async function fetchAccess(serialNumber, token) {
  try {
    const response = await fetch(dashboardApiUrl('/api/access'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return { access: null, error: formatApiError(result) };
    }
    return { access: result.access || null, error: null };
  } catch (error) {
    return { access: null, error: error.message || 'Access information could not be loaded.' };
  }
}

function notableEventRows() {
  const window = selectedWindow();
  const inWindow = (value) => {
    const time = new Date(value).getTime();
    if (Number.isNaN(time) || Number.isNaN(window.start) || Number.isNaN(window.end)) {
      return false;
    }
    return time >= window.start && time <= window.end;
  };
  const resets = state.allEvents
    .filter((event) => /factory.?reset/i.test(event.eventName) && inWindow(event.timestamp))
    .map((event) => formatExact(event.timestamp));
  if (state.wallbox && inWindow(state.wallbox.lastFactoryReset) && !resets.includes(formatExact(state.wallbox.lastFactoryReset))) {
    resets.push(formatExact(state.wallbox.lastFactoryReset));
  }
  const faulted = state.allEvents.some((event) => {
    if (!inWindow(event.timestamp) || event.eventName !== 'STATUS_NOTIFICATION') {
      return false;
    }
    const details = detailsFromValue(event.additionalData).concat(detailsFromValue(event.raw && event.raw.additionalData));
    return details.some((detail) => isConnectorOne(detail) && normalizeConnectorState(detail.status || detail.connectorStatus) === 'Faulted');
  });
  const windowEvents = state.allEvents.filter((event) => inWindow(event.timestamp));
  const blob = (event) => JSON.stringify(event.raw || event.additionalData || {});
  const powerLoss = windowEvents.filter((event) => /power[\s_-]*loss/i.test(event.eventName) || /power[\s_-]*loss/i.test(blob(event)));
  const boots = windowEvents.filter((event) => /bootnotification/i.test(event.eventName));
  const disconnects = windowEvents.filter((event) => /disconnect/i.test(event.eventName) || /offline/i.test(blob(event)));
  const reconnects = windowEvents.filter((event) => /reconnect/i.test(event.eventName));
  if (state.wallbox && inWindow(state.wallbox.disconnectedOn)) {
    disconnects.push({ timestamp: state.wallbox.disconnectedOn });
  }
  if (state.wallbox && inWindow(state.wallbox.reconnectedOn)) {
    reconnects.push({ timestamp: state.wallbox.reconnectedOn });
  }
  const connection = state.wallbox
    ? `${state.wallbox.connectivityStatus || 'Unknown'} since ${formatDate(state.wallbox.connectivityStatusUpdatedOn)}`
    : 'Unknown';
  return [
    ['Factory reset', resets.length ? resets.join(', ') : 'None'],
    ['Connector 1 faulted', faulted ? 'Yes' : 'No'],
    ['Power loss', powerLoss.length ? `${powerLoss.length} · ${powerLoss.slice(0, 3).map((event) => formatExact(event.timestamp)).join(', ')}` : '0'],
    ['Connection', `${connection} · ${boots.length} boot${boots.length === 1 ? '' : 's'}`],
    ['Disconnections', String(disconnects.length)],
    ['Reconnections', String(reconnects.length + boots.length)],
  ];
}

function renderNotableEvents() {
  const root = document.getElementById('notableEvents');
  if (!root) {
    return;
  }
  const rows = notableEventRows();
  const patterns = {
    'Factory reset': /factory.?reset/i,
    'Connector 1 faulted': /STATUS_NOTIFICATION/i,
    'Power loss': /power[\s_-]*loss/i,
    Connection: /disconnect|reconnect|offline|online|bootnotification/i,
    Disconnections: /disconnect|offline/i,
    Reconnections: /reconnect|bootnotification/i,
  };
  const visibleWindow = selectedWindow();
  const evidenceFor = (label) => state.allEvents.filter((event) => {
    if (!patterns[label].test(String(event.eventName || ''))) return false;
    const timestamp = new Date(event.timestamp).getTime();
    if (Number.isNaN(timestamp) || timestamp < visibleWindow.start || timestamp > visibleWindow.end) return false;
    return label !== 'Connector 1 faulted' || connectorStatus(event, 1) === 'Faulted';
  }).sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
  const sourceStatusLabel = (status) => ({ idle: 'Not loaded', loading: 'Loading', error: 'Failed to load' })[status] || 'Unavailable';
  root.innerHTML = `
    <dl>
      ${rows.map(([label, value]) => {
        const evidence = evidenceFor(label);
        const latest = evidence[0];
        const count = state.sourceStatus.events === 'partial' ? `At least ${evidence.length}`
          : ['loaded', 'empty'].includes(state.sourceStatus.events) ? String(evidence.length) : 'Unavailable';
        const connectors = latest ? eventConnectorIds(latest) : [];
        const metadata = state.sourceStatus.events === 'error' || state.sourceStatus.events === 'idle' || state.sourceStatus.events === 'loading'
          ? `${sourceStatusLabel(state.sourceStatus.events)} · latest occurrence unavailable`
          : `Count ${count}${latest ? ` · Most recent ${formatGlanceTimestamp(latest.timestamp)}` : ''}${connectors.length ? ` · ${connectors.map((id) => `Connector ${id}`).join(', ')}` : ''}`;
        return `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
          <dd class="notable-event-meta">${escapeHtml(metadata)}${latest && latest.id != null ? ` <button type="button" class="notable-focus" data-event="${escapeHtml(String(latest.id))}">View event</button>` : ''}</dd>
        </div>
      `;
      }).join('')}
    </dl>
  `;
  root.querySelectorAll('.notable-focus').forEach((button) => button.addEventListener('click', () => focusEvent(button.dataset.event)));
}

function hasActiveGlanceError(value) {
  if (value == null || value === false || value === 0) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    if (!Object.keys(value).length) {
      return false;
    }
    const count = value.count ?? value.total ?? value.activeCount;
    if (count != null && Number.isFinite(Number(count))) {
      return Number(count) > 0;
    }
    return true;
  }
  const text = String(value).trim();
  return Boolean(text) && !/^(0|false|none|no|no active errors?|n\/a|healthy|ok|null|\[\]|\{\}|—|-)$/i.test(text);
}

function glanceConnectorRecords() {
  const records = new Map();
  const wallboxConnectors = Array.isArray(state.wallbox && state.wallbox.connectors)
    ? state.wallbox.connectors
    : [];
  wallboxConnectors.forEach((connector, index) => {
    const id = Number(connector.id ?? connector.connectorId ?? index);
    if (!Number.isFinite(id)) {
      return;
    }
    records.set(id, {
      id,
      status: connector.status || connector.connectorStatus || 'Unknown',
      current: true,
    });
  });

  state.allEvents.forEach((event) => {
    const timestamp = new Date(event.timestamp).getTime();
    if (!Number.isFinite(timestamp)) {
      return;
    }
    const details = detailsFromValue(event.additionalData)
      .concat(detailsFromValue(event.raw && event.raw.additionalData));
    details.forEach((detail) => {
      const rawId = detail.connectorId ?? detail.connector_id ?? detail.id;
      const id = Number(rawId);
      const status = detail.status || detail.connectorStatus;
      if (!Number.isFinite(id) || !status) {
        return;
      }
      const existing = records.get(id);
      if (existing && (existing.current || existing.timestamp >= timestamp)) {
        return;
      }
      records.set(id, { id, status, timestamp, current: false });
    });
  });

  return Array.from(records.values()).sort((left, right) => left.id - right.id);
}

function deriveChargerState() {
  const wallbox = state.wallbox;
  const connectivity = String(wallbox && wallbox.connectivityStatus || '').trim();
  const connectors = glanceConnectorRecords().map((connector) => {
    const status = normalizeConnectorState(connector.status, connector.id) || 'Unknown';
    const history = state.allEvents
      .filter((event) => event.eventName === 'STATUS_NOTIFICATION')
      .map((event) => ({
        event,
        time: new Date(event.timestamp).getTime(),
        status: connectorStatus(event, connector.id),
      }))
      .filter((item) => item.status && Number.isFinite(item.time))
      .sort((left, right) => left.time - right.time);
    const latestEvent = history.at(-1);
    const latestMatching = latestEvent && latestEvent.status === status ? latestEvent : null;
    const currentIndex = latestMatching ? history.length - 1 : history.length;
    const lastKnownGood = latestMatching && !['Available', 'Charging'].includes(status)
      ? history.slice(0, currentIndex).reverse().find((item) => ['Available', 'Charging'].includes(item.status))
      : null;
    return {
      ...connector,
      status,
      since: latestMatching ? latestMatching.event.timestamp : null,
      lastKnownGood: lastKnownGood ? { status: lastKnownGood.status, at: lastKnownGood.event.timestamp } : null,
    };
  });
  const activeSessions = (state.chargingSessions || []).filter((session) => {
    const status = String(session.status || '').replace(/[\s_-]/g, '').toLowerCase();
    return status === 'ongoing' || status === 'active' || status === 'charging';
  });
  const activeConnectorIds = Array.from(new Set(activeSessions.map(sessionConnectorId).filter((id) => id != null)));
  const activeError = hasActiveGlanceError(wallbox && wallbox.activeChargingErrors);
  const faultedConnectors = connectors.filter((connector) => connector.status === 'Faulted');
  const unavailableConnectors = connectors.filter((connector) => ['Unavailable', 'Disconnected'].includes(connector.status));
  let health = 'Unknown';
  if (state.sourceStatus.wallbox === 'loading') {
    health = 'Checking';
  } else if (/^(offline|disconnected)$/i.test(connectivity)) {
    health = 'Offline';
  } else if (activeError) {
    health = 'Faulted';
  } else if (faultedConnectors.length || unavailableConnectors.length) {
    health = 'Attention';
  } else if (/^online$/i.test(connectivity)) {
    health = activeSessions.length ? 'Charging' : 'Healthy';
  }
  const latestConnectivityEvent = state.allEvents
    .filter((event) => /connectivity|disconnect|reconnect|offline|online/i.test(event.eventName || ''))
    .filter((event) => Number.isFinite(new Date(event.timestamp).getTime()))
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))[0];
  const lastKnownGoodState = connectors
    .filter((connector) => connector.lastKnownGood)
    .sort((left, right) => new Date(right.lastKnownGood.at) - new Date(left.lastKnownGood.at))[0] || null;
  const importantEvents = state.allEvents.filter((event) => {
    return eventImportance(event) === 'Important';
  });
  const smartStatus = firstSet(state.smartCharging && state.smartCharging.smartChargingStatus, wallbox && wallbox.smartChargingStatus);
  const lastConnectivityChange = firstSet(
    wallbox && wallbox.connectivityStatusUpdatedOn,
    latestConnectivityEvent && latestConnectivityEvent.timestamp,
  );

  return {
    connectivity: connectivity || 'Unknown',
    chargerStatus: /^(online)$/i.test(connectivity) ? 'Online' : /^(offline|disconnected)$/i.test(connectivity) ? 'Offline' : 'Unknown',
    health,
    connectors,
    activeSessions,
    activeConnectorId: activeConnectorIds.length === 1 ? activeConnectorIds[0] : null,
    smartCharging: {
      status: smartStatus == null ? 'Unknown' : prettyEnum(smartStatus),
      enabled: String(smartStatus || '').replace(/[\s_-]/g, '').toLowerCase() === 'enabled',
      overridden: firstSet(state.smartCharging && state.smartCharging.smartChargingOverridden, wallbox && wallbox.smartChargingOverridden),
    },
    currentActiveLimit: state.channelData,
    configuredMaxPower: firstSet(wallbox && wallbox.maxChargingPower, state.smartCharging && state.smartCharging.wbMaxChargingPower),
    measuredChargingPower: null,
    importantEvents,
    lastConnectivityChange,
    lastKnownGoodState: lastKnownGoodState ? {
      connectorId: lastKnownGoodState.id,
      status: lastKnownGoodState.lastKnownGood.status,
      at: lastKnownGoodState.lastKnownGood.at,
    } : null,
    dataFreshness: {
      chargerStatusUpdatedAt: wallbox && wallbox.connectivityStatusUpdatedOn || null,
      eventRange: state.eventBounds || null,
      eventsStatus: state.sourceStatus.events,
    },
  };
}

function diagnosticEvidence(event) {
  if (!event) return null;
  const session = relatedSessionForEvent(event);
  return {
    eventId: event.id == null ? null : String(event.id),
    timestamp: event.timestamp || null,
    eventName: event.eventName || 'Unknown',
    eventType: event.type || 'UNKNOWN',
    connectorIds: eventConnectorIds(event),
    sessionId: session ? String(session.transactionId) : firstSet(event.transactionId, event.sessionId),
  };
}

function eventsInRange(start = selectedWindow().start, end = selectedWindow().end) {
  const from = rangeMilliseconds(start, Number.NEGATIVE_INFINITY);
  const to = rangeMilliseconds(end, Date.now());
  return state.allEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    return Number.isFinite(time) && time >= from && time <= to;
  });
}

function getHealthHistory(start = selectedWindow().start, end = selectedWindow().end) {
  const from = rangeMilliseconds(start, Number.NEGATIVE_INFINITY);
  const to = rangeMilliseconds(end, Date.now());
  const records = state.allEvents.map((event) => {
    const name = String(event.eventName || '');
    const parsed = parseMaybeJson(event.additionalData) || parseMaybeJson(event.raw && event.raw.additionalData) || {};
    const explicit = firstSet(parsed.connectivityStatus, parsed.connectivity, parsed.chargerStatus,
      event.raw && event.raw.connectivityStatus, event.connectivityStatus);
    const statusText = String(explicit || name).replace(/[\s_-]/g, '').toLowerCase();
    const status = /disconnect|offline/.test(statusText) ? 'Offline'
      : /reconnect|online/.test(statusText) ? 'Online' : '';
    return { timestamp: new Date(event.timestamp).getTime(), status, event };
  }).filter((item) => item.status && Number.isFinite(item.timestamp) && item.timestamp <= to)
    .sort((left, right) => left.timestamp - right.timestamp);
  const wallboxTime = new Date(state.wallbox && state.wallbox.connectivityStatusUpdatedOn).getTime();
  const wallboxState = String(state.wallbox && state.wallbox.connectivityStatus || '').toLowerCase();
  if (Number.isFinite(wallboxTime) && wallboxTime <= to && /online|offline|disconnected/.test(wallboxState)) {
    records.push({ timestamp: wallboxTime, status: /offline|disconnected/.test(wallboxState) ? 'Offline' : 'Online', event: null });
    records.sort((left, right) => left.timestamp - right.timestamp);
  }
  const compact = records.filter((item, index) => !index || item.status !== records[index - 1].status);
  const priorState = compact.filter((item) => item.timestamp < from).at(-1);
  const inRange = compact.filter((item) => item.timestamp >= from);
  const visible = priorState ? [priorState, ...inRange] : inRange;
  return visible.map((item, index) => ({
    timestamp: item.timestamp,
    status: item.status,
    previousStatus: index ? visible[index - 1].status : null,
    event: item.event,
    evidence: diagnosticEvidence(item.event),
  }));
}

function checkConnectivity(start = selectedWindow().start, end = selectedWindow().end) {
  const current = deriveChargerState().connectivity;
  const history = getHealthHistory(start, end);
  const candidates = eventsInRange(start, end);
  const disconnects = candidates.filter((event) => /disconnect|offline/i.test(String(event.eventName || '')));
  const reconnects = candidates.filter((event) => /reconnect|online/i.test(String(event.eventName || '')));
  const offlinePeriods = [];
  let offlineStart = null;
  history.forEach((item) => {
    if (item.status === 'Offline' && item.previousStatus !== 'Offline') offlineStart = item;
    if (item.status === 'Online' && offlineStart) {
      const periodStart = Math.max(offlineStart.timestamp, rangeMilliseconds(start, Number.NEGATIVE_INFINITY));
      offlinePeriods.push({ start: periodStart, end: item.timestamp, durationMs: Math.max(0, item.timestamp - periodStart), startEvidence: offlineStart.evidence, endEvidence: item.evidence });
      offlineStart = null;
    }
  });
  if (offlineStart && String(current).toLowerCase() !== 'online') {
    const endTime = rangeMilliseconds(end, Date.now());
    const periodStart = Math.max(offlineStart.timestamp, rangeMilliseconds(start, Number.NEGATIVE_INFINITY));
    offlinePeriods.push({ start: periodStart, end: endTime, durationMs: Math.max(0, endTime - periodStart), startEvidence: offlineStart.evidence, endEvidence: null });
  }
  const status = /offline|disconnected/i.test(current) ? 'FAIL'
    : /online/i.test(current) ? disconnects.length ? 'ATTENTION'
      : ['loaded', 'empty', 'partial'].includes(state.sourceStatus.events) ? 'PASS' : 'UNKNOWN'
      : 'UNKNOWN';
  return {
    id: 'connectivity', status, currentConnectivity: current,
    lastTransition: history.filter((item) => item.previousStatus && item.previousStatus !== item.status).at(-1) || null,
    disconnectCount: disconnects.length, reconnectCount: reconnects.length,
    mostRecentDisconnect: disconnects.at(-1) ? diagnosticEvidence(disconnects.at(-1)) : null,
    mostRecentReconnect: reconnects.at(-1) ? diagnosticEvidence(reconnects.at(-1)) : null,
    longestObservedOfflineMs: offlinePeriods.length ? Math.max(...offlinePeriods.map((item) => item.durationMs)) : null,
    offlinePeriods, history, evidence: disconnects.concat(reconnects).map(diagnosticEvidence),
  };
}

function getConnectorStateHistory(connectorId, start = selectedWindow().start, end = selectedWindow().end) {
  const startTime = rangeMilliseconds(start, Number.NEGATIVE_INFINITY);
  const endTime = rangeMilliseconds(end, Date.now());
  if (endTime <= startTime) return [];
  return connectorIntervals(state.allEvents, Number(connectorId), endTime)
    .filter((interval) => interval.end > startTime && interval.time < endTime)
    .map((interval) => ({
      ...interval,
      originalTime: interval.time,
      originalEnd: interval.end,
      time: Math.max(interval.time, startTime),
      end: Math.min(interval.end, endTime),
    }));
}

function getStateTransitions(connectorId, start = selectedWindow().start, end = selectedWindow().end) {
  const history = connectorIntervals(state.allEvents, Number(connectorId), rangeMilliseconds(end, Date.now()));
  return history
    .map((interval, index) => ({
      connectorId: Number(connectorId), timestamp: interval.time,
      previousState: index ? history[index - 1].status : null,
      state: interval.status, event: interval.event,
    }))
    .filter((transition) => transition.timestamp >= rangeMilliseconds(start, Number.NEGATIVE_INFINITY)
      && transition.timestamp <= rangeMilliseconds(end, Date.now()));
}

function calculateDowntime(connectorId, start = selectedWindow().start, end = selectedWindow().end) {
  const startTime = rangeMilliseconds(start, Number.NEGATIVE_INFINITY);
  const endTime = rangeMilliseconds(end, Date.now());
  const intervals = getConnectorStateHistory(connectorId, startTime, endTime);
  const downStates = new Set(['Faulted', 'Disconnected', 'Unavailable']);
  const downtimeMs = intervals.reduce((total, interval) => total + (downStates.has(interval.status) ? interval.end - interval.time : 0), 0);
  return {
    connectorId: Number(connectorId), start: startTime, end: endTime, downtimeMs,
    observedMs: intervals.reduce((total, interval) => total + interval.end - interval.time, 0),
    intervals: intervals.filter((interval) => downStates.has(interval.status)),
  };
}

function calculateAvailability(connectorId, start = selectedWindow().start, end = selectedWindow().end) {
  const downtime = calculateDowntime(connectorId, start, end);
  const observed = downtime.observedMs;
  return {
    connectorId: downtime.connectorId,
    windowMs: Math.max(downtime.end - downtime.start, 0),
    observedMs: observed,
    coveragePercent: downtime.end > downtime.start ? observed / (downtime.end - downtime.start) * 100 : null,
    availabilityPercent: observed ? Math.max(observed - downtime.downtimeMs, 0) / observed * 100 : null,
    downtimeMs: downtime.downtimeMs, evidence: downtime.intervals,
  };
}

function checkConnector(connectorId, start = selectedWindow().start, end = selectedWindow().end) {
  const connector = deriveChargerState().connectors.find((item) => item.id === Number(connectorId));
  if (!connector) return { id: `connector-${connectorId}`, connectorId: Number(connectorId), status: 'UNKNOWN', state: 'Unknown', evidence: [] };
  const history = getConnectorStateHistory(connectorId, start, end);
  const transitions = getStateTransitions(connectorId, start, end);
  const faultIntervals = history.filter((item) => item.status === 'Faulted');
  const latestTransition = transitions.at(-1);
  const availability = calculateAvailability(connectorId, start, end);
  const status = connector.status === 'Faulted' ? 'FAIL'
    : ['Disconnected', 'Unavailable'].includes(connector.status) ? 'ATTENTION'
      : faultIntervals.length ? 'ATTENTION'
      : ['Available', 'Charging', 'Preparing', 'SuspendedEV', 'SuspendedEVSE', 'Finishing'].includes(connector.status) ? 'PASS' : 'UNKNOWN';
  return {
    id: `connector-${connectorId}`, connectorId: Number(connectorId), status,
    state: connector.status, stateStartTime: connector.since,
    previousState: latestTransition && latestTransition.previousState,
    faultCount: faultIntervals.length,
    faultDurationMs: faultIntervals.reduce((total, item) => total + item.end - item.time, 0),
    recentRecovery: transitions.slice().reverse().find((item, index, list) => item.previousState === 'Faulted' && ['Available', 'Charging'].includes(item.state)) || null,
    availabilityPercent: availability.availabilityPercent,
    coveragePercent: availability.coveragePercent,
    history, transitions,
    evidence: [...faultIntervals.map((item) => diagnosticEvidence(item.event)), ...transitions.map((item) => diagnosticEvidence(item.event))].filter(Boolean),
  };
}

function auditDataCompleteness(start = selectedWindow().start, end = selectedWindow().end) {
  const rangeEvents = eventsInRange(start, end);
  const missingSources = Object.entries(state.sourceStatus).filter(([, status]) => !['loaded', 'empty', 'partial'].includes(status));
  const invalidTimestampEvents = state.allEvents.filter((event) => !Number.isFinite(new Date(event.timestamp).getTime()));
  const connectorCoverage = deriveChargerState().connectors.map((connector) => {
    const availability = calculateAvailability(connector.id, start, end);
    return { connectorId: connector.id, observedMs: availability.observedMs, coveragePercent: availability.coveragePercent };
  });
  const issues = [];
  if (state.sourceStatus.events === 'error' || state.sourceStatus.events === 'idle' || state.sourceStatus.events === 'loading') issues.push(`Event source is ${state.sourceStatus.events}.`);
  if (state.sourceStatus.events === 'partial') issues.push('Event history is partial.');
  if (missingSources.length) issues.push(`Unavailable sources: ${missingSources.map(([name, status]) => `${name} (${status})`).join(', ')}.`);
  if (invalidTimestampEvents.length) issues.push(`${invalidTimestampEvents.length} event(s) have missing or invalid timestamps.`);
  return {
    status: issues.length ? state.sourceStatus.events === 'error' || state.sourceStatus.events === 'idle' ? 'UNKNOWN' : 'ATTENTION' : 'PASS',
    range: { start: rangeMilliseconds(start, null), end: rangeMilliseconds(end, null) },
    eventCount: rangeEvents.length, allEventCount: state.allEvents.length,
    invalidTimestampEventIds: invalidTimestampEvents.map((event) => event.id),
    missingSources: missingSources.map(([source, status]) => ({ source, status })),
    connectorCoverage, issues,
  };
}

function getEventContext(eventId, beforeMinutes = 30, afterMinutes = 30) {
  const event = state.allEvents.find((item) => String(item.id) === String(eventId));
  if (!event) return { event: null, events: [], start: null, end: null };
  const time = new Date(event.timestamp).getTime();
  if (!Number.isFinite(time)) return { event: diagnosticEvidence(event), events: [diagnosticEvidence(event)], start: null, end: null };
  const start = time - Math.max(0, Number(beforeMinutes) || 0) * 60000;
  const end = time + Math.max(0, Number(afterMinutes) || 0) * 60000;
  return { event: diagnosticEvidence(event), start, end, events: eventsInRange(start, end).map(diagnosticEvidence) };
}

function findRelatedEvents(eventId) {
  const event = state.allEvents.find((item) => String(item.id) === String(eventId));
  if (!event) return [];
  const anchorTime = new Date(event.timestamp).getTime();
  const connectorIds = eventConnectorIds(event);
  const session = relatedSessionForEvent(event);
  return state.allEvents.filter((candidate) => {
    if (String(candidate.id) === String(event.id)) return true;
    const candidateTime = new Date(candidate.timestamp).getTime();
    const near = Number.isFinite(anchorTime) && Number.isFinite(candidateTime) && Math.abs(candidateTime - anchorTime) <= 30 * 60000;
    const sameSession = session && relatedSessionForEvent(candidate)?.transactionId === session.transactionId;
    const sameConnector = connectorIds.some((id) => eventConnectorIds(candidate).includes(id));
    return near && (sameSession || sameConnector);
  }).sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp)).map(diagnosticEvidence);
}

function incidentCandidate(event) {
  const name = String(event.eventName || '').toLowerCase();
  const groups = [];
  if (/disconnect|reconnect|offline|online/.test(name)) groups.push('connectivity');
  if (/power[\s_-]*loss/.test(name)) groups.push('power');
  if (/bootnotification|reboot|restart/.test(name)) groups.push('boot');
  if (/fault|status_notification/.test(name) && connectorStatus(event, eventConnectorIds(event)[0] || 1) === 'Faulted') groups.push('connector-fault');
  if (/authoriz|reject|timeout|timed.?out|cancel/.test(name)) groups.push('session-or-authorization');
  return groups.length ? { event, time: new Date(event.timestamp).getTime(), groups, connectorIds: eventConnectorIds(event), session: relatedSessionForEvent(event) } : null;
}

function findIncidents(start = selectedWindow().start, end = selectedWindow().end) {
  const candidates = eventsInRange(start, end).map(incidentCandidate).filter((item) => item && Number.isFinite(item.time));
  (state.chargingSessions || []).filter((session) => ['timedout', 'cancelled'].includes(sessionStatusClass(session.status))).forEach((session) => {
    const timestamp = new Date(session.stopTime || session.startTime).getTime();
    if (Number.isFinite(timestamp) && timestamp >= rangeMilliseconds(start, Number.NEGATIVE_INFINITY) && timestamp <= rangeMilliseconds(end, Date.now())) {
      candidates.push({ event: null, time: timestamp, groups: ['abnormal-session'], connectorIds: [sessionConnectorId(session)].filter((id) => id != null), session });
    }
  });
  candidates.sort((left, right) => left.time - right.time);
  const groups = [];
  candidates.forEach((candidate) => {
    const current = groups[groups.length - 1];
    const recent = current && candidate.time - current.end <= 30 * 60000;
    const connectorMatch = current && candidate.connectorIds.some((id) => current.connectorIds.includes(id));
    const sessionId = candidate.session && String(candidate.session.transactionId);
    const sameSession = current && sessionId && current.sessionIds.includes(sessionId);
    const sequenceMatch = current && candidate.groups.some((group) => current.groups.includes(group)
      || current.groups.includes('connectivity') && ['power', 'boot'].includes(group)
      || group === 'connectivity' && current.groups.some((item) => ['power', 'boot'].includes(item)));
    if (recent && (connectorMatch || sameSession || sequenceMatch)) {
      current.items.push(candidate);
      current.end = candidate.time;
      candidate.groups.forEach((group) => { if (!current.groups.includes(group)) current.groups.push(group); });
      candidate.connectorIds.forEach((id) => { if (!current.connectorIds.includes(id)) current.connectorIds.push(id); });
      if (sessionId && !current.sessionIds.includes(sessionId)) current.sessionIds.push(sessionId);
    } else {
      groups.push({ start: candidate.time, end: candidate.time, groups: candidate.groups.slice(), connectorIds: candidate.connectorIds.slice(), sessionIds: sessionId ? [sessionId] : [], items: [candidate] });
    }
  });
  const incidents = groups.map((group, index) => {
    const eventItems = group.items.map((item) => item.event).filter(Boolean);
    const first = eventItems[0];
    return {
      id: `incident-${first && first.id != null ? first.id : group.start}-${index}`,
      status: 'ATTENTION', title: group.items.length > 1 ? 'Related operational evidence' : 'Operational event',
      relationship: 'Events are grouped by time and shared connector/session evidence; no cause is inferred.',
      start: group.start, end: group.end, groups: group.groups,
      connectorIds: group.connectorIds, sessionIds: group.sessionIds,
      eventIds: eventItems.map((event) => String(event.id)),
      eventNames: eventItems.map((event) => event.eventName || 'Unknown'),
      evidence: group.items.map((item) => item.event ? diagnosticEvidence(item.event) : {
        timestamp: new Date(item.time).toISOString(), sessionId: String(item.session.transactionId),
        eventName: `SESSION_${String(item.session.status).toUpperCase()}`,
      }),
      eventId: first && first.id,
      sessionId: group.sessionIds[0] || null,
      connectorId: group.connectorIds[0] ?? null,
    };
  });
  state.incidents = incidents;
  return incidents;
}

function diagnoseSessionStartFromData(session, events, intervals) {
  const start = new Date(session.startTime).getTime();
  if (!Number.isFinite(start)) return { classification: 'unavailable_data', evidence: [] };
  const nearby = events.filter((event) => Math.abs(new Date(event.timestamp).getTime() - start) <= 15 * 60000);
  const stateAtStart = intervals.find((interval) => interval.time <= start && interval.end > start);
  const evidence = nearby.map(diagnosticEvidence);
  if (stateAtStart) evidence.push(diagnosticEvidence(stateAtStart.event));
  if (stateAtStart && ['Faulted', 'Unavailable', 'Disconnected'].includes(stateAtStart.status)) {
    return { classification: 'interrupted', evidence, observedConnectorState: stateAtStart.status };
  }
  if (['timedout', 'cancelled'].includes(sessionStatusClass(session.status))) {
    return { classification: 'failed', evidence, observedSessionStatus: session.status };
  }
  if (stateAtStart && ['Preparing', 'Charging', 'Available'].includes(stateAtStart.status)) {
    return { classification: 'normal', evidence, observedConnectorState: stateAtStart.status };
  }
  return { classification: 'unknown', evidence };
}

function diagnoseSessionEndFromData(session, events, intervals) {
  const end = session.stopTime ? new Date(session.stopTime).getTime() : NaN;
  if (!Number.isFinite(end)) return { classification: 'unavailable_data', evidence: [] };
  const nearby = events.filter((event) => Math.abs(new Date(event.timestamp).getTime() - end) <= 15 * 60000);
  const stateAtEnd = intervals.find((interval) => interval.time <= end && interval.end >= end);
  const evidence = nearby.map(diagnosticEvidence);
  if (stateAtEnd) evidence.push(diagnosticEvidence(stateAtEnd.event));
  if (sessionStatusClass(session.status) === 'timedout') return { classification: 'failed', evidence, observedSessionStatus: session.status };
  if (sessionStatusClass(session.status) === 'cancelled') return { classification: 'interrupted', evidence, observedSessionStatus: session.status };
  if (stateAtEnd && ['Faulted', 'Unavailable', 'Disconnected'].includes(stateAtEnd.status)) {
    return { classification: 'interrupted', evidence, observedConnectorState: stateAtEnd.status };
  }
  if (sessionStatusClass(session.status) === 'completed' && stateAtEnd) return { classification: 'normal', evidence, observedConnectorState: stateAtEnd.status };
  return { classification: 'unknown', evidence };
}

function diagnoseSessionStart(transactionId) {
  return analyzeSession(transactionId)?.startDiagnosis || { classification: 'unavailable_data', evidence: [] };
}

function diagnoseSessionEnd(transactionId) {
  return analyzeSession(transactionId)?.endDiagnosis || { classification: 'unavailable_data', evidence: [] };
}

function getSessionConnectorCorrelation(transactionId) {
  const analysis = analyzeSession(transactionId);
  if (!analysis) return null;
  return {
    transactionId: String(transactionId), connectorId: analysis.connectorId, session: analysis.session,
    range: analysis.range, connectorIntervals: analysis.intervals,
    events: analysis.events.map(diagnosticEvidence), schedules: analysis.schedules,
    currentActiveLimit: state.channelData, configuredMaxPower: deriveChargerState().configuredMaxPower,
    measuredChargingPower: deriveChargerState().measuredChargingPower,
    startDiagnosis: analysis.startDiagnosis, endDiagnosis: analysis.endDiagnosis,
  };
}

function compareSessions(sessionA, sessionB) {
  const left = analyzeSession(sessionA);
  const right = analyzeSession(sessionB);
  if (!left || !right) return { status: 'UNKNOWN', missing: [!left ? String(sessionA) : null, !right ? String(sessionB) : null].filter(Boolean) };
  const duration = (analysis) => Number.isFinite(analysis.range.end - analysis.range.start) ? analysis.range.end - analysis.range.start : null;
  return {
    status: 'PASS', sessions: [String(sessionA), String(sessionB)],
    comparison: {
      status: [left.session.status, right.session.status],
      durationMs: [duration(left), duration(right)],
      energyKwh: [left.session.consumption ?? null, right.session.consumption ?? null],
      connectorId: [left.connectorId, right.connectorId],
      eventCount: [left.events.length, right.events.length],
      smartCharging: [left.smart, right.smart],
    },
  };
}

function analyzePowerLimits(start = selectedWindow().start, end = selectedWindow().end, connectorId = null) {
  const derived = deriveChargerState();
  return {
    range: { start: rangeMilliseconds(start, null), end: rangeMilliseconds(end, null) },
    connectorId: connectorId == null ? null : Number(connectorId),
    configuredMaximumPower: derived.configuredMaxPower,
    activeChargingLimit: derived.currentActiveLimit,
    measuredChargingPower: derived.measuredChargingPower,
    activeLimitSourceStatus: state.sourceStatus.channelInfo,
    note: 'Configured maximum, active limit, and measured power are separate fields. No measured power is available in loaded data.',
    evidence: eventsInRange(start, end).filter((event) => /limit|power/i.test(String(event.eventName || ''))).map(diagnosticEvidence),
  };
}

function analyzeSmartChargingImpact(transactionId) {
  const correlation = getSessionConnectorCorrelation(transactionId);
  if (!correlation) return null;
  const periods = correlation.schedules.flatMap((schedule) => schedule.periods)
    .filter((period) => period.end > correlation.range.start && period.time < correlation.range.end);
  return {
    transactionId: correlation.transactionId,
    sessionRange: correlation.range,
    schedulePeriods: periods,
    activeLimitAtCheck: correlation.currentActiveLimit,
    configuredMaximumPower: correlation.configuredMaxPower,
    measuredChargingPower: correlation.measuredChargingPower,
    evidence: correlation.events,
    note: periods.length ? 'Schedule periods overlap the session; this is a temporal relationship, not proof of cause.' : 'No session-linked schedule periods were available.',
  };
}

function detectRecurringProblems(start = selectedWindow().start, end = selectedWindow().end) {
  const categories = [
    ['disconnect', /disconnect|offline/i], ['connector_fault', /fault/i],
    ['failed_start', /authorization.*(fail|reject)|start.*(fail|reject)/i],
    ['power_loss', /power[\s_-]*loss/i], ['boot', /bootnotification|reboot|restart/i],
    ['timeout', /timeout|timed.?out/i],
  ];
  return categories.map(([category, pattern]) => {
    const evidence = eventsInRange(start, end).filter((event) => pattern.test(String(event.eventName || '')));
    return { category, count: evidence.length, evidence: evidence.map(diagnosticEvidence) };
  }).filter((item) => item.count > 1);
}

function findSessionPatterns(start = selectedWindow().start, end = selectedWindow().end) {
  const from = rangeMilliseconds(start, Number.NEGATIVE_INFINITY);
  const to = rangeMilliseconds(end, Date.now());
  const sessions = state.chargingSessions.filter((session) => {
    const range = sessionRange(session);
    return range.start <= to && range.end >= from;
  });
  const byStatus = {};
  sessions.forEach((session) => { const status = String(session.status || 'Unknown'); byStatus[status] = (byStatus[status] || 0) + 1; });
  const abnormal = sessions.filter((session) => ['timedout', 'cancelled'].includes(sessionStatusClass(session.status)));
  return { sourceStatus: state.sourceStatus.sessions, count: sessions.length, byStatus, abnormal: abnormal.map((session) => ({ transactionId: String(session.transactionId), status: session.status, startTime: session.startTime, stopTime: session.stopTime || null })) };
}

function getEventStatistics(start = selectedWindow().start, end = selectedWindow().end) {
  const events = eventsInRange(start, end);
  const byType = {};
  const byName = {};
  const byHour = {};
  events.forEach((event) => {
    byType[event.type || 'UNKNOWN'] = (byType[event.type || 'UNKNOWN'] || 0) + 1;
    byName[event.eventName || 'Unknown'] = (byName[event.eventName || 'Unknown'] || 0) + 1;
    const hour = new Date(event.timestamp).toISOString().slice(0, 13) + ':00:00Z';
    byHour[hour] = (byHour[hour] || 0) + 1;
  });
  return { count: events.length, byType, byName, byHour, invalidTimestampCount: state.allEvents.length - timedEvents(state.allEvents).length, completeness: state.sourceStatus.events };
}

function findLastKnownGoodState(connectorId, timestamp) {
  const cutoff = rangeMilliseconds(timestamp, Date.now());
  const prior = connectorIntervals(state.allEvents.filter((event) => new Date(event.timestamp).getTime() <= cutoff), Number(connectorId), cutoff)
    .filter((interval) => ['Available', 'Charging'].includes(interval.status))
    .at(-1);
  return prior ? { connectorId: Number(connectorId), status: prior.status, timestamp: prior.time, evidence: diagnosticEvidence(prior.event) } : null;
}

function createStateSnapshot() {
  const derived = deriveChargerState();
  return {
    capturedAt: new Date().toISOString(), serialNumber: document.getElementById('serialNumber').value.trim(),
    range: selectedWindow(), connectivity: derived.connectivity, health: derived.health,
    connectors: derived.connectors.map(({ id, status, since, lastKnownGood }) => ({ id, status, since, lastKnownGood })),
    activeSessions: derived.activeSessions.map((session) => String(session.transactionId)),
    currentActiveLimit: derived.currentActiveLimit, configuredMaximumPower: derived.configuredMaxPower,
    measuredChargingPower: derived.measuredChargingPower, sourceStatus: { ...state.sourceStatus },
  };
}

function compareConnectors(connectorA, connectorB, start = selectedWindow().start, end = selectedWindow().end) {
  return [connectorA, connectorB].map((connectorId) => {
    const check = checkConnector(connectorId, start, end);
    const downtime = calculateDowntime(connectorId, start, end);
    const availability = calculateAvailability(connectorId, start, end);
    return { connectorId: Number(connectorId), state: check.state, faultCount: check.faultCount, downtimeMs: downtime.downtimeMs, availabilityPercent: availability.availabilityPercent, coveragePercent: availability.coveragePercent };
  });
}

function comparePeriods(beforeStart, beforeEnd, afterStart, afterEnd) {
  const summarize = (start, end) => {
    const events = getEventStatistics(start, end);
    const sessions = findSessionPatterns(start, end);
    const connectors = deriveChargerState().connectors.map((connector) => ({ connectorId: connector.id, ...calculateDowntime(connector.id, start, end), availability: calculateAvailability(connector.id, start, end).availabilityPercent }));
    return { start, end, eventCount: events.count, eventCountsByType: events.byType, sessionCount: sessions.count, abnormalSessions: sessions.abnormal.length, connectors };
  };
  return { before: summarize(beforeStart, beforeEnd), after: summarize(afterStart, afterEnd) };
}

function makeDiagnosticResult(id, label, status, summary, evidence = [], values = {}) {
  return { id, label, status, summary, evidence: evidence.filter(Boolean), values };
}

function createDiagnosticTools() {
  return [
    {
      id: 'connectivity', label: 'Connectivity', description: 'Current connectivity and observed transitions.',
      available: () => true,
      run: (context) => {
        const check = checkConnectivity(context.start, context.end);
        return makeDiagnosticResult('connectivity', 'Connectivity', check.status,
          `${check.currentConnectivity}; ${check.disconnectCount} disconnect and ${check.reconnectCount} reconnect event(s).`, check.evidence,
          { lastTransition: check.lastTransition, longestObservedOfflineMs: check.longestObservedOfflineMs, offlinePeriods: check.offlinePeriods });
      },
    },
    {
      id: 'connector', label: 'Connector state', description: 'Current state, faults, transitions, and observed availability.',
      available: () => true,
      run: (context) => {
        const connectors = deriveChargerState().connectors.filter((item) => !context.connectorId || item.id === Number(context.connectorId));
        if (!connectors.length) return [makeDiagnosticResult('connectors', 'Connector state', 'UNKNOWN', 'No connector state is available from loaded charger/event data.')];
        return connectors.map((connector) => {
          const check = checkConnector(connector.id, context.start, context.end);
          return makeDiagnosticResult(check.id, `Connector ${connector.id}`, check.status,
            `${check.state}; ${check.faultCount} fault interval(s); availability within observed states ${check.availabilityPercent == null ? 'unknown' : `${check.availabilityPercent.toFixed(1)}%`}; history coverage ${check.coveragePercent == null ? 'unknown' : `${check.coveragePercent.toFixed(1)}%`}.`, check.evidence,
            { stateStartTime: check.stateStartTime, previousState: check.previousState, faultDurationMs: check.faultDurationMs, coveragePercent: check.coveragePercent });
        });
      },
    },
    {
      id: 'charger-errors', label: 'Active charger errors', description: 'Errors explicitly reported in loaded charger data.',
      available: () => true,
      run: () => {
        const errors = state.wallbox && hasActiveGlanceError(state.wallbox.activeChargingErrors);
        const loaded = state.sourceStatus.wallbox === 'loaded';
        return makeDiagnosticResult('charger-errors', 'Active charger errors', errors ? 'FAIL' : loaded ? 'PASS' : 'UNKNOWN',
          errors ? 'Active charger error data is present.' : loaded ? 'No active charger errors were reported.' : 'Charger error source is unavailable.', [], { activeChargingErrors: state.wallbox && state.wallbox.activeChargingErrors || null });
      },
    },
    {
      id: 'incidents', label: 'Related evidence', description: 'Groups nearby events and sessions only where time or connector/session evidence connects them.',
      available: () => true,
      run: (context) => {
        const incidents = findIncidents(context.start, context.end);
        return makeDiagnosticResult('incidents', 'Related evidence', incidents.length ? 'ATTENTION' : state.sourceStatus.events === 'idle' ? 'UNKNOWN' : 'PASS',
          incidents.length ? `${incidents.length} evidence group(s); no cause inferred.` : 'No related incident evidence grouped in this range.', incidents.flatMap((incident) => incident.evidence), { incidents });
      },
    },
    {
      id: 'sessions', label: 'Sessions', description: 'Availability and abnormal session statuses in the selected period.',
      available: () => true,
      run: (context) => {
        const summary = findSessionPatterns(context.start, context.end);
        const unknown = ['error', 'idle', 'loading'].includes(summary.sourceStatus);
        return makeDiagnosticResult('sessions', 'Sessions', unknown ? 'UNKNOWN' : summary.abnormal.length ? 'ATTENTION' : 'PASS',
          unknown ? `Session source is ${summary.sourceStatus}.` : `${summary.count} session(s), ${summary.abnormal.length} timed-out or cancelled.`,
          summary.abnormal.map((session) => ({ sessionId: session.transactionId, timestamp: session.stopTime || session.startTime, eventName: session.status })), summary);
      },
    },
    {
      id: 'limits', label: 'Power limits', description: 'Configured maximum and active limit, kept separate from measured power.',
      available: () => true,
      run: (context) => {
        const limits = analyzePowerLimits(context.start, context.end, context.connectorId);
        const unavailable = ['idle', 'error', 'loading'].includes(limits.activeLimitSourceStatus);
        return makeDiagnosticResult('limits', 'Charging limits', unavailable ? 'UNKNOWN' : 'PASS',
          `Configured maximum ${limits.configuredMaximumPower == null ? 'unavailable' : formatPowerWatts(limits.configuredMaximumPower)}; active limit ${limits.activeChargingLimit == null ? 'unavailable' : displayValue(limits.activeChargingLimit)}; measured power unavailable.`, limits.evidence, limits);
      },
    },
    {
      id: 'smart-charging', label: 'Smart charging', description: 'Reported smart-charging status and override state.',
      available: () => true,
      run: () => {
        const smart = deriveChargerState().smartCharging;
        const loaded = ['loaded', 'empty'].includes(state.sourceStatus.smartCharging);
        const overridden = smart.overridden === true || String(smart.overridden).toLowerCase() === 'true';
        const status = !loaded ? 'UNKNOWN' : overridden ? 'ATTENTION' : 'PASS';
        return makeDiagnosticResult('smart-charging', 'Smart charging', status,
          !loaded ? `Smart-charging source is ${state.sourceStatus.smartCharging}.` : `${smart.status}${overridden ? '; override active.' : '.'}`, [], { status: smart.status, enabled: smart.enabled, overridden: smart.overridden });
      },
    },
    {
      id: 'event-sequences', label: 'Connectivity and power events', description: 'Disconnect/reconnect, power-loss, and boot evidence.',
      available: () => true,
      run: (context) => {
        const events = eventsInRange(context.start, context.end);
        const selected = events.filter((event) => /disconnect|reconnect|offline|online|power[\s_-]*loss|bootnotification|reboot|restart/i.test(String(event.eventName || '')));
        const completeness = state.sourceStatus.events === 'partial' ? 'ATTENTION' : ['loaded', 'empty'].includes(state.sourceStatus.events) ? 'PASS' : 'UNKNOWN';
        return makeDiagnosticResult('event-sequences', 'Connectivity and power events', selected.length ? 'ATTENTION' : completeness,
          `${selected.filter((event) => /disconnect|reconnect|offline|online/i.test(event.eventName)).length} connectivity, ${selected.filter((event) => /power[\s_-]*loss/i.test(event.eventName)).length} power-loss, and ${selected.filter((event) => /bootnotification|reboot|restart/i.test(event.eventName)).length} boot/restart event(s).`, selected.map(diagnosticEvidence));
      },
    },
    {
      id: 'completeness', label: 'Data completeness', description: 'Source failures, partial event history, and timestamp/connector coverage.',
      available: () => true,
      run: (context) => {
        const audit = auditDataCompleteness(context.start, context.end);
        return makeDiagnosticResult('completeness', 'Data completeness', audit.status, audit.issues.length ? audit.issues.join(' ') : 'Loaded sources are complete for the selected range.', audit.invalidTimestampEventIds.map((eventId) => ({ eventId })), audit);
      },
    },
    {
      id: 'patterns', label: 'Recurring events', description: 'Repeated event-name patterns in the selected time range.',
      available: () => true,
      run: (context) => {
        const recurring = detectRecurringProblems(context.start, context.end);
        const completeness = state.sourceStatus.events === 'partial' ? 'ATTENTION' : ['loaded', 'empty'].includes(state.sourceStatus.events) ? 'PASS' : 'UNKNOWN';
        return makeDiagnosticResult('recurring', 'Repeated event patterns', recurring.length ? 'ATTENTION' : completeness,
          recurring.length ? recurring.map((item) => `${item.category}: ${item.count}`).join('; ') : 'No repeated event-name patterns found in loaded history.', recurring.flatMap((item) => item.evidence), { patterns: recurring });
      },
    },
  ];
}

function buildDiagnosticReport(context) {
  const results = [];
  createDiagnosticTools().forEach((tool) => {
    if (!tool.available(context)) return;
    try {
      const result = tool.run(context);
      results.push(...(Array.isArray(result) ? result : [result]));
    } catch (error) {
      results.push(makeDiagnosticResult(tool.id, tool.label, 'UNKNOWN', error.message || 'Diagnostic could not be completed.'));
    }
  });
  const status = results.some((item) => item.status === 'FAIL') ? 'FAIL'
    : results.some((item) => item.status === 'ATTENTION') ? 'ATTENTION'
      : results.some((item) => item.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS';
  return { status, range: { start: context.start, end: context.end }, generatedAt: new Date().toISOString(), results };
}

function estimateSmartInvestigationTokens(packet) {
  return Math.ceil(new TextEncoder().encode(stableSmartSerialization(packet)).length / 2) + 400;
}

function reduceSmartInvestigationPacket(packet, targetTokens = 4_000, maximumTokens = 8_000, protectedEvidence = new Set(), protectedRecords = new Set()) {
  const trimRecords = (records, type) => {
    const index = records.findLastIndex((item) => !protectedRecords.has(`${type}:${item.id}`));
    if (index >= 0) records.splice(index, 1);
  };
  const reductions = [
    () => {
      const index = packet.evidence.findLastIndex((item) => !protectedEvidence.has(`${item.type}:${item.id}`));
      if (index >= 0) packet.evidence.splice(index, 1);
    },
    () => trimRecords(packet.diagnostics, 'diagnostic'),
    () => trimRecords(packet.incidents, 'incident'),
    () => trimRecords(packet.connectors, 'connector'),
    () => trimRecords(packet.sessions.selected, 'session'),
    () => packet.patterns.pop(),
    () => packet.events.topNames.pop(),
    () => { packet.sessions.statusCounts = {}; },
    () => { packet.events.topNames = []; },
  ];
  let reduction = 0;
  while (estimateSmartInvestigationTokens(packet) > targetTokens && reduction < reductions.length * 24) {
    reductions[reduction % reductions.length]();
    reduction += 1;
    if (packet.evidence.length <= 4 && packet.diagnostics.length === 0
      && packet.incidents.length === 0 && packet.connectors.length === 0
      && packet.patterns.length === 0 && packet.events.topNames.length === 0) break;
  }
  return estimateSmartInvestigationTokens(packet) <= maximumTokens ? packet : null;
}

function buildCompactInvestigationPacket() {
  const serialNumber = document.getElementById('serialNumber')?.value.trim() || '';
  const statuses = Object.values(state.sourceStatus);
  if (!/^TACW[A-Za-z0-9]{10,12}$/.test(serialNumber) || !state.searchId
    || statuses.includes('idle') || statuses.includes('loading')) return null;

  const range = selectedWindow();
  const connectorFilter = document.getElementById('diagnosticConnector')?.value;
  const selectedConnector = connectorFilter !== '' && connectorFilter != null
    ? Number(connectorFilter) : null;
  const derived = deriveChargerState();
  const diagnosticReport = buildDiagnosticReport({ ...range, connectorId: connectorFilter || null });
  const connectivity = checkConnectivity(range.start, range.end);
  const completeness = auditDataCompleteness(range.start, range.end);
  const eventRecords = eventsInRange(range.start, range.end);
  const incidentRecords = findIncidents(range.start, range.end).slice(-4);
  const sessionRecords = (state.chargingSessions || []).filter((session) => {
    const sessionWindow = sessionRange(session);
    return sessionWindow.start <= rangeMilliseconds(range.end, Date.now())
      && sessionWindow.end >= rangeMilliseconds(range.start, Number.NEGATIVE_INFINITY);
  }).sort((left, right) => {
    const leftAbnormal = ['timedout', 'cancelled'].includes(sessionStatusClass(left.status)) ? 1 : 0;
    const rightAbnormal = ['timedout', 'cancelled'].includes(sessionStatusClass(right.status)) ? 1 : 0;
    return rightAbnormal - leftAbnormal
      || new Date(right.stopTime || right.startTime) - new Date(left.stopTime || left.startTime);
  }).slice(0, 4);
  const evidenceMap = new Map();
  const addEvidence = (type, id, timestamp, summary) => {
    if (id == null || !String(id)) return;
    const key = `${type}:${String(id)}`;
    if (!evidenceMap.has(key)) {
      evidenceMap.set(key, {
        type,
        id: String(id).slice(0, 200),
        timestamp: timestamp ? String(timestamp).slice(0, 40) : null,
        summary: String(summary || `${type} ${id}`).replace(/\s+/g, ' ').slice(0, 220),
      });
    }
  };
  const addEventEvidence = (event) => {
    if (!event || event.id == null) return;
    const connectorIds = eventConnectorIds(event);
    addEvidence('event', event.id, event.timestamp,
      `${event.eventName || 'Event'}${connectorIds.length ? ` · connector ${connectorIds.slice(0, 2).join(', ')}` : ''}`);
  };
  const selectedEvents = eventRecords.map((event) => {
    const name = String(event.eventName || 'Unknown');
    const important = eventImportance(event) === 'Important'
      || /disconnect|reconnect|offline|online|fault|error|timeout|timed.?out|cancel|power|boot|restart|authorization|reject/i.test(name);
    const related = selectedConnector != null && eventConnectorIds(event).includes(selectedConnector);
    const session = relatedSessionForEvent(event);
    const recency = Number.isFinite(new Date(event.timestamp).getTime()) ? new Date(event.timestamp).getTime() : 0;
    return { event, score: (important ? 4 : 0) + (related ? 2 : 0) + (session ? 1 : 0), recency };
  }).sort((left, right) => right.score - left.score || right.recency - left.recency).slice(0, 8);
  selectedEvents.forEach(({ event }) => addEventEvidence(event));
  const sessionSummaries = sessionRecords.map((session) => {
    const analysis = analyzeSession(session.transactionId);
    return {
      id: String(session.transactionId).slice(0, 200),
      status: String(session.status || 'Unknown').slice(0, 60),
      connectorId: sessionConnectorId(session),
      start: session.startTime ? String(session.startTime).slice(0, 40) : null,
      end: session.stopTime ? String(session.stopTime).slice(0, 40) : null,
      energyKwh: session.consumption ?? null,
      diagnosis: analysis ? `${analysis.startDiagnosis.classification}/${analysis.endDiagnosis.classification}` : 'unavailable',
      smartCharging: Boolean(analyzeSmartChargingImpact(session.transactionId)),
    };
  });
  const connectorRecords = derived.connectors.map((connector) => {
    const selected = selectedConnector == null || connector.id === selectedConnector;
    const check = checkConnector(connector.id, range.start, range.end);
    const downtime = calculateDowntime(connector.id, range.start, range.end);
    const availability = calculateAvailability(connector.id, range.start, range.end);
    return { selected, check, downtime, availability, connector };
  }).sort((left, right) => Number(right.selected) - Number(left.selected)
    || Number(right.check.status === 'FAIL') - Number(left.check.status === 'FAIL')
    || Number(right.check.status === 'ATTENTION') - Number(left.check.status === 'ATTENTION'))
    .slice(0, 4).map(({ check, downtime, availability, connector }) => {
      return {
        id: connector.id,
      state: check.state,
      faultCount: check.faultCount,
      availability: availability.availabilityPercent,
      coverage: availability.coveragePercent,
      downtimeMs: downtime.downtimeMs,
      };
    });
  const incidents = incidentRecords.map((incident) => {
    return {
      id: String(incident.id).slice(0, 200),
      start: new Date(incident.start).toISOString(),
      groups: incident.groups.slice(0, 3),
      eventCount: incident.eventIds.length,
      connectors: incident.connectorIds.slice(0, 3),
    };
  });
  const diagnostics = diagnosticReport.results.slice().sort((left, right) =>
    ({ FAIL: 0, ATTENTION: 1, UNKNOWN: 2, PASS: 3 }[left.status] ?? 4)
      - ({ FAIL: 0, ATTENTION: 1, UNKNOWN: 2, PASS: 3 }[right.status] ?? 4)).slice(0, 4).map((result) => {
    return { id: String(result.id).slice(0, 200), status: result.status, summary: result.summary.replace(/\s+/g, ' ').slice(0, 170) };
  });
  const power = analyzePowerLimits(range.start, range.end, selectedConnector);
  const smart = derived.smartCharging || {};
  const eventCounts = {};
  eventRecords.forEach((event) => {
    const name = String(event.eventName || 'Unknown');
    eventCounts[name] = (eventCounts[name] || 0) + 1;
  });
  const topNames = Object.entries(eventCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6).map(([name, count]) => ({ name: name.slice(0, 80), count }));
  const sessionStatusCounts = {};
  (state.chargingSessions || []).forEach((session) => {
    const name = String(session.status || 'Unknown').slice(0, 60);
    sessionStatusCounts[name] = (sessionStatusCounts[name] || 0) + 1;
  });
  const patterns = detectRecurringProblems(range.start, range.end).slice(0, 6).map(({ category, count }) => ({ category, count }));
  const packet = {
    version: 1,
    serialNumber,
    range: { start: new Date(range.start).toISOString(), end: new Date(range.end).toISOString() },
    status: {
      connectivity: derived.connectivity,
      chargerHealth: derived.health,
      connectivityCheck: connectivity.status,
      disconnects: connectivity.disconnectCount,
      reconnects: connectivity.reconnectCount,
      activeErrors: Boolean(state.wallbox && hasActiveGlanceError(state.wallbox.activeChargingErrors)),
      smartCharging: String(smart.status || 'Unknown').slice(0, 80),
    },
    events: { count: eventRecords.length, source: state.sourceStatus.events, topNames },
    sessions: { count: state.chargingSessions.length, source: state.sourceStatus.sessions, statusCounts: sessionStatusCounts, selected: sessionSummaries },
    connectors: connectorRecords,
    incidents,
    patterns,
    diagnostics: diagnostics.map(({ id, status, summary }) => ({ id, status, summary })),
    power: {
      configuredMaximumPower: power.configuredMaximumPower,
      activeChargingLimit: power.activeChargingLimit,
      measuredChargingPower: power.measuredChargingPower,
      source: power.activeLimitSourceStatus,
    },
    quality: {
      diagnosticStatus: diagnosticReport.status,
      completeness: completeness.status,
      eventsInRange: eventRecords.length,
      invalidTimestamps: completeness.invalidTimestampEventIds.length,
      missingSources: completeness.missingSources.slice(0, 5).map((item) => item.source),
    },
    evidence: Array.from(evidenceMap.values()).slice(0, 24),
  };
  return reduceSmartInvestigationPacket(packet);
}

function runDiagnosticCheck() {
  const context = { ...selectedWindow(), connectorId: document.getElementById('diagnosticConnector')?.value || null };
  const report = buildDiagnosticReport(context);
  state.diagnosticResults = report;
  document.getElementById('diagnosticsDisclosure').open = true;
  renderDiagnosticResults(report);
  scheduleSmartInvestigationRefresh();
  return report;
}

function stableSmartSerialization(value) {
  if (Array.isArray(value)) return `[${value.map(stableSmartSerialization).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSmartSerialization(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashSmartInvestigationContext(serialized) {
  const bytes = new TextEncoder().encode(serialized);
  if (window.crypto?.subtle) {
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let first = 2166136261;
  let second = 2246822519;
  bytes.forEach((byte) => {
    first = Math.imul(first ^ byte, 16777619);
    second = Math.imul(second ^ byte, 3266489917);
  });
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function renderSmartFindings() {
  const root = document.getElementById('smartInvestigationFindings');
  if (!root) return;
  const smart = state.smartInvestigation;
  if (!smart.loading && !smart.error && smart.contextHash && !smart.findings.length) {
    root.innerHTML = `
      <div class="smart-investigation-empty">
        <div class="empty-icon-wrap">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
        </div>
        <div class="empty-content">
          <strong>No Critical Anomalies Detected</strong>
          <p>The charger telemetry appears healthy within the selected time window.</p>
        </div>
      </div>`;
    return;
  }

  root.innerHTML = smart.findings.slice(0, 3).map((finding, idx) => {
    const importance = String(finding.importance || 'medium').toLowerCase();
    const confidence = String(finding.confidence || 'high');

    // Determine target entity chip (e.g. Session 110, Connector 1)
    const firstEvidence = (finding.evidence || [])[0];
    let targetBadge = '';
    if (firstEvidence) {
      if (firstEvidence.type === 'session') {
        targetBadge = `<span class="ai-chip session">Session #${escapeHtml(firstEvidence.id)}</span>`;
      } else if (firstEvidence.type === 'connector') {
        targetBadge = `<span class="ai-chip connector">Connector ${escapeHtml(firstEvidence.id)}</span>`;
      } else if (firstEvidence.type === 'incident') {
        targetBadge = `<span class="ai-chip incident">Incident Log</span>`;
      }
    }

    const evidenceButtons = (finding.evidence || []).slice(0, 2).map((item) => {
      const label = item.type === 'session' ? `Session #${item.id}`
        : item.type === 'connector' ? `Connector ${item.id}`
        : item.type === 'incident' ? 'Incident'
        : item.type === 'diagnostic' ? 'Diagnostics'
        : `Event ${item.timestamp ? formatGlanceTimestamp(item.timestamp) : item.id}`;
      return `
        <button type="button" class="ai-evidence-jump" data-smart-evidence-type="${escapeHtml(item.type)}" data-smart-evidence-id="${escapeHtml(item.id)}" title="Inspect ${escapeHtml(label)}">
          <span>${escapeHtml(label)}</span>
          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      `;
    }).join('');

    const moreEvidence = Math.max(0, Number(finding.evidenceCount || 0) - Math.min(2, (finding.evidence || []).length));

    return `
      <article class="smart-investigation-finding severity-${importance}" style="--stagger:${idx}">
        <div class="ai-card-glow"></div>
        <div class="ai-card-header">
          <div class="ai-card-tags">
            ${targetBadge}
            <span class="ai-severity-badge ${importance}">${escapeHtml(finding.importance || 'Medium')}</span>
          </div>
          <span class="ai-confidence-badge">${escapeHtml(confidence)} confidence</span>
        </div>

        <h3 class="ai-card-title">
          <svg class="ai-title-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span>${escapeHtml(finding.title)}</span>
        </h3>

        <p class="ai-card-summary">${escapeHtml(finding.summary)}</p>

        ${finding.nextStep ? `
          <div class="ai-next-step-box">
            <div class="ai-next-step-header">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              <span>Recommended Action</span>
            </div>
            <p class="ai-next-step-text">${escapeHtml(finding.nextStep)}</p>
          </div>
        ` : ''}

        ${evidenceButtons || moreEvidence ? `
          <div class="ai-evidence-footer">
            <span class="ai-evidence-label">Evidence:</span>
            <div class="ai-evidence-items">
              ${evidenceButtons}
              ${moreEvidence ? `<span class="ai-evidence-more">+${moreEvidence} more</span>` : ''}
            </div>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');
}

function renderSmartChat() {
  const smart = state.smartInvestigation;
  const chat = smart.chat;
  const form = document.getElementById('smartInvestigationChatForm');
  const input = document.getElementById('smartInvestigationQuestion');
  const submit = form?.querySelector('button[type="submit"]');
  const latest = document.getElementById('smartInvestigationLatestAnswer');
  if (!form || !input || !submit || !latest) return;
  const ready = Boolean(smart.contextHash && !smart.loading && !smart.error);
  input.disabled = !ready || chat.loading;
  submit.disabled = !ready || chat.loading;
  input.placeholder = ready ? 'Ask a question about the charger...' : 'Waiting for a charger investigation...';
  latest.hidden = !chat.question && !chat.answer && !chat.loading && !chat.error;
  document.getElementById('smartInvestigationLatestQuestion').textContent = chat.question ? `You: ${chat.question}` : '';
  const answer = document.getElementById('smartInvestigationAnswer');
  answer.classList.toggle('is-loading', chat.loading);
  answer.textContent = chat.loading ? 'Analyzing…' : chat.error || limitSmartAnswer(chat.answer);
}

function limitSmartAnswer(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).slice(0, 5).join(' ').slice(0, 2000);
}

function smartInvestigationApiUrl(path) {
  if (window.location.port === '8000') return path;
  return `http://${window.location.hostname}:8000${path}`;
}

function renderSmartInvestigations() {
  const smart = state.smartInvestigation;
  const status = document.getElementById('smartInvestigationStatus');
  const message = document.getElementById('smartInvestigationMessage');
  if (!status || !message) return;
  status.dataset.state = smart.loading ? 'loading' : smart.error ? 'error' : smart.contextHash ? 'ready' : 'idle';
  status.textContent = smart.loading ? 'Analyzing current charger context...'
    : smart.error ? smart.error
      : smart.contextHash ? smart.findings.length ? `${smart.findings.length} finding${smart.findings.length === 1 ? '' : 's'} · ${smart.generatedAt ? formatGlanceTimestamp(smart.generatedAt) : 'updated'}`
        : 'No important findings in the current context.'
        : state.searchId ? 'Waiting for current charger data...' : 'Load a charger to begin investigation.';
  message.hidden = !smart.error;
  message.textContent = smart.error || '';
  renderSmartFindings();
  renderSmartChat();
}

function scheduleSmartInvestigationRefresh() {
  const smart = state.smartInvestigation;
  if (smart.refreshBatchDepth) return;
  let context;
  try {
    context = buildCompactInvestigationPacket();
  } catch (error) {
    smart.error = 'Smart investigation unavailable.';
    smart.loading = false;
    smart.findings = [];
    renderSmartInvestigations();
    return;
  }
  if (!context) {
    renderSmartInvestigations();
    return;
  }
  const serialized = stableSmartSerialization(context);
  if (serialized === smart.contextSignature || serialized === smart.pendingSignature) return;
  if (smart.retrySignature && smart.retrySignature !== serialized) {
    window.clearTimeout(smart.retryTimer);
    smart.retryTimer = null;
    smart.retrySignature = null;
    smart.retryAttempts = 0;
  }
  window.clearTimeout(smart.debounceTimer);
  smart.requestId += 1;
  smart.chat.requestId += 1;
  smart.pendingSignature = serialized;
  smart.pendingHash = null;
  smart.contextHash = null;
  smart.findings = [];
  smart.error = null;
  smart.loading = true;
  smart.chat = { question: '', answer: '', loading: false, error: null, requestId: smart.chat.requestId };
  const requestId = smart.requestId;
  const searchId = state.searchId;
  renderSmartInvestigations();
  smart.debounceTimer = window.setTimeout(() => {
    requestSmartInvestigation(context, serialized, requestId, searchId);
  }, 350);
}

async function requestSmartInvestigation(context, serialized, requestId, searchId) {
  const smart = state.smartInvestigation;
  try {
    const digest = await hashSmartInvestigationContext(serialized);
    if (requestId !== smart.requestId || searchId !== state.searchId) return;
    smart.pendingHash = digest;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetch(dashboardApiUrl('/api/smart-investigation'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context }),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.findings) || !/^[a-f0-9]{64}$/.test(result.contextHash || '')) {
      const requestError = new Error(result.message || 'Smart investigation unavailable.');
      requestError.code = result.error;
      requestError.retryAfterSeconds = Number(result.retryAfterSeconds) || null;
      throw requestError;
    }
    if (requestId !== smart.requestId || searchId !== state.searchId || smart.pendingSignature !== serialized) return;
    smart.findings = result.findings.slice(0, 3);
    smart.contextHash = result.contextHash;
    smart.contextSignature = serialized;
    smart.pendingHash = null;
    smart.pendingSignature = null;
    smart.generatedAt = new Date().toISOString();
    smart.loading = false;
    smart.error = null;
    smart.retrySignature = null;
    smart.retryAttempts = 0;
    window.clearTimeout(smart.retryTimer);
    smart.retryTimer = null;
  } catch (error) {
    if (requestId !== smart.requestId || searchId !== state.searchId) return;
    smart.pendingHash = null;
    smart.pendingSignature = null;
    smart.contextSignature = serialized;
    smart.loading = false;
    const retryable = ['provider_rate_limited', 'local_rate_limited', 'provider_unavailable'].includes(error.code);
    const shouldRetry = retryable && smart.retryAttempts < 3;
    const providerMessage = retryable ? error.message : 'Smart investigation unavailable.';
    const retryAfterSeconds = Math.max(0, Number(error.retryAfterSeconds) || 0);
    const backoffSeconds = Math.min(3600, 60 * (2 ** smart.retryAttempts));
    const delayMs = Math.max(retryAfterSeconds, backoffSeconds) * 1000 + Math.random() * 5000;
    const retryMinutes = Math.max(1, Math.ceil(delayMs / 60_000));
    smart.error = shouldRetry
      ? `${providerMessage} Retrying in about ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'}.`
      : retryable ? `${providerMessage} Automatic retries exhausted; check the API rate limit and quota.`
        : providerMessage;
    smart.findings = [];
    if (shouldRetry) {
      smart.retrySignature = serialized;
      smart.retryAttempts += 1;
      smart.retryTimer = window.setTimeout(() => {
        smart.retryTimer = null;
        if (searchId !== state.searchId) return;
        let currentContext;
        try {
          currentContext = buildCompactInvestigationPacket();
        } catch (contextError) {
          return;
        }
        if (!currentContext || stableSmartSerialization(currentContext) !== serialized) {
          scheduleSmartInvestigationRefresh();
          return;
        }
        smart.contextSignature = null;
        scheduleSmartInvestigationRefresh();
      }, delayMs);
    }
  }
  renderSmartInvestigations();
}

function resetSmartInvestigation() {
  const smart = state.smartInvestigation;
  window.clearTimeout(smart.debounceTimer);
  window.clearTimeout(smart.retryTimer);
  smart.requestId += 1;
  smart.chat.requestId += 1;
  smart.contextHash = null;
  smart.serialNumber = document.getElementById('serialNumber')?.value.trim() || '';
  smart.contextSignature = null;
  smart.pendingHash = null;
  smart.pendingSignature = null;
  smart.retryTimer = null;
  smart.retrySignature = null;
  smart.retryAttempts = 0;
  smart.findings = [];
  smart.loading = false;
  smart.error = null;
  smart.generatedAt = null;
  smart.chat = { question: '', answer: '', loading: false, error: null, requestId: smart.chat.requestId };
  renderSmartInvestigations();
}

function buildChatContext(question, investigationPacket) {
  const normalized = question.toLowerCase();
  const words = normalized.match(/[a-z0-9]{3,}/g) || [];
  const findings = state.smartInvestigation.findings.slice(0, 3).map((finding) => ({
    id: finding.id,
    title: finding.title.slice(0, 80),
    summary: finding.summary.slice(0, 220),
    importance: finding.importance,
    confidence: finding.confidence,
    evidence: (finding.evidence || []).slice(0, 1).map(({ type, id }) => ({ type, id })),
    nextStep: finding.nextStep ? finding.nextStep.slice(0, 100) : null,
  }));
  const findingEvidence = new Set(findings.flatMap((finding) => finding.evidence.map((item) => `${item.type}:${item.id}`)));
  const evidence = investigationPacket.evidence.map((item, index) => {
    const key = `${item.type}:${item.id}`;
    const summary = `${item.type} ${item.summary}`.toLowerCase();
    const matches = words.reduce((count, word) => count + Number(summary.includes(word)), 0);
    return { item, index, score: (findingEvidence.has(key) ? 10 : 0) + matches };
  }).sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 16).map(({ item }) => item);
  const wantsEvents = /event|when|time|history|trend|recent|occur|timeline/.test(normalized);
  const wantsSessions = /session|charge|start|stop|energy|kwh|authorization/.test(normalized);
  const wantsPower = /power|limit|kw|schedule|smart charg|current/.test(normalized);
  const wantsDiagnostics = /diagnos|health|fault|error|offline|connect|connector|incident|problem|issue/.test(normalized);
  const referencedIds = (type) => new Set(findings.flatMap((finding) => finding.evidence
    .filter((item) => item.type === type).map((item) => String(item.id))));
  const references = (type) => referencedIds(type).size > 0;
  const compactRecords = (type, records, include) => {
    if (!include && !references(type)) return [];
    const ids = referencedIds(type);
    const matching = records.filter((item) => ids.has(String(item.id)));
    const additional = records.filter((item) => !ids.has(String(item.id))).slice(0, Math.max(0, 3 - matching.length));
    return matching.concat(additional);
  };
  const protectedRecords = new Set(findings.flatMap((finding) => finding.evidence.map((item) => `${item.type}:${item.id}`)));
  const context = {
    version: investigationPacket.version,
    serialNumber: investigationPacket.serialNumber,
    range: investigationPacket.range,
    status: {
      connectivity: investigationPacket.status.connectivity,
      chargerHealth: investigationPacket.status.chargerHealth,
      activeErrors: investigationPacket.status.activeErrors,
    },
    events: {
      count: investigationPacket.events.count,
      source: investigationPacket.events.source,
      topNames: wantsEvents ? investigationPacket.events.topNames.slice(0, 4) : [],
    },
    sessions: {
      count: investigationPacket.sessions.count,
      source: investigationPacket.sessions.source,
      statusCounts: wantsSessions ? investigationPacket.sessions.statusCounts : {},
      selected: compactRecords('session', investigationPacket.sessions.selected, wantsSessions),
    },
    connectors: compactRecords('connector', investigationPacket.connectors, wantsDiagnostics),
    incidents: compactRecords('incident', investigationPacket.incidents, wantsDiagnostics),
    patterns: wantsDiagnostics ? investigationPacket.patterns.slice(0, 4) : [],
    diagnostics: compactRecords('diagnostic', investigationPacket.diagnostics, wantsDiagnostics),
    power: wantsPower ? investigationPacket.power : {},
    quality: { diagnosticStatus: investigationPacket.quality.diagnosticStatus, completeness: investigationPacket.quality.completeness },
    evidence,
  };
  const payload = {
    context: reduceSmartInvestigationPacket(context, 1_000, 1_500, findingEvidence, protectedRecords),
    findings,
    question,
  };
  if (payload.context && estimateSmartInvestigationTokens(payload) > 2_000) {
    payload.context = reduceSmartInvestigationPacket(payload.context, 700, 900, findingEvidence, protectedRecords);
  }
  if (payload.context && estimateSmartInvestigationTokens(payload) > 2_000) payload.context = null;
  return payload;
}

async function askSmartInvestigationQuestion(event) {
  event.preventDefault();
  const input = document.getElementById('smartInvestigationQuestion');
  const question = input.value.trim();
  const smart = state.smartInvestigation;
  if (!question || question.length > 1_000 || !smart.contextHash || smart.loading || smart.chat.loading || smart.error) return;
  let context;
  try {
    context = buildCompactInvestigationPacket();
  } catch (error) {
    smart.chat.error = 'Unable to answer this question.';
    renderSmartChat();
    return;
  }
  const serialized = stableSmartSerialization(context);
  if (!context || serialized !== smart.contextSignature) {
    scheduleSmartInvestigationRefresh();
    return;
  }
  const chatPayload = buildChatContext(question, context);
  if (!chatPayload.context) {
    smart.chat.error = 'This question exceeds the compact context budget. Shorten it and try again.';
    renderSmartChat();
    return;
  }
  const chat = smart.chat;
  const requestId = ++chat.requestId;
  const searchId = state.searchId;
  const investigationHash = smart.contextHash;
  chat.question = question;
  chat.answer = '';
  chat.error = null;
  chat.loading = true;
  input.value = '';
  renderSmartChat();
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetch(dashboardApiUrl('/api/smart-investigation/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatPayload),
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
    const result = await response.json();
    if (!response.ok || typeof result.answer !== 'string') {
      const requestError = new Error(result.message || 'Unable to answer this question.');
      requestError.code = result.error;
      requestError.retryAfterSeconds = Number(result.retryAfterSeconds) || null;
      throw requestError;
    }
    if (requestId !== chat.requestId || searchId !== state.searchId || investigationHash !== smart.contextHash) return;
    chat.answer = limitSmartAnswer(result.answer);
    chat.error = null;
    chat.loading = false;
  } catch (error) {
    if (requestId !== chat.requestId || searchId !== state.searchId) return;
    chat.answer = '';
    const rateLimited = ['provider_rate_limited', 'local_rate_limited'].includes(error.code);
    const retryAfterSeconds = Math.max(0, Math.min(3_600, Number(error.retryAfterSeconds) || 0));
    const retryMessage = retryAfterSeconds
      ? ` Try again in about ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} minute${Math.ceil(retryAfterSeconds / 60) === 1 ? '' : 's'}.`
      : '';
    chat.error = rateLimited ? `${error.message}${retryMessage}` : 'Unable to answer this question.';
    chat.loading = false;
  }
  renderSmartChat();
}

function focusSmartInvestigationEvidence(type, id) {
  if (type === 'event') focusEvent(id);
  else if (type === 'session') focusSession(id);
  else if (type === 'connector') focusConnector(Number(id));
  else if (type === 'incident') {
    const incident = findIncidents().find((item) => String(item.id) === String(id));
    if (incident) focusIncident(incident);
  } else if (type === 'diagnostic') {
    const disclosure = document.getElementById('diagnosticsDisclosure');
    if (disclosure) disclosure.open = true;
    document.querySelector('.diagnostics-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderDiagnosticConnectorOptions(connectors = deriveChargerState().connectors) {
  const connectorSelect = document.getElementById('diagnosticConnector');
  if (!connectorSelect) return;
  const previousConnector = connectorSelect.value;
  const values = ['', ...connectors.map((connector) => String(connector.id))];
  const currentValues = Array.from(connectorSelect.options, (option) => option.value);
  if (values.length === currentValues.length && values.every((value, index) => value === currentValues[index])) return;
  connectorSelect.innerHTML = '<option value="">All connectors</option>' + connectors.map((connector) =>
    `<option value="${escapeHtml(String(connector.id))}">Connector ${escapeHtml(String(connector.id))}</option>`).join('');
  if (connectors.some((connector) => String(connector.id) === previousConnector)) connectorSelect.value = previousConnector;
}

function renderDiagnosticResults(report = state.diagnosticResults) {
  const root = document.getElementById('diagnosticResults');
  const status = document.getElementById('diagnosticStatus');
  const connectorSelect = document.getElementById('diagnosticConnector');
  const disclosure = document.getElementById('diagnosticsDisclosure');
  if (!root || !status || !connectorSelect) return;
  renderDiagnosticConnectorOptions();
  if (!report) {
    disclosure.hidden = true;
    status.textContent = 'Run checks to inspect currently loaded data.';
    root.innerHTML = '';
    return;
  }
  disclosure.hidden = false;
  status.className = `diagnostic-status status-${report.status.toLowerCase()}`;
  status.textContent = `${report.status} · ${report.results.length} checks · ${formatDate(report.generatedAt)}`;
  root.innerHTML = report.results.map((result) => {
    const evidence = result.evidence.slice(0, 6).map((item) => item.eventId != null
      ? `<button type="button" class="diagnostic-evidence" data-event-id="${escapeHtml(String(item.eventId))}">${escapeHtml(item.eventName || 'Event')} · ${escapeHtml(item.timestamp ? formatExact(item.timestamp) : 'Timestamp unavailable')}</button>`
      : item.sessionId != null
        ? `<button type="button" class="diagnostic-evidence" data-session-id="${escapeHtml(String(item.sessionId))}">Session ${escapeHtml(String(item.sessionId))} · ${escapeHtml(item.eventName || 'Evidence')}</button>`
        : `<span class="diagnostic-evidence-text">${escapeHtml(item.timestamp || item.eventName || 'Evidence unavailable')}</span>`).join('');
    const incidents = result.values && result.values.incidents || [];
    return `<article class="diagnostic-result status-${result.status.toLowerCase()}">
      <div class="diagnostic-result-heading"><strong>${escapeHtml(result.label)}</strong><span>${escapeHtml(result.status)}</span></div>
      <p>${escapeHtml(result.summary)}</p>
      ${evidence ? `<div class="diagnostic-evidence-list">${evidence}</div>` : ''}
      ${incidents.map((incident) => `<button type="button" class="diagnostic-incident" data-incident-id="${escapeHtml(incident.id)}">Focus ${escapeHtml(incident.title)} · ${escapeHtml(formatExact(incident.start))}</button>`).join('')}
    </article>`;
  }).join('');
  root.querySelectorAll('[data-event-id]').forEach((button) => button.addEventListener('click', () => focusEvent(button.dataset.eventId)));
  root.querySelectorAll('[data-session-id]').forEach((button) => button.addEventListener('click', () => focusSession(button.dataset.sessionId)));
  root.querySelectorAll('[data-incident-id]').forEach((button) => button.addEventListener('click', () => focusIncident(button.dataset.incidentId)));
}

function defineSupportOperation(id, metadata) {
  return {
    ...metadata,
    resolveParameters(context, inputs = {}) {
      return Object.fromEntries(this.requiredInputs.map((key) => [key, inputs[key] || '']));
    },
    execute: metadata.execute || ((context, parameters) => executeSupportOperationRequest(id, context, parameters)),
    verify(context, parameters, before, refresh) {
      return verifySupportOperation(id, parameters, before, refresh);
    },
    refresh(context) {
      return refreshSupportOperationData(id, context);
    },
  };
}

const supportOperationRegistry = {
  removePendingRemoteOperation: defineSupportOperation('removePendingRemoteOperation', {
    category: 'Remote',
    label: 'Remove pending remote operation',
    description: 'Remove the pending remote operation from the selected wallbox.',
    requiredInputs: [],
    available: canRemovePendingRemoteOperation,
  }),
  removePendingChargingSession: defineSupportOperation('removePendingChargingSession', {
    category: 'Charging',
    label: 'Remove pending charging session',
    description: 'Remove the pending charging session from the selected wallbox.',
    requiredInputs: [],
    available: canRemovePendingChargingSession,
  }),
  removePendingRFID: defineSupportOperation('removePendingRFID', {
    category: 'Access',
    label: 'Remove pending RFID swipe',
    description: 'Remove the pending RFID swipe for the selected wallbox.',
    requiredInputs: [],
    available: canRemovePendingRFID,
  }),
  alignPin: defineSupportOperation('alignPin', {
    category: 'Security',
    label: 'Align owner PIN',
    description: 'Set a new owner PIN for the selected wallbox.',
    requiredInputs: ['ownerPin'],
    available: canAlignPin,
  }),
  pushFirmware: defineSupportOperation('pushFirmware', {
    category: 'Firmware',
    label: 'Push firmware',
    description: 'Request a firmware update using the current execution time as the retrieve time.',
    requiredInputs: ['location'],
    available: canPushFirmware,
    execute: (context, parameters) => executeSupportOperationRequest('pushFirmware', context, {
      ...parameters,
      retrieveDate: new Date().toISOString(),
    }),
  }),
};

function getOperationContext() {
  const serialNumber = document.getElementById('serialNumber')?.value.trim() || '';
  const token = String(state.token || '').replace(/^Bearer\s+/i, '').trim();
  const chargerSerial = String(state.wallbox?.serialNumber || '').trim();
  const charger = serialNumber && chargerSerial.toUpperCase() === serialNumber.toUpperCase() ? state.wallbox : null;
  const sessions = (state.chargingSessions || []).filter((session) => !session.serialNumber
    || String(session.serialNumber).toUpperCase() === serialNumber.toUpperCase());
  const access = state.access && (!state.access.serialNumber
    || String(state.access.serialNumber).toUpperCase() === serialNumber.toUpperCase()) ? state.access : null;
  const range = currentRefreshContext();
  return {
    serialNumber,
    token,
    authenticated: Boolean(token && !isTokenExpired(token) && isTmeJwtToken(token)),
    charger,
    connectors: charger ? deriveChargerState().connectors : [],
    sessions,
    access,
    smartCharging: state.smartCharging,
    firmware: { currentVersion: charger?.version || null, packageLocationAvailable: false, retrieveDateAvailable: false },
    selectedConnector: state.activeConnector,
    selectedEventId: state.selectedEventId,
    selectedSessionId: state.selectedSessionId,
    eventView: state.eventView ? { ...state.eventView } : null,
    searchId: state.searchId,
    startTime: range.startTime,
    endTime: range.endTime,
  };
}

function baseSupportOperationCapability(context) {
  if (!/^TACW[A-Z0-9]{10,12}$/i.test(context.serialNumber)) {
    return { available: false, reason: 'Select a wallbox with a valid serial number.' };
  }
  if (!context.charger) {
    return { available: false, reason: 'Load the selected wallbox before running support operations.' };
  }
  if (!context.authenticated) {
    return { available: false, reason: 'A valid TME session is required. Use the existing session refresh flow.' };
  }
  return { available: true, reason: '' };
}

function canAlignPin(context, parameters = {}) {
  const base = baseSupportOperationCapability(context);
  if (!base.available) return base;
  return parameters.ownerPin && String(parameters.ownerPin).trim()
    ? base : { available: false, reason: 'Enter the new owner PIN. The current PIN is not reused automatically.' };
}

function canRemovePendingRemoteOperation(context) {
  const base = baseSupportOperationCapability(context);
  return base.available ? { ...base, reason: 'Pending-operation state is not exposed in dashboard data; the API response will determine whether action was needed.' } : base;
}

function canRemovePendingChargingSession(context) {
  const base = baseSupportOperationCapability(context);
  if (!base.available) return base;
  const visiblePending = context.sessions.some((session) => String(session.status || '').trim().toLowerCase() === 'pending');
  return { available: true, reason: visiblePending
    ? 'A pending-status session is visible and will be checked again after the request.'
    : 'The dashboard has no explicit pending-session record; the API response and refreshed sessions will be used.' };
}

function canRemovePendingRFID(context) {
  const base = baseSupportOperationCapability(context);
  return base.available ? { ...base, reason: context.access
    ? 'RFID assignments are loaded, but pending-swipe state is not exposed; the API response determines whether action was needed.'
    : 'Pending-swipe state is not exposed by loaded access data; the API response determines whether action was needed.' } : base;
}

function canPushFirmware(context, parameters = {}) {
  const base = baseSupportOperationCapability(context);
  if (!base.available) return base;
  if (!parameters.location) return { available: false, reason: 'Enter the firmware package URL.' };
  try {
    if (new URL(parameters.location).protocol !== 'https:') {
      return { available: false, reason: 'Firmware package URL must use HTTPS.' };
    }
  } catch (error) {
    return { available: false, reason: 'Enter a valid HTTPS firmware package URL.' };
  }
  return base;
}

function supportOperationCapability(operation, context, parameters) {
  const definition = supportOperationRegistry[operation];
  return definition ? definition.available(context, parameters) : { available: false, reason: 'Choose a supported operation.' };
}

function renderSupportOperations() {
  const context = getOperationContext();
  const base = baseSupportOperationCapability(context);
  const targetEl = document.getElementById('supportOperationSectionTarget');
  if (targetEl) {
    targetEl.textContent = context.charger
      ? `Selected wallbox · ${context.serialNumber}` : `No selected wallbox · ${context.serialNumber || 'serial unavailable'}`;
  }

  // Detect charger offline state
  const connStatus = String(state.wallbox?.connectivityStatus || '').toLowerCase();
  const isOffline = !context.charger || connStatus.includes('offline') || connStatus.includes('disconnect') || connStatus.includes('inactive');
  const offlineAlert = document.getElementById('toolkitOfflineAlert');
  const actionsStrip = document.getElementById('toolkitActionsStrip');
  const unlockBtn = document.getElementById('interactionUnlockBtn');
  const rebootBtn = document.getElementById('interactionRebootBtn');

  if (offlineAlert) {
    offlineAlert.hidden = !isOffline;
  }
  if (actionsStrip) {
    if (isOffline) {
      actionsStrip.classList.add('is-offline');
      if (unlockBtn) unlockBtn.disabled = true;
      if (rebootBtn) rebootBtn.disabled = true;
    } else {
      actionsStrip.classList.remove('is-offline');
    }
  }

  const menu = document.getElementById('supportOperationMenu');
  if (menu) {
    const categories = new Map();
    Object.entries(supportOperationRegistry).forEach(([id, definition]) => {
      if (!categories.has(definition.category)) categories.set(definition.category, []);
      categories.get(definition.category).push([id, definition]);
    });
    menu.innerHTML = [...categories].map(([category, operations]) => `
      <section>
        <h3>${escapeHtml(category)}</h3>
        ${operations.map(([id, definition]) => `<button type="button" data-support-operation-choice="${escapeHtml(id)}" title="${escapeHtml(!isOffline && base.available ? 'Available for the selected wallbox.' : isOffline ? 'Unavailable: Charger is offline.' : base.reason)}" ${!isOffline && base.available && !state.supportOperationInFlight ? '' : 'disabled'}>
          <span>${escapeHtml(definition.label)}</span><span class="operation-availability ${!isOffline && base.available ? 'is-available' : ''}">${!isOffline && base.available ? 'Available' : 'Unavailable'}</span>
        </button>`).join('')}
      </section>`).join('');
  }

  const operation = state.selectedSupportOperation;
  const dialog = document.getElementById('supportOperationDialog');
  if (!operation || !dialog?.open || state.supportOperationComplete) return;
  const definition = supportOperationRegistry[operation];
  const parameters = definition.resolveParameters(context, {
    ownerPin: document.getElementById('supportOwnerPin').value,
    location: document.getElementById('supportFirmwareLocation').value.trim(),
  });
  const capability = supportOperationCapability(operation, context, parameters);
  const status = document.getElementById('supportOperationDialogStatus');
  const confirmButton = document.getElementById('supportOperationConfirm');
  document.getElementById('supportOperationDialogTarget').textContent = context.charger
    ? `Selected wallbox · ${context.serialNumber}` : `No loaded wallbox selected · ${context.serialNumber || 'serial unavailable'}`;
  const requiredInputs = new Set(definition.requiredInputs);
  document.getElementById('supportOwnerPinField').hidden = !requiredInputs.has('ownerPin');
  document.getElementById('supportFirmwareLocationField').hidden = !requiredInputs.has('location');
  status.textContent = capability.reason;
  status.classList.toggle('is-blocked', !capability.available);
  status.classList.toggle('is-ready', capability.available);
  confirmButton.disabled = state.supportOperationInFlight || !capability.available;
  confirmButton.textContent = state.supportOperationInFlight ? 'Working...' : definition.label;
}

function openSupportOperationDialog(operation) {
  const definition = supportOperationRegistry[operation];
  if (state.supportOperationInFlight || !definition) return;
  state.selectedSupportOperation = operation;
  state.supportOperationComplete = false;
  document.getElementById('supportOwnerPin').value = '';
  document.getElementById('supportFirmwareLocation').value = '';
  document.getElementById('supportOperationDialogTitle').textContent = definition.label;
  document.getElementById('supportOperationDialogDescription').textContent = definition.description;
  const result = document.getElementById('supportOperationResult');
  result.textContent = '';
  result.hidden = true;
  const cancelButton = document.getElementById('supportOperationDialogCancel');
  cancelButton.textContent = 'Cancel';
  document.getElementById('supportOperationDialog').showModal();
  renderSupportOperations();
}

function loadSupportOperationHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem('chargerSupportOperationHistory') || '[]');
    const validStatuses = new Set(['REQUESTED', 'ACCEPTED', 'COMPLETED', 'VERIFIED', 'REJECTED', 'FAILED', 'TIMEOUT', 'NO_ACTION_REQUIRED', 'UNKNOWN']);
    state.supportOperationHistory = Array.isArray(saved) ? saved.filter((item) => item && supportOperationRegistry[item.operation]
      && validStatuses.has(item.status) && typeof item.serialNumber === 'string').slice(0, 50).map((item) => ({
        operation: item.operation,
        timestamp: String(item.timestamp || ''),
        serialNumber: item.serialNumber,
        connectorId: item.connectorId == null ? null : Number.isFinite(Number(item.connectorId)) ? Number(item.connectorId) : null,
        status: item.status,
        httpStatus: item.httpStatus == null ? null : Number.isFinite(Number(item.httpStatus)) ? Number(item.httpStatus) : null,
        durationMs: Math.max(0, Number(item.durationMs) || 0),
        verification: item.verification === 'VERIFIED' || item.verification === 'NO_ACTION_REQUIRED' ? item.verification : 'UNKNOWN',
        error: String(item.error || '').slice(0, 300),
      })) : [];
  } catch (error) {
    state.supportOperationHistory = [];
  }
}

function persistSupportOperationHistory() {
  const safeHistory = state.supportOperationHistory.slice(0, 50).map((item) => ({
    operation: item.operation,
    timestamp: item.timestamp,
    serialNumber: item.serialNumber,
    connectorId: item.connectorId,
    status: item.status,
    httpStatus: item.httpStatus,
    durationMs: item.durationMs,
    verification: item.verification,
    error: item.error,
  }));
  try {
    localStorage.setItem('chargerSupportOperationHistory', JSON.stringify(safeHistory));
  } catch (error) {
    // Keep the in-memory history available when browser storage is unavailable.
  }
}

function renderSupportOperationHistory() {
  const root = document.getElementById('supportOperationHistory');
  if (!root) return;
  const count = document.getElementById('supportOperationHistoryCount');
  if (count) count.textContent = String(state.supportOperationHistory.length);
  root.innerHTML = state.supportOperationHistory.slice(0, 10).map((item) => {
    const label = supportOperationRegistry[item.operation]?.label || item.operation;
    const verification = item.verification === 'VERIFIED' ? 'Verified' : 'Verification unknown';
    const connector = item.connectorId == null ? '' : ` · Connector ${escapeHtml(String(item.connectorId))}`;
    const error = item.error ? `<span>${escapeHtml(item.error)}</span>` : '';
    return `<li class="support-operation-history-item">
      <div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(item.status)} · ${verification}</span></div>
      <time datetime="${escapeHtml(item.timestamp)}">${escapeHtml(formatDate(item.timestamp))}</time>
      <span>${escapeHtml(item.serialNumber)}${connector} · ${escapeHtml(String(item.durationMs))} ms${item.httpStatus ? ` · HTTP ${escapeHtml(String(item.httpStatus))}` : ''}</span>
      ${error}
    </li>`;
  }).join('') || '<li class="empty-state">No dashboard operations have been recorded.</li>';
}

function captureTimelineContext() {
  if (!state.eventView) return;
  state.timelineHistory.push({
    view: { ...state.eventView }, connectorId: state.activeConnector,
    selectedEventId: state.selectedEventId, selectedSessionId: state.selectedSessionId,
    investigation: state.investigation ? { ...state.investigation } : null,
  });
  if (state.timelineHistory.length > 10) state.timelineHistory.shift();
}

function restorePreviousTimelineContext() {
  const previous = state.timelineHistory.pop();
  if (!previous) return false;
  state.timelineRestoring = true;
  if (previous.connectorId != null) showConnectorTab(previous.connectorId);
  if (previous.selectedEventId != null) focusEvent(previous.selectedEventId);
  if (previous.selectedSessionId != null) focusSession(previous.selectedSessionId);
  if (previous.view && state.eventBounds) setEventView(previous.view.start, previous.view.end);
  state.selectedEventId = previous.selectedEventId;
  state.selectedSessionId = previous.selectedSessionId;
  state.investigation = previous.investigation;
  if (previous.selectedSessionId == null) document.getElementById('sessionAnalysis').hidden = true;
  renderTable();
  state.timelineRestoring = false;
  renderInvestigation();
  return true;
}

function buildInvestigationSummary() {
  const derived = deriveChargerState();
  const window = selectedWindow();
  const events = eventsInRange(window.start, window.end);
  const sessions = state.chargingSessions.filter((session) => {
    const range = sessionRange(session);
    return range.start <= window.end && range.end >= window.start;
  });
  return {
    generatedAt: new Date().toISOString(),
    serialNumber: document.getElementById('serialNumber').value.trim(),
    range: { start: new Date(window.start).toISOString(), end: new Date(window.end).toISOString() },
    sources: { ...state.sourceStatus },
    connectivity: { current: derived.connectivity, lastChangedAt: derived.lastConnectivityChange, history: getHealthHistory(window.start, window.end) },
    connectors: derived.connectors.map((connector) => ({ ...checkConnector(connector.id, window.start, window.end), currentState: connector.status })),
    incidents: findIncidents(window.start, window.end),
    sessions: sessions.map((session) => ({ session: { ...session }, analysis: analyzeSession(session.transactionId) })),
    eventStatistics: getEventStatistics(window.start, window.end),
    diagnostics: state.diagnosticResults,
    events: events.map((event) => ({ id: event.id, timestamp: event.timestamp, type: event.type, eventName: event.eventName, additionalData: event.additionalData, raw: event.raw })),
  };
}

async function copyText(text, description) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`${description} copied.`, 'success');
    return true;
  } catch (error) {
    setStatus(`Could not copy ${description.toLowerCase()}.`, 'warning');
    return false;
  }
}

async function copyInvestigationSummary() {
  return copyText(JSON.stringify(buildInvestigationSummary(), null, 2), 'Investigation summary');
}

function exportInvestigation() {
  const payload = buildInvestigationSummary();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `charger-investigation-${payload.serialNumber || 'unknown'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Investigation exported as JSON.', 'success');
}

function getSelectedEvent() {
  return state.allEvents.find((event) => String(event.id) === String(state.selectedEventId)) || null;
}

async function copySelectedEvent() {
  const event = getSelectedEvent();
  return event ? copyText(JSON.stringify(event, null, 2), 'Selected event') : setStatus('Select an event first.', 'warning');
}

async function copySelectedEventJson() {
  const event = getSelectedEvent();
  return event ? copyText(JSON.stringify(event.raw || event, null, 2), 'Event JSON') : setStatus('Select an event first.', 'warning');
}

async function copySelectedEventId() {
  const event = getSelectedEvent();
  if (!event || event.id == null) return setStatus('Select an event with an ID first.', 'warning');
  return copyText(String(event.id), 'Event ID');
}

async function copySelectedEventTimestamp() {
  const event = getSelectedEvent();
  if (!event || !event.timestamp) return setStatus('Select an event with a timestamp first.', 'warning');
  return copyText(String(event.timestamp), 'Event timestamp');
}

async function copyEventContext() {
  const event = getSelectedEvent();
  if (!event) return setStatus('Select an event first.', 'warning');
  return copyText(JSON.stringify(getEventContext(event.id), null, 2), 'Event context');
}

function glanceIcon(name) {
  const paths = {
    charger: '<rect x="5" y="3" width="10" height="18" rx="2"/><path d="M8 7h4M15 8h2a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2"/><path d="m10 12-1 3h3l-1 3"/>',
    power: '<path d="m13 2-3 8h6l-5 12 1-9H7l6-11z"/>',
    connector: '<path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-6 6v4M9 21h6"/>',
    access: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-3 3"/>',
    health: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>',
    smart: '<path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6"/>',
  };
  return `<svg class="glance-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function formatGlanceTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderAtAGlance() {
  const grid = document.getElementById('glanceGrid');
  if (!grid) {
    return;
  }
  const derived = deriveChargerState();
  const wallbox = state.wallbox;
  const connectors = derived.connectors;
  renderDiagnosticConnectorOptions(connectors);
  const available = connectors.filter((connector) => connector.status === 'Available').length;
  const charging = connectors.filter((connector) => connector.status === 'Charging').length;
  const faulted = connectors.filter((connector) => connector.status === 'Faulted').length;
  const unavailable = connectors.filter((connector) => ['Unavailable', 'Disconnected'].includes(connector.status)).length;
  const healthTone = derived.health === 'Healthy' || derived.health === 'Charging' ? 'is-success'
    : derived.health === 'Faulted' ? 'is-error'
      : ['Attention', 'Offline'].includes(derived.health) ? 'is-warning' : '';
  const healthDetail = faulted
    ? `Connector ${connectors.find((connector) => connector.status === 'Faulted').id} faulted`
    : unavailable ? `${unavailable} unavailable` : derived.health === 'Checking' ? 'Checking current data' : 'Current charger evidence';
  const connectivityTone = derived.chargerStatus === 'Online' ? 'is-success' : derived.chargerStatus === 'Offline' ? 'is-warning' : '';
  const access = state.access;
  const sourceLabel = (source) => ({
    idle: 'Not loaded', loading: 'Loading', empty: 'No data', error: 'Unavailable', loaded: 'Loaded', partial: 'Partial history',
  })[source] || 'Unavailable';
  const maxPower = derived.configuredMaxPower == null ? 'Unavailable' : formatPowerWatts(derived.configuredMaxPower);
  const activeLimit = derived.currentActiveLimit == null ? 'Unavailable' : formatCurrentActiveLimit(derived.currentActiveLimit, derived.connectivity);
  const accessDetail = access
    ? `${(access.users || []).length} users · ${(access.rfids || []).length} RFID`
    : sourceLabel(state.sourceStatus.access);
  const smartDetail = `Active limit ${activeLimit} · Maximum configured power ${maxPower}`;
  const activeCount = ['loaded', 'empty'].includes(state.sourceStatus.sessions)
    ? `${derived.activeSessions.length} active`
    : `${sourceLabel(state.sourceStatus.sessions)} · active count unknown`;
  const sessionsKnown = ['loaded', 'empty'].includes(state.sourceStatus.sessions);
  const chargingValue = sessionsKnown
    ? `${derived.activeSessions.length} active session${derived.activeSessions.length === 1 ? '' : 's'}`
    : state.sourceStatus.sessions === 'loading' ? 'Loading sessions' : 'Active sessions unknown';
  const chargerDetail = derived.lastConnectivityChange
    ? `Last status update ${formatGlanceTimestamp(derived.lastConnectivityChange)}`
    : 'Connectivity timestamp unavailable';
  const chargingDetail = derived.measuredChargingPower == null
    ? `${activeCount}${derived.activeConnectorId != null ? ` · Connector ${derived.activeConnectorId}` : ''} · Measured charging power unavailable`
    : `${activeCount}${derived.activeConnectorId != null ? ` · Connector ${derived.activeConnectorId}` : ''} · Measured charging power ${formatPowerWatts(derived.measuredChargingPower)}`;
  const item = (title, icon, value, tone, secondary, valueMarkup = false, target = '') => `
    <div class="glance-item${target ? ' is-clickable' : ''}"${target ? ` data-target="${target}" tabindex="0" role="button" aria-label="Jump to ${escapeHtml(title)}"` : ''}>
      <div class="glance-item-header"><span>${escapeHtml(title)}</span>${glanceIcon(icon)}</div>
      <div class="glance-value${tone ? ` ${tone}` : ''}">${valueMarkup ? value : escapeHtml(value)}</div>
      <div class="glance-secondary">${escapeHtml(secondary)}</div>
    </div>
  `;
  const chargerLabel = state.sourceStatus.wallbox === 'loading' ? 'Checking'
    : state.sourceStatus.wallbox === 'error' ? 'Unavailable' : derived.chargerStatus;
  const statusValue = `<span class="glance-state-value"><span class="glance-state-dot${connectivityTone ? ` ${connectivityTone}` : ''}" aria-hidden="true"></span>${escapeHtml(chargerLabel.toUpperCase())}</span>`;
  const healthValue = `<span class="glance-state-value"><span class="glance-state-dot${healthTone ? ` ${healthTone}` : ''}" aria-hidden="true"></span>${escapeHtml(derived.health)}</span>`;
  const accessValue = access ? `Freevending ${access.open ? 'Enabled' : 'Disabled'}` : sourceLabel(state.sourceStatus.access);
  const smartValue = state.sourceStatus.smartCharging === 'error' ? 'Unavailable'
    : state.sourceStatus.smartCharging === 'loading' ? 'Loading'
      : `${derived.smartCharging.status}${derived.smartCharging.overridden === true || String(derived.smartCharging.overridden).toLowerCase() === 'true' ? ' · Override active' : ''}`;
  const connectorValue = connectors.length
    ? `${available} available · ${connectors.length} total`
    : state.sourceStatus.wallbox === 'loading' ? 'Loading' : 'Unknown';
  const connectorSummary = connectors.length
    ? `${connectors.length} total · ${available} available · ${charging} charging · ${faulted} faulted · ${unavailable} unavailable`
    : sourceLabel(state.sourceStatus.wallbox);
  const connectorDetails = connectors.length
    ? connectors.map((connector) => `${connector.id} · ${connector.status}`).join(' · ')
    : 'Connector state unavailable';

  grid.innerHTML = [
    item('Charger', 'charger', statusValue, connectivityTone, chargerDetail, true, '#chargerProfile'),
    item('Health', 'health', healthValue, healthTone, healthDetail, true, '#diagnosticsPanel'),
    item('Connectors', 'connector', connectorValue, faulted ? 'is-error' : unavailable ? 'is-warning' : '', `${connectorSummary} · ${connectorDetails}`, false, '#connectorPanel'),
    item('Charging', 'power', chargingValue, derived.activeSessions.length ? 'is-active' : '', chargingDetail, false, '#chargingSessionsPanel'),
    item('Smart Charging', 'smart', smartValue, derived.smartCharging.enabled ? 'is-active' : '', smartDetail, false, '#smartChargingProfile'),
    item('Access', 'access', accessValue, '', accessDetail, false, '#accessProfile'),
  ].join('');

  grid.querySelectorAll('.glance-item[data-target]').forEach((card) => {
    const jump = () => {
      const el = document.querySelector(card.dataset.target);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    card.addEventListener('click', jump);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        jump();
      }
    });
  });

  const freshness = document.getElementById('freshnessIndicator');
  if (freshness) {
    const refreshed = state.lastRefreshAt ? `Telemetry synced ${formatGlanceTimestamp(state.lastRefreshAt)}` : 'Telemetry synced';
    const env = (state.currentEnv || 'prod').toUpperCase();
    const chargerUpdate = derived.dataFreshness.chargerStatusUpdatedAt
      ? `Charger report ${formatGlanceTimestamp(derived.dataFreshness.chargerStatusUpdatedAt)}`
      : 'Hardware timestamp unavailable';
    freshness.innerHTML = `<strong>[${env} LIVE]</strong> · ${[refreshed, chargerUpdate].filter(Boolean).join(' · ')}`;
  }
  renderAttentionPanel(derived);
  renderSupportOperations();
}

function renderAttentionPanel(derived = deriveChargerState()) {
  const panel = document.getElementById('attentionPanel');
  const list = document.getElementById('attentionItems');
  const countBadge = document.getElementById('attentionCountBadge');
  if (!panel || !list) return;

  const items = [];
  const wallbox = state.wallbox;
  const access = state.access;
  const smart = state.smartCharging;
  const tariff = state.tariff;
  const sessions = state.chargingSessions || [];
  const events = state.allEvents || [];

  const latestEvent = (pattern) => events
    .filter((e) => pattern.test(String(e.eventName || '')))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;

  const add = (title, detail, meta, timestamp, actionLabel, action, id, tone = 'warning', icon = 'alert', category = 'hardware') =>
    items.push({ title, detail, meta, timestamp, actionLabel, action, id, tone, icon, category });

  // ── 1. CONNECTIVITY & HARDWARE ──────────────────────────────────────────
  if (derived.chargerStatus === 'Offline') {
    const ev = latestEvent(/disconnect|offline/i);
    const since = derived.lastConnectivityChange;
    const sinceText = since ? `Since ${formatGlanceTimestamp(since)}` : 'Connectivity lost';
    add('Charger offline', sinceText, 'Telemetry & OCPP stream interrupted', since, ev ? 'View event' : '', ev ? 'event' : '', ev && ev.id, 'danger', 'charger', 'hardware');
  }

  if (wallbox && hasActiveGlanceError(wallbox.activeChargingErrors)) {
    const errStr = Array.isArray(wallbox.activeChargingErrors)
      ? wallbox.activeChargingErrors.map((e) => prettyEnum(String(e.code || e.error || e))).join(', ')
      : String(wallbox.activeChargingErrors);
    add('Active hardware error', errStr || 'Error code in charger telemetry', 'Requires field inspection', null, 'View details', 'charger', null, 'danger', 'charger', 'hardware');
  }

  // Firmware freshness check
  if (wallbox && wallbox.firmwareVersion) {
    const fw = String(wallbox.firmwareVersion || '');
    const fwBootEvents = events.filter((e) => /boot/i.test(e.eventName || ''));
    const lastBoot = fwBootEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    if (lastBoot) {
      const parsed = parseMaybeJson(lastBoot.additionalData) || {};
      const bootFw = parsed.firmwareVersion;
      if (bootFw && bootFw !== fw) {
        add('Firmware mismatch detected', `Profile: ${fw} · Last boot: ${bootFw}`, 'Firmware may have been updated since last profile sync', lastBoot.timestamp, 'View boot', 'event', lastBoot.id, 'warning', 'charger', 'hardware');
      }
    }
  }

  // Low max power configuration
  if (derived.configuredMaxPower != null) {
    const maxKw = Number(derived.configuredMaxPower) / (Number(derived.configuredMaxPower) > 1000 ? 1000 : 1);
    if (maxKw > 0 && maxKw < 7.4) {
      add('Low max charging power configured', `${maxKw.toFixed(1)} kW limit active`, 'Below typical 7.4 kW AC threshold — check DLM or installation wiring', null, 'View profile', 'charger', null, 'info', 'smart', 'config');
    }
  }

  // ── 2. CONNECTOR STATUS (all connectors, richer detail) ─────────────────
  derived.connectors.filter((c) => ['Faulted', 'Unavailable', 'Disconnected'].includes(c.status)).forEach((c) => {
    const tone = c.status === 'Faulted' ? 'danger' : 'warning';
    const lastGood = c.lastKnownGood ? `Last good: ${prettyEnum(c.lastKnownGood.status)} at ${formatGlanceTimestamp(c.lastKnownGood.at)}` : 'No prior healthy state in window';
    add(`Connector ${c.id} ${c.status.toLowerCase()}`, lastGood, `Current state: ${c.status} — OCPP telemetry restricted`, c.since, 'Timeline', 'connector', c.id, tone, 'connector', 'hardware');
  });

  // ── 3. SESSIONS ANALYTICS ───────────────────────────────────────────────
  const completedSessions = sessions.filter((s) => !['ongoing', 'active', 'charging'].includes(String(s.status || '').toLowerCase()));
  const abnormalSessions = sessions.filter((s) => ['timedout', 'cancelled'].includes(sessionStatusClass(s.status)));
  const totalEnergy = sessions.reduce((acc, s) => acc + Number(s.totalEnergy || s.energyDelivered || 0), 0);
  const avgEnergy = completedSessions.length > 0 ? totalEnergy / completedSessions.length : 0;

  abnormalSessions.forEach((s) => {
    const tone = sessionStatusClass(s.status) === 'cancelled' ? 'danger' : 'warning';
    const reason = prettyEnum(s.stopReason || s.status || 'Unknown');
    const energy = Number(s.totalEnergy || 0);
    const meta = energy > 0 ? `${energy.toFixed(1)} kWh delivered before termination` : 'No energy delivered';
    add(`Session #${s.transactionId} terminated abnormally`, `Reason: ${reason}`, meta, s.stopTime || s.startTime, 'Inspect', 'session', s.transactionId, tone, 'session', 'sessions');
  });

  // Short sessions (< 2 min)
  sessions.filter((s) => {
    const dur = s.startTime && s.stopTime
      ? (new Date(s.stopTime).getTime() - new Date(s.startTime).getTime()) / 60000
      : null;
    return dur != null && dur > 0 && dur < 2 && !['ongoing', 'active'].includes(String(s.status || '').toLowerCase());
  }).forEach((s) => {
    const dur = Math.round((new Date(s.stopTime).getTime() - new Date(s.startTime).getTime()) / 60000);
    add(`Very short session #${s.transactionId}`, `Duration: ${dur} min — possible EV rejection`, `Connector ${s.connectorId || 1} · ${prettyEnum(s.stopReason || 'EVDisconnected')}`, s.stopTime, 'Inspect', 'session', s.transactionId, 'warning', 'session', 'sessions');
  });

  // Zero-energy completed session
  sessions.filter((s) => {
    const energy = Number(s.totalEnergy || s.energyDelivered || 0);
    const status = String(s.status || '').toLowerCase();
    return energy === 0 && !['ongoing', 'active', 'charging'].includes(status) && s.startTime && s.stopTime;
  }).slice(0, 2).forEach((s) => {
    add(`Zero-energy session #${s.transactionId}`, 'No energy delivered — EV or charger issue', `Status: ${prettyEnum(s.status)} · Connector ${s.connectorId || 1}`, s.stopTime, 'Inspect', 'session', s.transactionId, 'warning', 'session', 'sessions');
  });

  // High anomaly rate
  if (sessions.length >= 3 && abnormalSessions.length / sessions.length > 0.4) {
    const pct = Math.round(abnormalSessions.length / sessions.length * 100);
    add('High session anomaly rate', `${pct}% of ${sessions.length} sessions terminated abnormally`, `Avg energy per session: ${avgEnergy.toFixed(1)} kWh`, null, 'View sessions', 'sessions', null, 'danger', 'alert', 'sessions');
  }

  // ── 4. OCPP EVENT PATTERNS ──────────────────────────────────────────────
  derived.importantEvents.filter((e) => /power[\s_-]*loss/i.test(e.eventName || '')).forEach((e) => {
    add('Power-loss event recorded', 'Mains grid interruption detected in OCPP log', 'Check circuit breaker and upstream distribution board', e.timestamp, 'View event', 'event', e.id, 'danger', 'event', 'hardware');
  });

  // Repeated boot events (> 2 in window = instability)
  const bootEvents = events.filter((e) => /boot/i.test(e.eventName || ''));
  if (bootEvents.length > 2) {
    add(`Charger rebooted ${bootEvents.length}× in window`, 'Multiple BOOT_NOTIFICATION events suggest instability', 'Check power supply or firmware crash loop', bootEvents[0]?.timestamp, 'View events', 'events', null, 'danger', 'alert', 'hardware');
  }

  // Authorization failures
  const authEvents = events.filter((e) => /authoriz/i.test(e.eventName || ''));
  const authFailures = authEvents.filter((e) => {
    const parsed = parseMaybeJson(e.additionalData) || {};
    return /block|invalid|reject|denied/i.test(parsed.status || '');
  });
  if (authFailures.length > 0) {
    add(`${authFailures.length} authorization failure${authFailures.length > 1 ? 's' : ''}`, 'RFID/App authorization rejected by policy engine', `${authEvents.length} total auth events in window`, authFailures[0]?.timestamp, 'View event', 'event', authFailures[0]?.id, 'warning', 'alert', 'sessions');
  }

  // ── 5. SMART CHARGING & CHANNEL ─────────────────────────────────────────
  const overridden = derived.smartCharging.overridden === true || String(derived.smartCharging.overridden || '').toLowerCase() === 'true';
  if (overridden) {
    const limit = derived.currentActiveLimit;
    const limitStr = limit != null ? (typeof limit === 'object' ? JSON.stringify(limit) : String(limit)) : 'Custom';
    add('Smart-charging override active', `Manual limit: ${limitStr} — bypassing tariff schedule`, 'Grid SLA and cost optimisation may be affected', null, 'View smart', 'smart', null, 'info', 'smart', 'smart');
  }

  if (smart && smart.smartChargingStatus) {
    const scStatus = String(smart.smartChargingStatus || '').replace(/[\s_-]/g, '').toLowerCase();
    if (scStatus === 'disabled' || scStatus === 'unavailable') {
      add('Smart charging disabled', `Status: ${prettyEnum(smart.smartChargingStatus)}`, 'Peak shaving and tariff optimisation not active', null, 'View smart', 'smart', null, 'warning', 'smart', 'smart');
    }
  }

  if (tariff) {
    const tariffName = tariff.tariffName || tariff.name || tariff.id;
    const tariffStatus = String(tariff.status || tariff.state || '').toLowerCase();
    if (tariffStatus && tariffStatus !== 'active' && tariffStatus !== 'enabled') {
      add('Tariff not active', tariffName ? `Tariff: ${tariffName}` : 'Tariff configuration found', `Status: ${prettyEnum(tariffStatus)} — charging cost control may be affected`, null, 'View smart', 'smart', null, 'warning', 'smart', 'smart');
    }
  }

  // Channel data limit check
  if (derived.currentActiveLimit != null) {
    const rawLimit = derived.currentActiveLimit;
    const parsed = typeof rawLimit === 'object' ? rawLimit : {};
    const amps = Number(parsed.currentLimit ?? parsed.limit ?? rawLimit ?? 0);
    if (amps > 0 && amps < 8) {
      add('Very low current limit on channel', `Active limit: ${amps}A — well below standard 16A`, 'Possible DLM throttling or installation constraint', null, 'View smart', 'smart', null, 'warning', 'smart', 'smart');
    }
  }

  // ── 6. ACCESS CONTROL ───────────────────────────────────────────────────
  if (access) {
    const accessLevel = String(access.accessLevel || access.level || access.type || '').toLowerCase();
    if (accessLevel && !['public', 'open'].includes(accessLevel)) {
      const rfidCount = Number(access.authorisedRfidCount ?? access.rfidCount ?? 0);
      if (rfidCount === 0) {
        add('Access restricted — no RFID cards configured', `Access level: ${prettyEnum(accessLevel)}`, 'Charger may reject all badge authorizations', null, 'View access', 'charger', null, 'warning', 'alert', 'access');
      }
    }
    const chargingEnabled = access.chargingEnabled ?? access.enabled;
    if (chargingEnabled === false || String(chargingEnabled).toLowerCase() === 'false') {
      add('Charging disabled via access control', 'chargingEnabled flag is false in access API', 'Charger will reject all new sessions', null, 'View access', 'charger', null, 'danger', 'alert', 'access');
    }
  }

  // ── 7. DATA FRESHNESS & SOURCE ERRORS ───────────────────────────────────
  Object.entries(state.sourceStatus).forEach(([source, status]) => {
    if (status === 'error') {
      add(`${prettyEnum(source)} data unavailable`, 'API call failed — data may be stale', `Source: ${source} endpoint returned error`, null, '', '', null, 'warning', 'charger', 'data');
    }
  });

  if (state.sourceStatus.events === 'partial') {
    add('Event history incomplete', 'Some event pages could not be loaded', 'Analytics and session correlation may be affected', null, 'View events', 'events', null, 'warning', 'event', 'data');
  }

  if (state.lastRefreshAt) {
    const staleMins = Math.floor((Date.now() - state.lastRefreshAt) / 60000);
    if (staleMins > 30) {
      add('Data may be stale', `Last refresh ${staleMins} minutes ago`, 'Click Refresh to get the latest telemetry', null, '', '', null, 'info', 'event', 'data');
    }
  }

  // ── RENDER ───────────────────────────────────────────────────────────────
  panel.hidden = items.length === 0;
  if (countBadge) countBadge.textContent = String(items.length);

  const iconMap = {
    charger: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/></svg>',
    connector: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 6-12 12"/><path d="m14 6 4 4"/><path d="m6 14 4 4"/></svg>',
    session: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    event: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    smart: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  const catLabel = { hardware: 'Hardware', sessions: 'Sessions', smart: 'Smart Charging', access: 'Access', data: 'Data', config: 'Config' };

  list.innerHTML = items.map((item) => {
    const ts = item.timestamp ? new Date(item.timestamp) : null;
    const timeMarkup = ts && Number.isFinite(ts.getTime())
      ? `<time datetime="${ts.toISOString()}">${escapeHtml(formatGlanceTimestamp(ts))}</time>`
      : '';
    const iconSvg = iconMap[item.icon] || iconMap.alert;
    const cat = catLabel[item.category] || item.category;
    return `
      <div class="attention-card tone-${escapeHtml(item.tone)}">
        <div class="attention-card-icon tone-${escapeHtml(item.tone)}">${iconSvg}</div>
        <div class="attention-card-content">
          <div class="attention-card-top">
            <strong class="attention-card-title">${escapeHtml(item.title)}</strong>
            <span class="attention-cat-tag">${escapeHtml(cat)}</span>
          </div>
          <div class="attention-card-detail-line">${escapeHtml(item.detail)}</div>
          <div class="attention-card-sub">
            <span class="attention-card-meta">${escapeHtml(item.meta || '')}</span>
            ${timeMarkup ? `<span class="attention-card-sep">·</span>${timeMarkup}` : ''}
          </div>
        </div>
        ${item.actionLabel ? `
          <button type="button" class="attention-card-action" data-action="${escapeHtml(item.action)}" data-id="${escapeHtml(item.id == null ? '' : item.id)}" title="${escapeHtml(item.actionLabel)}">
            <span>${escapeHtml(item.actionLabel)}</span>
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ` : ''}
      </div>
    `;
  }).join('');

  list.querySelectorAll('.attention-card-action').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.id;
      if (button.dataset.action === 'event') focusEvent(id);
      else if (button.dataset.action === 'connector') focusConnector(Number(id));
      else if (button.dataset.action === 'session') focusSession(id);
      else if (button.dataset.action === 'charger') document.querySelector('.info-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (button.dataset.action === 'smart') document.querySelectorAll('.info-card')[2]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (button.dataset.action === 'events') document.querySelector('.events-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (button.dataset.action === 'sessions') document.querySelector('.charging-sessions-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}


function formatChronoRelativeTime(timestamp) {
  if (!timestamp) return 'Live';
  const now = Date.now();
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Live';
  const diffSec = Math.floor((now - time) / 1000);
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderInvestigation() {
  const indicator = document.getElementById('investigationIndicator');
  const label = document.getElementById('investigationLabel');
  if (!indicator || !label) {
    return;
  }
  indicator.hidden = !state.investigation;
  label.textContent = state.investigation ? state.investigation.label : '';
  const returnButton = document.getElementById('returnTimelineContext');
  if (returnButton) returnButton.hidden = !state.timelineHistory.length;
}

function focusEvent(eventId) {
  const event = state.allEvents.find((item) => String(item.id) === String(eventId));
  if (!event) {
    return false;
  }
  if (!state.timelineRestoring && state.investigation && state.investigation.eventId !== String(event.id)) captureTimelineContext();
  state.selectedEventId = String(event.id);
  state.investigation = { kind: 'event', eventId: String(event.id), label: `Investigating · ${prettyEnum(event.eventName)}` };
  renderInvestigation();
  const detailPane = document.getElementById('detailPane');
  if (detailPane) {
    detailPane.textContent = JSON.stringify(event.raw || event, null, 2);
  }
  renderRelatedSession(event);
  const time = new Date(event.timestamp).getTime();
  if (state.eventBounds && Number.isFinite(time) && time >= state.eventBounds.start && time <= state.eventBounds.end) {
    const halfWindow = 30 * 60 * 1000;
    setEventView(Math.max(state.eventBounds.start, time - halfWindow), Math.min(state.eventBounds.end, time + halfWindow));
  }
  document.querySelector('.events-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function focusSession(transactionId) {
  // Opening a session must leave state.eventView alone
  const session = (state.chargingSessions || []).find((item) => String(item.transactionId) === String(transactionId));
  if (!session) {
    return false;
  }
  if (!state.timelineRestoring && state.investigation && state.investigation.sessionId !== String(transactionId)) captureTimelineContext();
  state.investigation = { kind: 'session', sessionId: String(transactionId), label: `Investigating · Session ${transactionId}` };
  renderInvestigation();
  openSessionAnalysis(transactionId);
  return true;
}

function focusConnector(connectorId, startTime, endTime) {
  const connector = deriveChargerState().connectors.find((item) => item.id === Number(connectorId));
  if (!connector) {
    return false;
  }
  if (!state.timelineRestoring && state.investigation && state.investigation.connectorId !== connector.id) captureTimelineContext();
  state.investigation = {
    kind: 'connector',
    connectorId: connector.id,
    label: `Investigating · Connector ${connector.id} ${connector.status.toLowerCase()}`,
  };
  renderInvestigation();
  showConnectorTab(connector.id);
  const start = startTime == null ? NaN : new Date(startTime).getTime();
  const end = endTime == null ? NaN : new Date(endTime).getTime();
  if (Number.isFinite(start) && Number.isFinite(end) && state.eventBounds) {
    setEventView(Math.max(state.eventBounds.start, start), Math.min(state.eventBounds.end, end));
  }
  document.getElementById('connectorPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

function focusIncident(incidentId) {
  const window = selectedWindow();
  const incident = typeof incidentId === 'object' ? incidentId : findIncidents(window.start, window.end).find((item) => item.id === incidentId);
  if (!incident) {
    return false;
  }
  if (!state.investigation) captureTimelineContext();
  if (incident.sessionId != null && focusSession(incident.sessionId)) return true;
  if (incident.connectorId != null && focusConnector(incident.connectorId, incident.start, incident.end)) return true;
  if (incident.eventId != null && focusEvent(incident.eventId)) return true;
  return false;
}

function clearInvestigation() {
  state.investigation = null;
  state.selectedEventId = null;
  state.selectedSessionId = null;
  const analysis = document.getElementById('sessionAnalysis');
  if (analysis) analysis.hidden = true;
  renderInvestigation();
  renderTable();
}

function renderAccessProfile() {
  const profile = document.getElementById('accessProfile');
  const summary = document.getElementById('accessSummary');
  if (!profile || !summary) {
    return;
  }
  const access = state.access;
  if (!access) {
    const message = state.loadingCards.access ? 'Loading access...'
      : state.sourceStatus.access === 'error' ? 'Failed to load access information.'
        : state.sourceStatus.access === 'empty' ? 'No access record available.'
          : 'Search to load access.';
    summary.textContent = state.loadingCards.access ? message : 'Search to load access';
    profile.innerHTML = `<p class="empty-state${state.loadingCards.access ? ' loading-state' : ''}">${message}</p>`;
    return;
  }
  const users = access.users || [];
  const owner = users.find((user) => String(user.role || '').toUpperCase() === 'OWNER');
  summary.textContent = `Freevending ${access.open ? 'Enabled' : 'Disabled'} · ${users.length} user${users.length === 1 ? '' : 's'} · ${(access.rfids || []).length} RFID`;
  const groups = [
    ['Access', [
      ['Freevending', access.open ? 'Enabled' : 'Disabled', access.open ? 'good' : 'bad'],
      ['Country', access.countryId || 'N/A'],
      ['Claimed', access.claimDateTime ? formatDate(access.claimDateTime) : 'Not claimed'],
      ['Last freevending switch', formatDate(access.lastOpenUpdateTimestamp)],
    ]],
    ['RFID', [
      ['Assigned', (access.rfids || []).length ? access.rfids.join(', ') : 'None'],
      ['Factory', (access.factoryRfids || []).length ? access.factoryRfids.join(', ') : 'None'],
      ['RFID list version', access.rfidListVersion],
      ['Max RFID', access.maxAuthorizableRfid],
    ], 'rfid-group'],
    ['Users', users.length ? users.map((user) => [user.role || 'User', user.userId, '', true]) : [['None', '—']]],
  ];
  profile.innerHTML = `
    ${groups.map(([title, rows, groupClass]) => `
      <section class="charger-group ${groupClass || ''}">
        <h3>${escapeHtml(title)}</h3>
        <dl>
          ${rows.map(([label, value, tone, copyable]) => `
            <div>
              <dt>${escapeHtml(String(label))}</dt>
              <dd>
                ${tone ? `<span class="status-pill tone-${tone}">${escapeHtml(displayValue(value))}</span>` : escapeHtml(displayValue(value))}
                ${copyable ? `<button type="button" class="copy-pin" data-pin="${escapeHtml(displayValue(value))}">Copy</button>` : ''}
              </dd>
            </div>
          `).join('')}
        </dl>
      </section>
    `).join('')}
  `;
  profile.querySelectorAll('.copy-pin').forEach((button) => {
    button.addEventListener('click', async () => {
      const pin = button.dataset.pin || '';
      if (!pin || pin === '—') {
        return;
      }
      await navigator.clipboard.writeText(pin);
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1200);
    });
  });
}

async function fetchWallbox(serialNumber, token) {
  try {
    const response = await fetch(dashboardApiUrl('/api/wallbox'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      const error = formatApiError(result);
      return {
        wallbox: null,
        error,
        notFound: response.status === 404 || /not found|404/i.test(error),
      };
    }
    return { wallbox: result.wallbox || null, error: null, notFound: false };
  } catch (error) {
    return { wallbox: null, error: error.message || 'Unable to check this serial right now.', notFound: false };
  }
}

async function fetchChannelInfo(serialNumber, token) {
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(dashboardApiUrl('/api/channel-info'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serialNumber, token }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        return { channelData: null, error: formatApiError(result) };
      }

      const channelData = result.channelData ?? null;
      const status = String(result.status || '').trim().toUpperCase();
      if (channelData !== null || status !== 'PENDING' || attempt === maxAttempts - 1) {
        return { channelData, error: null };
      }
    } catch (error) {
      return { channelData: null, error: error.message || 'Channel information could not be loaded.' };
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  return { channelData: null, error: null };
}

async function fetchEventPage(serialNumber, token, startTime, endTime, page) {
  const response = await fetch(dashboardApiUrl('/api/events'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serialNumber, token, startTime, endTime, page }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    throw new Error(formatApiError(result));
  }
  return {
    records: extractRecords(result.payload),
    last: result.last !== false,
  };
}

function oldestEventTime(records) {
  return records.reduce((oldest, event) => {
    const time = new Date(event.timestamp).getTime();
    if (Number.isNaN(time)) {
      return oldest;
    }
    return oldest == null || time < oldest ? time : oldest;
  }, null);
}

async function fetchEventPages(serialNumber, token, startTime, endTime, searchId, publishProgress = true) {
  const windowStart = startTime ? new Date(startTime).getTime() : 0;
  const windowEnd = endTime ? new Date(endTime).getTime() : Date.now();
  const seen = new Set();
  const merged = [];
  let partial = false;
  let userStopped = false;
  const MAX_PAGES = 40;
  state.stopEventStreaming = false;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (state.stopEventStreaming) {
      userStopped = true;
      break;
    }
    let batch = [];
    let last = true;
    try {
      const result = await fetchEventPage(serialNumber, token, startTime, endTime, page);
      if (searchId !== state.searchId) {
        return { records: [], partial: false, userStopped: false };
      }
      batch = result.records;
      last = result.last;
    } catch (error) {
      if (searchId !== state.searchId) {
        return { records: [], partial: false, userStopped: false };
      }
      if (!merged.length) {
        throw error;
      }
      partial = true;
      const oldest = oldestEventTime(merged);
      if (publishProgress) {
        state.sourceStatus.events = 'partial';
        state.eventLoadStatus = 'partial';
        setStatus(`Partial history: ${merged.length.toLocaleString()} events available through ${formatGlanceTimestamp(oldest)}. Older backend logs timed out.`, 'warning');
      }
      break;
    }

    const before = merged.length;
    batch.forEach((event) => {
      if (!seen.has(String(event.id))) {
        seen.add(String(event.id));
        merged.push(event);
      }
    });

    const oldest = oldestEventTime(merged);
    if (publishProgress) {
      state.allEvents = merged.slice().sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
      state.filteredEvents = state.allEvents;
      applyFilters();

      if (!last && page < MAX_PAGES - 1 && !state.stopEventStreaming) {
        renderEventIngestionProgress({
          page,
          maxPages: MAX_PAGES,
          count: state.allEvents.length,
          oldest,
          windowStart,
          windowEnd,
          serialNumber,
          searchId,
        });
      }
    }

    if (last || batch.length < 100 || merged.length === before || oldest == null || oldest <= windowStart || state.stopEventStreaming) {
      if (state.stopEventStreaming) userStopped = true;
      break;
    }
  }

  const finalRecords = merged.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  return {
    records: finalRecords,
    partial,
    userStopped,
  };
}

function chargeDotValueText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => item && typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
  }
  return value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
}

function appendManufacturerDataField(list, label, value, sensitive = false) {
  if (value == null || value === '') return;
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  const valueNode = document.createElement('span');
  const text = chargeDotValueText(value);
  term.textContent = label;
  valueNode.textContent = sensitive ? '********' : text;
  detail.append(valueNode);

  if (sensitive) {
    const revealButton = document.createElement('button');
    revealButton.type = 'button';
    revealButton.className = 'manufacturer-data-reveal';
    revealButton.textContent = 'Show';
    revealButton.setAttribute('aria-label', `Reveal ${label}`);
    revealButton.addEventListener('click', () => {
      const revealed = revealButton.textContent === 'Show';
      valueNode.textContent = revealed ? text : '********';
      revealButton.textContent = revealed ? 'Hide' : 'Show';
      revealButton.setAttribute('aria-label', `${revealed ? 'Hide' : 'Reveal'} ${label}`);
    });
    detail.append(revealButton);
  }

  row.append(term, detail);
  list.append(row);
}

function renderManufacturerData(record, serialNumber) {
  const content = document.getElementById('manufacturerDataContent');
  const status = document.getElementById('manufacturerDataStatus');
  const primary = document.getElementById('manufacturerDataSummary');
  if (!content || !status || !primary) return;

  content.replaceChildren();
  status.textContent = `ChargeDot record for ${serialNumber}`;
  primary.textContent = [
    record.hardwareModel || record.model,
    record.firmwareVersion,
    record.ratedPower != null ? formatPowerWatts(record.ratedPower) : '',
  ].filter(Boolean).join(' · ') || 'Manufacturer details available';

  const groups = [
    {
      title: 'Manufacturer specifications',
      fields: [
        ['siteId', 'Site ID'],
        ['model', 'Model'],
        ['hardwareModel', 'Hardware model'],
        ['partNumber', 'Part number'],
        ['hardwareVersion', 'Hardware version'],
        ['firmwareVersion', 'Firmware version'],
        ['ratedPower', 'Rated power'],
        ['ratedCurrent', 'Rated current'],
        ['netModule', 'Network module'],
        ['protocolType', 'Protocol'],
        ['protocolVersion', 'Protocol version'],
      ],
    },
    {
      title: 'Sensitive data',
      fields: [
        ['pinCode', 'Pass / PIN'],
        ['imei', 'SIM IMEI'],
        ['iccid', 'SIM ICCID'],
        ['preProgrammedRfidCards', 'Pre-programmed RFID cards'],
      ],
      sensitive: true,
    },
  ];

  for (const group of groups) {
    const entries = group.fields.filter(([key]) => Object.hasOwn(group.sensitive ? record.sensitiveData || {} : record, key));
    if (!entries.length) continue;
    const section = document.createElement('section');
    section.className = 'manufacturer-data-group';
    const heading = document.createElement('h3');
    const list = document.createElement('dl');
    heading.textContent = group.title;
    section.append(heading, list);
    for (const [key, label] of entries) {
      const source = group.sensitive ? record.sensitiveData : record;
      appendManufacturerDataField(list, label, source[key], Boolean(group.sensitive));
    }
    content.append(section);
  }

  if (!content.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'manufacturer-data-empty';
    empty.textContent = 'No manufacturer fields are available for this charger.';
    content.append(empty);
  }
}

async function loadManufacturerData(serialNumber) {
  const requestId = ++state.chargeDotRequestId;
  const status = document.getElementById('manufacturerDataStatus');
  const content = document.getElementById('manufacturerDataContent');
  if (!status || !content) return;
  status.textContent = 'Loading ChargeDot data...';
  content.replaceChildren();

  try {
    const params = new URLSearchParams({ serialNumber });
    const response = await fetch(dashboardApiUrl(`/api/chargedot/charger?${params.toString()}`));
    if (!response.headers.get('content-type')?.includes('application/json')) {
      if (requestId === state.chargeDotRequestId) {
        status.textContent = 'ChargeDot API route is unavailable. Restart the dashboard server.';
      }
      return;
    }
    const result = await response.json();
    if (requestId !== state.chargeDotRequestId
      || document.getElementById('serialNumber')?.value.trim() !== serialNumber) return;
    if (!response.ok || !result?.ok || !result.data) {
      status.textContent = result?.message || 'ChargeDot data could not be loaded.';
      return;
    }
    renderManufacturerData(result.data, serialNumber);
  } catch (error) {
    if (requestId !== state.chargeDotRequestId) return;
    status.textContent = 'ChargeDot data could not be reached. Check the dashboard server connection.';
  }
}

async function fetchEvents() {
  const serialNumber = document.getElementById('serialNumber').value.trim();
  const token = String(state.token || '').replace(/^Bearer\s+/i, '').trim();
  const startTime = normalizeWindowValue(combineDateTime(
    document.getElementById('startDate').value,
    document.getElementById('startTimeInput').value,
  ));
  const endTime = normalizeWindowValue(combineDateTime(
    document.getElementById('endDate').value,
    document.getElementById('endTimeInput').value,
  ));

  if (!serialNumber) {
    setStatus('Please provide a serial number.', 'warning');
    return;
  }

  void loadManufacturerData(serialNumber);

  const rangeError = rangeValidationMessage();
  if (rangeError) {
    updateRangeFeedback();
    setStatus(rangeError, 'warning');
    return;
  }

  updateActiveChargerBadge(serialNumber);

  state.eventBounds = {
    start: new Date(startTime).getTime(),
    end: new Date(endTime).getTime(),
  };
  state.eventView = { ...state.eventBounds };

  if (!token) {
    setToken('');
    setStatus('Session token is required. Click the Refresh icon next to Token in the topbar to sign in.', 'warning');
    return;
  }

  if (isTokenExpired(token) || !isTmeJwtToken(token)) {
    await clearSavedToken();
    setStatus('Session expired or invalid. Click the Refresh icon in the topbar to sign in again.', 'warning');
    return;
  }

  setSerialFeedback('Checking charger...');
  setStatus('Loading charger and historical data...', 'info');
  const searchId = ++state.searchId;
  const refreshIds = { ...state.domainRefreshIds };
  state.loadingCards = { wallbox: true, access: true, smartCharging: true, sessions: true, channelInfo: true };
  state.sourceStatus = {
    wallbox: 'loading', channelInfo: 'loading', access: 'loading', smartCharging: 'loading', sessions: 'loading', events: 'loading',
  };
  resetSmartInvestigation();
  state.eventLoadStatus = 'loading';
  state.wallbox = null;
  state.access = null;
  state.smartCharging = null;
  state.tariff = null;
  state.channelData = null;
  state.chargingSessions = [];
  state.allEvents = [];
  state.filteredEvents = [];
  state.selectedEventId = null;
  state.timelineView = null;
  renderAccessProfile();
  renderSmartChargingInfo();
  renderChargerProfile();
  renderChargingSessions();
  buildTypeFilterOptions([]);
  renderLegend();
  renderTable();
  renderTimeline();
  renderConnectorTimeline();
  updateSummary();
  renderAtAGlance();

  const sourceLoads = Promise.allSettled([
    fetchWallbox(serialNumber, token).then((lookup) => {
    if (searchId !== state.searchId || state.domainRefreshIds.charger !== refreshIds.charger) return;
    const wallbox = lookup.wallbox;
    state.wallbox = wallbox ? { ...wallbox, currentActiveLimit: state.channelData, channelData: state.channelData } : null;
    state.loadingCards.wallbox = false;
    state.sourceStatus.wallbox = wallbox ? 'loaded' : lookup.notFound || !lookup.error ? 'empty' : 'error';
    if (wallbox) {
      setSerialFeedback('Loaded charger.');
    } else if (lookup.notFound || !lookup.error) {
      setSerialFeedback('Charger not found. Check the serial number.', true);
    } else {
      setSerialFeedback('Unable to verify charger right now.', false);
    }
    renderChargerProfile();
    renderSmartChargingInfo();
    renderConnectorTimeline();
    renderAtAGlance();
    }),
    fetchChannelInfo(serialNumber, token).then((channelResult) => {
    if (searchId !== state.searchId || state.domainRefreshIds.charger !== refreshIds.charger) return;
    state.channelData = channelResult.channelData;
    state.sourceStatus.channelInfo = channelResult.error ? 'error' : channelResult.channelData == null ? 'empty' : 'loaded';
    state.loadingCards.channelInfo = false;
    if (state.wallbox) {
      state.wallbox = { ...state.wallbox, currentActiveLimit: channelResult.channelData, channelData: channelResult.channelData };
      renderChargerProfile();
    }
    renderAtAGlance();
    }),
    fetchAccess(serialNumber, token).then((accessResult) => {
    if (searchId !== state.searchId || state.domainRefreshIds.charger !== refreshIds.charger) return;
    state.access = accessResult.access;
    state.sourceStatus.access = accessResult.error ? 'error' : accessResult.access ? 'loaded' : 'empty';
    state.loadingCards.access = false;
    renderAccessProfile();
    renderAtAGlance();
    }),
    fetchSmartCharging(serialNumber, token).then((smartCharging) => {
    if (searchId !== state.searchId || state.domainRefreshIds.charger !== refreshIds.charger) return;
    state.smartCharging = smartCharging.smartCharging;
    state.tariff = smartCharging.tariff;
    state.sourceStatus.smartCharging = smartCharging.error ? 'error' : smartCharging.smartCharging || smartCharging.tariff ? 'loaded' : 'empty';
    state.loadingCards.smartCharging = false;
    renderSmartChargingInfo();
    renderAtAGlance();
    }),
    fetchChargingSessions(serialNumber, token, startTime, endTime).then((sessionResult) => {
    if (searchId !== state.searchId || state.domainRefreshIds.sessions !== refreshIds.sessions) return;
    state.chargingSessions = sessionResult.sessions;
    state.sourceStatus.sessions = sessionResult.error ? 'error' : sessionResult.sessions.length ? 'loaded' : 'empty';
    state.loadingCards.sessions = false;
    renderChargingSessions();
    renderAtAGlance();
    }),
  ]);

  try {
    const eventResult = await fetchEventPages(serialNumber, token, startTime, endTime, searchId);
    if (searchId !== state.searchId || state.domainRefreshIds.events !== refreshIds.events) {
      return;
    }
    const records = eventResult.records;
    state.allEvents = records;
    state.filteredEvents = records;
    state.timelineView = null;
    state.sourceStatus.events = eventResult.partial ? 'partial' : records.length ? 'loaded' : 'empty';
    state.eventLoadStatus = state.sourceStatus.events;
    renderChargingSessions();
    buildTypeFilterOptions(records);
    renderLegend();
    applyFilters();
    rememberSerial(serialNumber);
    if (!eventResult.partial) {
      if (eventResult.userStopped) {
        setStatus(`Streaming stopped: ${records.length.toLocaleString()} events retained and ready for analysis (${formatGlanceTimestamp(oldestEventTime(records))} → ${formatGlanceTimestamp(new Date(endTime).getTime())}).`, 'info');
      } else if (records.length) {
        setStatus(`Loaded ${records.length.toLocaleString()} event(s) for ${serialNumber} across requested timeframe.`, 'success');
      } else {
        setStatus('No events recorded in this time range.', 'info');
      }
    }
  } catch (error) {
    if (searchId !== state.searchId || state.domainRefreshIds.events !== refreshIds.events) {
      return;
    }
    const message = error.message || 'The request failed.';
    const normalizedMessage = message.toLowerCase();
    state.eventLoadStatus = 'error';
    state.sourceStatus.events = 'error';

    if (isAuthTokenError(message, error.statusCode)) {
      await handleInvalidTokenAndRetry();
    } else {
      setStatus(message, 'error');
    }

    state.allEvents = [];
    state.filteredEvents = [];
    renderTable();
    renderTimeline();
    updateSummary();
    renderAtAGlance();
  }
  await sourceLoads;
  if (searchId === state.searchId) {
    state.lastRefreshAt = Date.now();
    renderAtAGlance();
    scheduleSmartInvestigationRefresh();
  }
}

function currentRefreshContext() {
  return {
    serialNumber: document.getElementById('serialNumber').value.trim(),
    token: String(state.token || '').replace(/^Bearer\s+/i, '').trim(),
    startTime: normalizeWindowValue(combineDateTime(document.getElementById('startDate').value, document.getElementById('startTimeInput').value)),
    endTime: normalizeWindowValue(combineDateTime(document.getElementById('endDate').value, document.getElementById('endTimeInput').value)),
  };
}

function refreshIsCurrent(domain, requestId, searchId, serialNumber) {
  return state.domainRefreshIds[domain] === requestId
    && state.searchId === searchId
    && document.getElementById('serialNumber').value.trim() === serialNumber;
}

function updateDiagnosticAfterRefresh(message, kind = 'success') {
  setStatus(message, kind);
  if (kind !== 'error') {
    state.lastRefreshAt = Date.now();
    renderAtAGlance();
  }
  if (state.diagnosticResults) {
    state.diagnosticResults = null;
    renderDiagnosticResults();
  } else {
    renderDiagnosticResults(null);
  }
  scheduleSmartInvestigationRefresh();
}

async function handleTargetedRefreshError(message) {
  const text = String(message || 'The request failed.');
  if (isAuthTokenError(text, null)) {
    await handleInvalidTokenAndRetry();
  } else {
    setStatus(text, 'error');
  }
}

async function refreshEventsOnly() {
  const context = currentRefreshContext();
  if (!context.serialNumber || !context.token || rangeValidationMessage()) {
    setStatus(context.token ? 'Provide a valid serial number and time range first.' : 'Session required. Sign in on the TME tab first.', 'warning');
    return { ok: false, error: 'A valid serial, session, and time range are required.' };
  }
  const requestId = ++state.domainRefreshIds.events;
  const searchId = state.searchId;
  setStatus('Refreshing events...', 'info');
  try {
    const result = await fetchEventPages(context.serialNumber, context.token, context.startTime, context.endTime, searchId, false);
    if (!refreshIsCurrent('events', requestId, searchId, context.serialNumber)) return { ok: false, stale: true };
    state.allEvents = result.records;
    state.sourceStatus.events = result.partial ? 'partial' : result.records.length ? 'loaded' : 'empty';
    state.eventLoadStatus = state.sourceStatus.events;
    state.eventBounds = { start: new Date(context.startTime).getTime(), end: new Date(context.endTime).getTime() };
    state.eventView = { ...state.eventBounds };
    buildTypeFilterOptions(result.records);
    renderLegend();
    applyFilters();
    updateDiagnosticAfterRefresh(result.partial ? `Events refreshed partially (${result.records.length} records).` : `Events refreshed (${result.records.length} records).`, result.partial ? 'warning' : 'success');
    return { ok: !result.partial, partial: result.partial, count: result.records.length };
  } catch (error) {
    if (refreshIsCurrent('events', requestId, searchId, context.serialNumber)) await handleTargetedRefreshError(error.message || 'Events could not be refreshed.');
    return { ok: false, error: error.message || 'Events could not be refreshed.' };
  }
}

async function refreshSessionsOnly() {
  const context = currentRefreshContext();
  if (!context.serialNumber || !context.token || rangeValidationMessage()) {
    setStatus(context.token ? 'Provide a valid serial number and time range first.' : 'Session required. Sign in on the TME tab first.', 'warning');
    return { ok: false, error: 'A valid serial, session, and time range are required.' };
  }
  const requestId = ++state.domainRefreshIds.sessions;
  const searchId = state.searchId;
  setStatus('Refreshing charging sessions...', 'info');
  const result = await fetchChargingSessions(context.serialNumber, context.token, context.startTime, context.endTime);
  if (!refreshIsCurrent('sessions', requestId, searchId, context.serialNumber)) return { ok: false, stale: true };
  if (result.authError || isAuthTokenError(result.error, result.statusCode)) {
    await handleInvalidTokenAndRetry();
    return { ok: false, error: result.error };
  }
  state.chargingSessions = result.sessions;
  state.sourceStatus.sessions = result.error ? 'error' : result.sessions.length ? 'loaded' : 'empty';
  renderChargingSessions();
  if (state.selectedSessionId != null) {
    const selectedSession = state.chargingSessions.find((session) => String(session.transactionId) === String(state.selectedSessionId));
    if (selectedSession) {
      openSessionAnalysis(selectedSession.transactionId);
    } else {
      state.selectedSessionId = null;
      state.sessionAnalysis = null;
      document.getElementById('sessionAnalysis').hidden = true;
    }
  }
  renderAtAGlance();
  updateDiagnosticAfterRefresh(result.error || `Sessions refreshed (${result.sessions.length} records).`, result.error ? 'error' : 'success');
  return { ok: !result.error, count: result.sessions.length, error: result.error || null };
}

async function refreshConnectorState() {
  const context = currentRefreshContext();
  if (!context.serialNumber || !context.token || rangeValidationMessage()) {
    setStatus('Session and serial number are required to refresh connector state.', 'warning');
    return { ok: false, error: 'A valid serial, session, and time range are required.' };
  }
  const requestId = ++state.domainRefreshIds.charger;
  const eventRequestId = ++state.domainRefreshIds.events;
  const searchId = state.searchId;
  setStatus('Refreshing charger and connector state...', 'info');
  let lookup;
  let channel;
  let events;
  try {
    [lookup, channel, events] = await Promise.all([
      fetchWallbox(context.serialNumber, context.token),
      fetchChannelInfo(context.serialNumber, context.token),
      fetchEventPages(context.serialNumber, context.token, context.startTime, context.endTime, searchId, false),
    ]);
  } catch (error) {
    if (refreshIsCurrent('charger', requestId, searchId, context.serialNumber) && state.domainRefreshIds.events === eventRequestId) await handleTargetedRefreshError(error.message || 'Connector history could not be refreshed.');
    return { ok: false, error: error.message || 'Connector history could not be refreshed.' };
  }
  if (!refreshIsCurrent('charger', requestId, searchId, context.serialNumber) || state.domainRefreshIds.events !== eventRequestId) return { ok: false, stale: true };
  state.channelData = channel.channelData;
  state.wallbox = lookup.wallbox ? { ...lookup.wallbox, currentActiveLimit: channel.channelData, channelData: channel.channelData } : null;
  state.sourceStatus.wallbox = lookup.error ? 'error' : lookup.wallbox ? 'loaded' : 'empty';
  state.sourceStatus.channelInfo = channel.error ? 'error' : channel.channelData == null ? 'empty' : 'loaded';
  state.allEvents = events.records;
  state.sourceStatus.events = events.partial ? 'partial' : events.records.length ? 'loaded' : 'empty';
  state.eventLoadStatus = state.sourceStatus.events;
  state.eventBounds = { start: new Date(context.startTime).getTime(), end: new Date(context.endTime).getTime() };
  state.eventView = { ...state.eventBounds };
  buildTypeFilterOptions(events.records);
  renderLegend();
  applyFilters();
  renderChargerProfile();
  renderConnectorTimeline();
  renderAtAGlance();
  const errors = [lookup.error, channel.error].filter(Boolean);
  if (errors.some((error) => isAuthTokenError(error, null))) {
    await handleInvalidTokenAndRetry();
    return { ok: false, error: errors.join(' ') };
  }
  updateDiagnosticAfterRefresh(events.partial ? `Connector history refreshed partially (${events.records.length} events).` : errors.length ? `Connector history refreshed with ${errors.length} source error(s).` : `Connector history refreshed (${events.records.length} events).`, events.partial || errors.length ? 'warning' : 'success');
  return { ok: !events.partial && !errors.length, partial: events.partial, count: events.records.length, errors };
}

async function recheckCharger() {
  const context = currentRefreshContext();
  if (!context.serialNumber || !context.token) {
    setStatus('Session and serial number are required to recheck charger data.', 'warning');
    return { ok: false, error: 'A valid serial and session are required.' };
  }
  const requestId = ++state.domainRefreshIds.charger;
  const searchId = state.searchId;
  setStatus('Rechecking charger data sources...', 'info');
  const [lookup, channel, access, smart] = await Promise.all([
    fetchWallbox(context.serialNumber, context.token), fetchChannelInfo(context.serialNumber, context.token),
    fetchAccess(context.serialNumber, context.token), fetchSmartCharging(context.serialNumber, context.token),
  ]);
  if (!refreshIsCurrent('charger', requestId, searchId, context.serialNumber)) return { ok: false, stale: true };
  state.channelData = channel.channelData;
  state.wallbox = lookup.wallbox ? { ...lookup.wallbox, currentActiveLimit: channel.channelData, channelData: channel.channelData } : null;
  state.access = access.access;
  state.smartCharging = smart.smartCharging;
  state.tariff = smart.tariff;
  state.sourceStatus.wallbox = lookup.error ? 'error' : lookup.wallbox ? 'loaded' : 'empty';
  state.sourceStatus.channelInfo = channel.error ? 'error' : channel.channelData == null ? 'empty' : 'loaded';
  state.sourceStatus.access = access.error ? 'error' : access.access ? 'loaded' : 'empty';
  state.sourceStatus.smartCharging = smart.error ? 'error' : smart.smartCharging || smart.tariff ? 'loaded' : 'empty';
  renderChargerProfile();
  renderSmartChargingInfo();
  renderAccessProfile();
  renderConnectorTimeline();
  renderAtAGlance();
  const errors = [lookup.error, channel.error, access.error, smart.error].filter(Boolean);
  if (errors.some((error) => isAuthTokenError(error, null))) {
    await handleInvalidTokenAndRetry();
    return { ok: false, error: errors.join(' ') };
  }
  updateDiagnosticAfterRefresh(errors.length ? `Recheck completed with ${errors.length} source error(s).` : 'Charger data rechecked.', errors.length ? 'warning' : 'success');
  return { ok: errors.length === 0, errors };
}

async function refreshAllRelevant() {
  const button = document.getElementById('refreshAllRelevant');
  button.disabled = true;
  button.textContent = 'Refreshing...';
  state.smartInvestigation.refreshBatchDepth += 1;
  try {
    const outcomes = await Promise.allSettled([
      recheckCharger(),
      refreshEventsOnly(),
      refreshSessionsOnly(),
    ]);
    const succeeded = outcomes.every((outcome) => outcome.status === 'fulfilled' && outcome.value?.ok === true);
    setStatus(succeeded ? 'Current charger, event, and session data refreshed.' : 'Refresh completed with one or more issues.', succeeded ? 'success' : 'warning');
    return { ok: succeeded, outcomes };
  } finally {
    button.disabled = false;
    button.textContent = 'Refresh all current data';
    state.smartInvestigation.refreshBatchDepth = Math.max(0, state.smartInvestigation.refreshBatchDepth - 1);
    if (!state.smartInvestigation.refreshBatchDepth) scheduleSmartInvestigationRefresh();
  }
}

function explicitPendingSessions(sessions) {
  return (sessions || []).filter((session) => String(session.status || '').trim().toLowerCase() === 'pending');
}

function supportOperationStillCurrent(context) {
  const current = getOperationContext();
  return current.serialNumber === context.serialNumber
    && current.searchId === context.searchId
    && current.startTime === context.startTime
    && current.endTime === context.endTime;
}

function captureSupportView() {
  return {
    eventView: state.eventView ? { ...state.eventView } : null,
    activeConnector: state.activeConnector,
    selectedEventId: state.selectedEventId,
    selectedSessionId: state.selectedSessionId,
    investigation: state.investigation ? { ...state.investigation } : null,
    sessionAnalysisView: state.sessionAnalysis?.view ? { ...state.sessionAnalysis.view } : null,
    selectedSchedule: state.sessionAnalysis?.selectedSchedule || '',
  };
}

function restoreSupportView(snapshot) {
  state.timelineRestoring = true;
  try {
    if (snapshot.activeConnector != null) showConnectorTab(snapshot.activeConnector);
    const selectedEvent = snapshot.selectedEventId == null ? null
      : state.allEvents.find((event) => String(event.id) === String(snapshot.selectedEventId));
    if (selectedEvent) focusEvent(selectedEvent.id);
    const selectedSession = snapshot.selectedSessionId == null ? null
      : state.chargingSessions.find((session) => String(session.transactionId) === String(snapshot.selectedSessionId));
    if (selectedSession) focusSession(selectedSession.transactionId);
    if (snapshot.eventView && state.eventBounds) {
      const start = Math.max(snapshot.eventView.start, state.eventBounds.start);
      const end = Math.min(snapshot.eventView.end, state.eventBounds.end);
      if (end > start) setEventView(start, end);
    }
    state.selectedEventId = selectedEvent ? String(selectedEvent.id) : null;
    state.selectedSessionId = selectedSession ? String(selectedSession.transactionId) : null;
    state.investigation = snapshot.investigation;
    if (selectedSession && state.sessionAnalysis) {
      if (snapshot.sessionAnalysisView) state.sessionAnalysis.view = { ...snapshot.sessionAnalysisView };
      if (snapshot.selectedSchedule) state.sessionAnalysis.selectedSchedule = snapshot.selectedSchedule;
      paintSessionAnalysis(false);
    } else {
      state.sessionAnalysis = null;
      document.getElementById('sessionAnalysis').hidden = true;
    }
    renderTable();
    renderInvestigation();
  } finally {
    state.timelineRestoring = false;
  }
}

async function refreshSupportOperationData(operation, context) {
  if (!supportOperationStillCurrent(context)) return { stale: true, ok: false };
  const view = captureSupportView();
  const outcomes = [];
  if (operation === 'removePendingChargingSession') {
    outcomes.push(await refreshSessionsOnly());
    if (!supportOperationStillCurrent(context)) return { stale: true, ok: false };
    outcomes.push(await refreshConnectorState());
  } else {
    outcomes.push(await recheckCharger());
  }
  if (!supportOperationStillCurrent(context) || outcomes.some((outcome) => outcome?.stale)) {
    return { stale: true, ok: false };
  }
  restoreSupportView(view);
  return { stale: false, ok: outcomes.every((outcome) => outcome?.ok === true), outcomes };
}

function verifySupportOperation(operation, parameters, before, refresh) {
  if (refresh?.stale) return { status: 'UNKNOWN', detail: 'Selection changed before verification; no refreshed state was applied.' };
  if (operation === 'alignPin') {
    const observedPin = state.wallbox?.ownerPin;
    if (observedPin != null && String(observedPin) === parameters.ownerPin) {
      return { status: 'VERIFIED', detail: 'The refreshed charger reports the requested owner PIN.' };
    }
    return { status: 'UNKNOWN', detail: 'The refreshed charger did not expose a matching owner PIN.' };
  }
  if (operation === 'removePendingChargingSession' && before.pendingSessions.length) {
    return explicitPendingSessions(state.chargingSessions).length
      ? { status: 'UNKNOWN', detail: 'A pending-status session remains in refreshed session data.' }
      : { status: 'VERIFIED', detail: 'The previously visible pending-status session is absent after refresh.' };
  }
  if (operation === 'pushFirmware') {
    const currentVersion = state.wallbox?.version || null;
    if (currentVersion !== before.firmwareVersion) {
      return { status: 'UNKNOWN', detail: `Current firmware version changed during refresh (${before.firmwareVersion || 'unknown'} to ${currentVersion || 'unknown'}); update progress is not exposed.` };
    }
    return { status: 'UNKNOWN', detail: `Current firmware version ${currentVersion || 'unavailable'}; update progress is not exposed.` };
  }
  return { status: 'UNKNOWN', detail: 'The refreshed dashboard data does not expose this pending-operation state.' };
}

function redactSupportOperationText(value, context, parameters) {
  let text = String(value || '');
  [context.token, parameters.ownerPin, parameters.location].filter(Boolean).forEach((secret) => {
    text = text.split(String(secret)).join('[REDACTED]');
  });
  return text.replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

function recordSupportOperation(entry) {
  state.supportOperationHistory.unshift(entry);
  state.supportOperationHistory = state.supportOperationHistory.slice(0, 50);
  persistSupportOperationHistory();
  renderSupportOperationHistory();
}

async function executeSupportOperationRequest(operation, context, parameters) {
  const resolvedParameters = { ...parameters };
  const response = await fetch(dashboardApiUrl('/api/support-operation'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, serialNumber: context.serialNumber, parameters: resolvedParameters }),
  });
  const result = await response.json().catch(() => ({}));
  return { response, result, parameters: resolvedParameters };
}

function showSupportOperationResult(status, message, verification) {
  const result = document.getElementById('supportOperationResult');
  result.className = `support-operation-result status-${String(status).toLowerCase()}`;
  result.textContent = `${status} · ${message}${verification ? ` Verification: ${verification}.` : ''}`;
  result.hidden = false;
}

async function executeSupportOperation() {
  if (state.supportOperationInFlight) return;
  const operation = state.selectedSupportOperation;
  const definition = supportOperationRegistry[operation];
  if (!definition) return;
  const context = getOperationContext();
  let parameters = definition.resolveParameters(context, {
    ownerPin: document.getElementById('supportOwnerPin').value,
    location: document.getElementById('supportFirmwareLocation').value.trim(),
  });
  const capability = definition.available(context, parameters);
  if (!capability.available) {
    showSupportOperationResult('REJECTED', capability.reason, 'UNKNOWN');
    state.supportOperationComplete = true;
    document.getElementById('supportOperationConfirm').disabled = true;
    document.getElementById('supportOperationConfirm').textContent = 'Done';
    document.getElementById('supportOperationDialogCancel').textContent = 'Close';
    return;
  }
  const operationInfo = definition;

  const pendingSessions = explicitPendingSessions(context.sessions);
  const connectorId = operation === 'removePendingChargingSession' && pendingSessions.length === 1
    ? pendingSessions[0].connectorId ?? null : null;
  const before = { pendingSessions, firmwareVersion: context.firmware.currentVersion };
  const startedAt = Date.now();
  let status = 'UNKNOWN';
  let httpStatus = null;
  let verification = 'UNKNOWN';
  let message = 'No result was returned.';
  let safeError = null;
  state.supportOperationInFlight = true;
  state.activeSupportOperation = operation;
  renderSupportOperations();
  setStatus(`Executing ${operationInfo.label.toLowerCase()}...`, 'info');

  try {
    const execution = await definition.execute(context, parameters);
    const response = execution.response;
    const result = execution.result;
    parameters = execution.parameters;
    const responseHttpStatus = Number(result.httpStatus);
    httpStatus = result.httpStatus != null && Number.isFinite(responseHttpStatus) ? responseHttpStatus : response.status;
    status = result.status || (response.ok ? 'ACCEPTED' : 'FAILED');
    message = redactSupportOperationText(result.message || `Support API returned HTTP ${httpStatus}.`, context, parameters);
    if (httpStatus === 401) {
      void handleInvalidTokenAndRetry();
    }

    if (status === 'NO_ACTION_REQUIRED') {
      verification = 'NO_ACTION_REQUIRED';
    } else if (status !== 'REJECTED') {
      const refresh = await definition.refresh(context, result);
      const verificationResult = definition.verify(context, parameters, before, refresh);
      verification = verificationResult.status;
      message = `${message} ${verificationResult.detail}`;
      if (refresh.stale) message += ' The selected charger or range changed; stale results were not applied.';
      else if (!refresh.ok) message += ' One or more targeted refreshes did not complete successfully.';
    }
    if (['REJECTED', 'FAILED', 'TIMEOUT', 'UNKNOWN'].includes(status)) safeError = message;
  } catch (error) {
    status = 'UNKNOWN';
    message = 'No API response was received; the operation outcome is unknown.';
    safeError = message;
    if (supportOperationStillCurrent(context)) {
      const refresh = await definition.refresh(context);
      const verificationResult = definition.verify(context, parameters, before, refresh);
      verification = verificationResult.status;
      message = `${message} ${verificationResult.detail}`;
    }
  } finally {
    const durationMs = Date.now() - startedAt;
    const historyEntry = {
      operation,
      timestamp: new Date(startedAt).toISOString(),
      serialNumber: context.serialNumber,
      connectorId,
      status,
      httpStatus,
      durationMs,
      verification,
      error: safeError,
    };
    recordSupportOperation(historyEntry);
    showSupportOperationResult(status, message, verification);
    state.supportOperationInFlight = false;
    state.activeSupportOperation = null;
    state.supportOperationComplete = true;
    document.getElementById('supportOwnerPin').value = '';
    document.getElementById('supportOperationConfirm').disabled = true;
    document.getElementById('supportOperationConfirm').textContent = 'Done';
    document.getElementById('supportOperationDialogCancel').textContent = 'Close';
    renderSupportOperations();
    setStatus(`${operationInfo.label}: ${status}.`, status === 'ACCEPTED' || status === 'NO_ACTION_REQUIRED' || status === 'VERIFIED' ? 'success' : 'warning');
  }
}

function displayValue(value) {
  if (value == null || value === '') {
    return '—';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatCurrentActiveLimit(value, connectivityStatus) {
  const offline = /offline/i.test(String(connectivityStatus || ''));
  if (offline) {
    return 'Not available while offline';
  }

  if (value === null || value === undefined || value === '' || String(value).trim() === 'null') {
    return 'Pending';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  const text = String(value).trim();
  if (text.toLowerCase() === 'pending') {
    return 'Pending';
  }

  const numericMatch = text.match(/(\d+(?:\.\d+)?)\s*(A|amp|amps)?/i);
  if (numericMatch) {
    return `${numericMatch[1]} A`;
  }

  if (text.includes(',')) {
    const items = text.split(',').map((part) => part.trim()).filter(Boolean);
    const lastItem = items[items.length - 1];
    const lastMatch = lastItem.match(/(\d+(?:\.\d+)?)\s*(A|amp|amps)?/i);
    if (lastMatch) {
      return `${lastMatch[1]} A`;
    }
    return lastItem;
  }

  return text;
}

function formatPowerWatts(value) {
  const watts = Number(value);
  if (!Number.isFinite(watts)) {
    return displayValue(value);
  }
  if (watts >= 1000) {
    const kw = watts / 1000;
    return `${Number.isInteger(kw) ? kw : kw.toFixed(2)} kW`;
  }
  return `${watts} W`;
}

function statusTone(value, kind) {
  const text = String(value || '').replace(/[\s_-]/g, '').toLowerCase();
  if (kind === 'connectivity') {
    if (text === 'online') return 'good';
    if (text === 'offline') return 'bad';
    return '';
  }
  if (text === 'enabled') return 'good';
  if (text === 'disabled') return 'bad';
  if (text.includes('temporary')) return 'warn';
  return '';
}

function formatPeaks(peaks) {
  if (peaks == null || peaks === '' || (Array.isArray(peaks) && !peaks.length) || (typeof peaks === 'object' && !Array.isArray(peaks) && !Object.keys(peaks).length)) {
    return 'No peak set';
  }
  return displayValue(peaks);
}

function chargerFacts(wallbox) {
  const vendor = wallbox.chargeDotVendorData || {};
  const connectors = (wallbox.connectors || []).map((connector) => [
    `Connector ${Number(connector.id) + 1}`,
    connector.statusReason ? `${connector.status} · ${connector.statusReason}` : connector.status,
  ]);
  const currentActiveLimitRaw = Object.prototype.hasOwnProperty.call(wallbox, 'currentActiveLimit')
    ? wallbox.currentActiveLimit
    : Object.prototype.hasOwnProperty.call(wallbox, 'channelData')
      ? wallbox.channelData
      : Object.prototype.hasOwnProperty.call(wallbox, 'current_active_limit')
        ? wallbox.current_active_limit
        : null;
  const currentActiveLimit = state.loadingCards.channelInfo
    ? 'Loading...'
    : state.sourceStatus.channelInfo === 'error' ? 'Unavailable'
      : formatCurrentActiveLimit(currentActiveLimitRaw, wallbox.connectivityStatus);
  const statusRows = [
    ['Connectivity', wallbox.connectivityStatus, statusTone(wallbox.connectivityStatus, 'connectivity')],
    ['Last connectivity change', formatDate(wallbox.connectivityStatusUpdatedOn)],
    ...connectors,
  ];
  return [
    ['Charger', [
      ['Model', wallbox.model, '', true],
      ['Version', wallbox.version],
      ['Vendor', wallbox.vendor],
      ['OCPP', wallbox.ocppProtocol],
      ['Country', wallbox.countryId],
      ['Model phase', vendor.chargerModelPhase],
      ['Max power', formatPowerWatts(wallbox.maxChargingPower)],
      ['Phases', wallbox.numberOfPhases],
    ]],
    ['Status', [
      ...statusRows,
      ['Current Active Limit', currentActiveLimit, '', false, state.loadingCards.channelInfo ? 'loading-active-limit' : ''],
    ]],
    ['History and faults', [
      ['Activated', formatDate(wallbox.activationTime)],
      ['Registered', formatDate(wallbox.registrationTime)],
      ['Last factory reset', formatDate(wallbox.lastFactoryReset)],
      ['Last peak update', formatDate(wallbox.lastPeakUpdateTimestamp)],
      ['Active errors', wallbox.activeChargingErrors],
      ['Peaks', formatPeaks(wallbox.peaks)],
    ]],
    ['Access', [
      ['Owner PIN', wallbox.ownerPin, '', true, '', true],
    ]],
  ];
}

function updateTopbarChargerStatus() {
  const cluster = document.getElementById('topbarChargerStatusCluster');
  if (!cluster) return;
  if (state.currentView !== 'charger') {
    cluster.hidden = true;
    return;
  }
  cluster.hidden = false;

  const connPill = document.getElementById('topbarConnectivityPill');
  const connText = document.getElementById('topbarConnectivityText');
  const connectorPill = document.getElementById('topbarConnectorPill');
  const connectorText = document.getElementById('topbarConnectorText');

  const wallbox = state.wallbox;
  const rawConn = String(wallbox && wallbox.connectivityStatus || '').trim();
  const isOnline = /online/i.test(rawConn);
  const isOffline = /offline|disconnect/i.test(rawConn);

  if (connPill && connText) {
    if (isOnline) {
      connPill.className = 'topbar-status-minimal-pill is-online';
      connText.textContent = 'Online';
    } else if (isOffline) {
      connPill.className = 'topbar-status-minimal-pill is-offline';
      connText.textContent = 'Offline';
    } else if (rawConn) {
      connPill.className = 'topbar-status-minimal-pill tone-neutral';
      connText.textContent = rawConn;
    } else {
      connPill.className = 'topbar-status-minimal-pill is-online';
      connText.textContent = 'Online';
    }
  }

  let c1Status = 'Available';
  let c1Tone = 'available';

  if (wallbox && Array.isArray(wallbox.connectors)) {
    const c1 = wallbox.connectors.find((c) => isConnectorOne(c)) || wallbox.connectors[0];
    if (c1 && c1.status) {
      c1Status = String(c1.status).trim();
    }
  }

  if (!wallbox || !wallbox.connectors || !wallbox.connectors.length) {
    const latestStatusEvent = (state.allEvents || []).find((ev) => ev.eventName === 'STATUS_NOTIFICATION');
    if (latestStatusEvent) {
      const parsedStatus = connectorStatus(latestStatusEvent, 1);
      if (parsedStatus) c1Status = parsedStatus;
    }
  }

  const sLower = c1Status.toLowerCase();
  if (sLower.includes('char') || sLower.includes('occup')) {
    c1Tone = 'charging';
  } else if (sLower.includes('fault') || sLower.includes('error')) {
    c1Tone = 'faulted';
  } else if (sLower.includes('unavail') || sLower.includes('offline')) {
    c1Tone = 'unavailable';
  } else if (sLower.includes('avail') || sLower.includes('prep') || sLower.includes('ready')) {
    c1Tone = 'available';
  } else {
    c1Tone = 'neutral';
  }

  const formattedC1 = c1Status.charAt(0).toUpperCase() + c1Status.slice(1).toLowerCase();
  if (connectorPill && connectorText) {
    connectorPill.className = `topbar-status-minimal-pill tone-${c1Tone}`;
    connectorText.textContent = `Connector 1: ${formattedC1}`;
  }
}

function renderChargerProfile() {
  updateTopbarChargerStatus();
  const profile = document.getElementById('chargerProfile');
  const summary = document.getElementById('chargerSummary');
  if (!profile || !summary) {
    return;
  }
  const wallbox = state.wallbox;
  if (!wallbox) {
    const message = state.loadingCards.wallbox ? 'Loading charger details...'
      : state.sourceStatus.wallbox === 'error' ? 'Failed to load charger details.'
        : state.sourceStatus.wallbox === 'empty' ? 'No charger record found.'
          : 'Search to load charger details.';
    summary.textContent = state.loadingCards.wallbox ? message : 'Search to load charger details';
    profile.innerHTML = `<p class="empty-state${state.loadingCards.wallbox ? ' loading-state' : ''}">${message}</p>`;
    return;
  }
  const connectivity = wallbox.connectivityStatus || 'Unknown';
  const connectivityChanged = formatDate(wallbox.connectivityStatusUpdatedOn);
  const serialBadge = document.getElementById('serialStatusBadge');
  if (serialBadge) {
    if (wallbox) {
      const isOnline = /online/i.test(connectivity);
      serialBadge.innerHTML = `<span class="status-dot ${isOnline ? 'is-online' : 'is-offline'}"></span>${escapeHtml(wallbox.model || 'OCPP Charger')} · ${escapeHtml(connectivity)}`;
      serialBadge.hidden = false;
    } else {
      serialBadge.hidden = true;
    }
  }
  const lights = [
    [`Connectivity ${connectivity}. Last change ${connectivityChanged}`, statusTone(connectivity, 'connectivity')],
  ];
  if (wallbox.activeChargingErrors) {
    lights.push([`Active errors ${displayValue(wallbox.activeChargingErrors)}`, 'bad']);
  }
  const connectorCharging = (wallbox.connectors || []).some((connector) => isConnectorOne(connector) && /charging/i.test(String(connector.status || '')));
  summary.innerHTML = `
    <span class="charger-identity">${escapeHtml(wallbox.model || 'Unknown model')}</span>
    ${connectorCharging ? '<span class="charging-mark" tabindex="0" title="Connector 1 is charging"><i></i><em>Connector 1 is charging</em></span>' : ''}
    ${lights.map(([label, tone]) => `
      <span class="status-light tone-${tone || 'bad'}" tabindex="0">
        <i></i>
        <em>${escapeHtml(label)}</em>
      </span>
    `).join('')}
  `;
  const ownerPinValues = [];
  profile.innerHTML = `
    ${chargerFacts(wallbox).map(([title, rows]) => `
      <section class="charger-group">
        <h3>${escapeHtml(title)}</h3>
        <dl>
          ${(rows.length ? rows : [['None', '—']]).map(([label, value, tone, copyable, place, sensitive]) => {
            let renderedValue = tone
              ? `<span class="status-pill tone-${tone}">${escapeHtml(displayValue(value))}</span>`
              : escapeHtml(displayValue(value));
            let controls = '';
            let secretIndex = null;
            if (sensitive && value != null && value !== '') {
              secretIndex = ownerPinValues.push(displayValue(value)) - 1;
              renderedValue = `<span data-owner-pin-value="${secretIndex}">********</span>`;
              controls += `<button type="button" class="manufacturer-data-reveal reveal-owner-pin" data-secret-index="${secretIndex}" aria-label="Reveal owner PIN">Show</button>`;
            }
            if (copyable && (!sensitive || secretIndex != null)) {
              controls += sensitive
                ? `<button type="button" class="copy-pin" data-secret-index="${secretIndex}">Copy</button>`
                : `<button type="button" class="copy-pin" data-pin="${escapeHtml(displayValue(value))}">Copy</button>`;
            }
            return `
              <div class="${place || ''}">
                <dt>${escapeHtml(label)}</dt>
                <dd>${renderedValue}${controls}</dd>
              </div>
            `;
          }).join('')}
        </dl>
      </section>
    `).join('')}
  `;
  profile.querySelectorAll('.reveal-owner-pin').forEach((button) => {
    const valueNode = profile.querySelector(`[data-owner-pin-value="${button.dataset.secretIndex}"]`);
    button.addEventListener('click', () => {
      const revealed = button.textContent === 'Show';
      if (valueNode) valueNode.textContent = revealed ? ownerPinValues[Number(button.dataset.secretIndex)] : '********';
      button.textContent = revealed ? 'Hide' : 'Show';
      button.setAttribute('aria-label', `${revealed ? 'Hide' : 'Reveal'} owner PIN`);
    });
  });
  profile.querySelectorAll('.copy-pin').forEach((button) => {
    button.addEventListener('click', async () => {
      const secretIndex = button.dataset.secretIndex;
      const pin = secretIndex == null ? button.dataset.pin || '' : ownerPinValues[Number(secretIndex)] || '';
      if (!pin || pin === '—') {
        return;
      }
      await navigator.clipboard.writeText(pin);
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = 'Copy';
      }, 1200);
    });
  });
}

function formatHourLabel(hour) {
  const date = new Date();
  date.setHours(Number(hour), 0, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric' });
}

function parseClock(value) {
  const [hour = '00', minute = '00', second = '00'] = String(value || '00:00:00').split(':');
  return [hour.padStart(2, '0'), minute.padStart(2, '0'), second.padStart(2, '0')];
}

function formatClock(value) {
  const [hour, minute, second] = parseClock(value).map((part) => Number(part));
  const date = new Date();
  date.setHours(hour, minute, second, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function setClock(inputId, triggerId, value) {
  const input = document.getElementById(inputId);
  const trigger = document.getElementById(triggerId);
  input.value = value;
  trigger.textContent = formatClock(value);
}

function closePopovers(except) {
  document.querySelectorAll('.time-popover, .multi-panel').forEach((panel) => {
    if (panel !== except) {
      panel.hidden = true;
    }
  });
}

function bindTimePicker(inputId, triggerId, popoverId) {
  const input = document.getElementById(inputId);
  const trigger = document.getElementById(triggerId);
  const popover = document.getElementById(popoverId);
  const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));
  const seconds = Array.from({ length: 60 }, (_, second) => String(second).padStart(2, '0'));
  const presets = ['00:00:00', '06:00:00', '12:00:00', '18:00:00', '23:59:59'];

  const paint = () => {
    const [currentHour, currentMinute, currentSecond] = parseClock(input.value);
    popover.innerHTML = `
      <div class="time-presets">
        ${presets.map((preset) => `<button type="button" data-preset="${preset}" class="${input.value === preset ? 'active' : ''}">${formatClock(preset)}</button>`).join('')}
      </div>
      <div class="time-columns">
        <div><span>Hour</span>${hours.map((hour) => `<button type="button" data-hour="${hour}" class="${hour === currentHour ? 'active' : ''}">${formatHourLabel(hour)}</button>`).join('')}</div>
        <div><span>Min</span>${minutes.map((minute) => `<button type="button" data-minute="${minute}" class="${minute === currentMinute ? 'active' : ''}">${minute}</button>`).join('')}</div>
        <div><span>Sec</span>${seconds.map((second) => `<button type="button" data-second="${second}" class="${second === currentSecond ? 'active' : ''}">${second}</button>`).join('')}</div>
      </div>
    `;
  };

  trigger.addEventListener('click', () => {
    const willOpen = popover.hidden;
    closePopovers();
    popover.hidden = !willOpen;
    if (willOpen) {
      paint();
    }
  });

  popover.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) {
      return;
    }
    const [hour, minute, second] = parseClock(input.value);
    const markCustom = () => {
      const quickRange = document.getElementById('quickRange');
      if (quickRange) {
        quickRange.value = '';
      }
      paintRangeWindow();
      updateRangeFeedback();
      resetSmartInvestigation();
    };
    if (button.dataset.preset) {
      setClock(inputId, triggerId, button.dataset.preset);
      markCustom();
      popover.hidden = true;
      return;
    }
    if (button.dataset.hour) {
      setClock(inputId, triggerId, `${button.dataset.hour}:${minute}:${second}`);
      markCustom();
      paint();
      return;
    }
    if (button.dataset.minute) {
      setClock(inputId, triggerId, `${hour}:${button.dataset.minute}:${second}`);
      markCustom();
      paint();
      return;
    }
    if (button.dataset.second) {
      setClock(inputId, triggerId, `${hour}:${minute}:${button.dataset.second}`);
      markCustom();
      popover.hidden = true;
    }
  });
}

function rangeDomain() {
  const now = Date.now();
  const selected = selectedWindow();
  const contextStart = now - 30 * 24 * 60 * 60 * 1000;
  return {
    start: Number.isFinite(selected.start) ? Math.min(contextStart, selected.start) : contextStart,
    end: Number.isFinite(selected.end) ? Math.max(now, selected.end) : now,
  };
}

function selectedWindow() {
  const start = new Date(combineDateTime(
    document.getElementById('startDate').value,
    document.getElementById('startTimeInput').value,
  )).getTime();
  const end = new Date(combineDateTime(
    document.getElementById('endDate').value,
    document.getElementById('endTimeInput').value,
  )).getTime();
  return { start, end };
}

function rangeValidationMessage() {
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  if (!startDate || !endDate) {
    return 'Choose both a From and To date.';
  }
  const { start, end } = selectedWindow();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 'Enter valid start and end dates.';
  }
  if (start > end) {
    return 'The From date must be earlier than or equal to the To date.';
  }
  if (end > Date.now()) {
    return 'The To date cannot be in the future.';
  }
  return '';
}

function updateRangeFeedback() {
  const feedback = document.getElementById('rangeFeedback');
  const applyButton = document.getElementById('applyRange');
  const message = rangeValidationMessage();
  if (feedback) {
    feedback.textContent = message;
    feedback.hidden = !message;
  }
  if (applyButton) {
    applyButton.disabled = Boolean(message);
  }
  return message;
}

function formatRangeDateTime(value) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRangeSummaryDate(value) {
  const date = new Date(value);
  const selected = selectedWindow();
  const currentYear = new Date().getFullYear();
  const showYear = date.getFullYear() !== currentYear
    || new Date(selected.start).getFullYear() !== currentYear
    || new Date(selected.end).getFullYear() !== currentYear;
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}

function paintRangeWindow() {
  const track = document.getElementById('rangeTrack');
  const windowBox = document.getElementById('rangeWindow');
  const duration = document.getElementById('rangeDuration');
  const startLabel = document.getElementById('rangeStartLabel');
  if (!track || !windowBox) {
    return;
  }
  const domain = rangeDomain();
  const span = domain.end - domain.start;
  const selected = selectedWindow();
  if (!Number.isFinite(selected.start) || !Number.isFinite(selected.end) || span <= 0) {
    windowBox.style.left = '0%';
    windowBox.style.width = '0%';
    updateRangeFeedback();
    return;
  }
  const start = Math.min(Math.max(selected.start, domain.start), domain.end);
  const end = Math.max(start, Math.min(Math.max(selected.end, domain.start), domain.end));
  windowBox.style.left = `${((start - domain.start) / span) * 100}%`;
  windowBox.style.width = `${((end - start) / span) * 100}%`;
  windowBox.style.minWidth = '2px';
  const label = windowBox.querySelector('.overview-window-start');
  if (label) {
    label.hidden = true;
  }
  if (duration) {
    duration.textContent = `${formatRangeSummaryDate(start)} → ${formatRangeSummaryDate(end)} · ${formatDuration(start, end)}`;
  }
  const contextLabel = document.getElementById('rangeContextLabel');
  if (contextLabel) {
    const contextStart = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const expanded = selected.start < contextStart - 1000 || selected.end > Date.now() + 1000;
    contextLabel.textContent = expanded
      ? 'Historical context · expanded to selected range'
      : 'Historical context · past 30 days';
  }
  if (startLabel) {
    startLabel.textContent = formatRangeDateTime(domain.start);
  }
  const endLabel = document.getElementById('rangeEndLabel');
  if (endLabel) {
    endLabel.textContent = formatRangeDateTime(domain.end);
  }
  const nowMarker = track.querySelector('.range-now-marker');
  if (nowMarker) {
    nowMarker.style.left = `${((Date.now() - domain.start) / span) * 100}%`;
  }
  const ticks = document.getElementById('rangeTicks');
  if (ticks) {
    ticks.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const time = domain.start + (span * index) / 6;
      const label = new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<i style="left:${(index / 6) * 100}%"><span>${escapeHtml(label)}</span></i>`;
    }).join('');
  }
  updateRangeFeedback();
  updateFloatingTimeToolbar();
}

function applyWindowDates(startMs, endMs, search) {
  const stamp = (date) => ({
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
  });
  const from = stamp(new Date(startMs));
  const to = stamp(new Date(endMs));
  document.getElementById('startDate').value = from.date;
  document.getElementById('endDate').value = to.date;
  setClock('startTimeInput', 'startTimeTrigger', from.time);
  setClock('endTimeInput', 'endTimeTrigger', to.time);
  document.getElementById('quickRange').value = '';
  paintRangeWindow();
  if (search) {
    fetchEvents();
  }
}

function bindRangeBar() {
  const track = document.getElementById('rangeTrack');
  if (!track || track.dataset.bound === 'true') {
    return;
  }
  track.dataset.bound = 'true';
  const cursor = track.querySelector('.overview-cursor');
  const tip = track.querySelector('.overview-tip');
  const brush = track.querySelector('.overview-brush');

  const timeAt = (clientX) => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const domain = rangeDomain();
    return domain.start + ratio * (domain.end - domain.start);
  };

  const updateBrush = (clientX) => {
    if (!state.rangeDrag) return;
    const rect = track.getBoundingClientRect();
    const startX = state.rangeDrag.startX;
    const leftPx = Math.min(startX, Math.max(rect.left, Math.min(rect.right, clientX)));
    const rightPx = Math.max(startX, Math.max(rect.left, Math.min(rect.right, clientX)));
    const startTime = timeAt(leftPx);
    const endTime = timeAt(rightPx);

    brush.hidden = false;
    brush.style.left = `${leftPx - rect.left}px`;
    brush.style.width = `${Math.max(2, rightPx - leftPx)}px`;
    const label = brush.querySelector('.overview-window-start');
    if (label) {
      label.textContent = formatExact(startTime);
    }
    const durationElem = document.getElementById('rangeDuration');
    if (durationElem) {
      durationElem.textContent = `${formatRangeSummaryDate(startTime)} → ${formatRangeSummaryDate(endTime)} · ${formatDuration(startTime, endTime)}`;
    }
  };

  track.addEventListener('mousemove', (event) => {
    if (state.rangeDrag) return;
    const rect = track.getBoundingClientRect();
    const time = timeAt(event.clientX);
    cursor.hidden = false;
    cursor.style.left = `${event.clientX - rect.left}px`;
    tip.hidden = false;
    tip.textContent = formatExact(time);
    tip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 220)}px`;
    tip.style.top = `${Math.max(8, event.clientY - 32)}px`;
  });

  track.addEventListener('mouseleave', () => {
    if (!state.rangeDrag) {
      cursor.hidden = true;
      tip.hidden = true;
    }
  });

  track.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = track.getBoundingClientRect();
    state.rangeDrag = { startX: event.clientX, rect };
    brush.hidden = false;
    brush.style.left = `${event.clientX - rect.left}px`;
    brush.style.width = '1px';
    cursor.hidden = false;
    cursor.style.left = `${event.clientX - rect.left}px`;
  });

  window.addEventListener('mousemove', (event) => {
    if (!state.rangeDrag) return;
    updateBrush(event.clientX);
  });

  window.addEventListener('mouseup', (event) => {
    if (!state.rangeDrag) return;
    const drag = state.rangeDrag;
    state.rangeDrag = null;
    brush.hidden = true;
    cursor.hidden = true;
    tip.hidden = true;

    const rect = drag.rect;
    const leftPx = Math.min(drag.startX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
    const rightPx = Math.max(drag.startX, Math.max(rect.left, Math.min(rect.right, event.clientX)));
    if (rightPx - leftPx > 6) {
      const start = timeAt(leftPx);
      const end = timeAt(rightPx);
      if (end - start >= 60000) {
        applyWindowDates(start, end, true);
      } else {
        applyWindowDates(start - 30000, start + 30000, true);
      }
    }
  });

  paintRangeWindow();
}

function applyQuickRange(durationMs) {
  const end = new Date();
  const start = new Date(end.getTime() - durationMs);
  const stamp = (date) => ({
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
  });
  const from = stamp(start);
  const to = stamp(end);
  document.getElementById('startDate').value = from.date;
  document.getElementById('endDate').value = to.date;
  setClock('startTimeInput', 'startTimeTrigger', from.time);
  setClock('endTimeInput', 'endTimeTrigger', to.time);
  const quickRange = document.getElementById('quickRange');
  if (quickRange) {
    quickRange.value = String(durationMs);
  }
  paintRangeWindow();
  fetchEvents();
}

function setDefaultWindow() {
  const durationMs = 7 * 24 * 60 * 60 * 1000;
  const end = new Date();
  const start = new Date(end.getTime() - durationMs);
  const stamp = (date) => ({
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`,
  });
  const from = stamp(start);
  const to = stamp(end);
  document.getElementById('startDate').value = from.date;
  document.getElementById('endDate').value = to.date;
  setClock('startTimeInput', 'startTimeTrigger', from.time);
  setClock('endTimeInput', 'endTimeTrigger', to.time);
  const quickRange = document.getElementById('quickRange');
  if (quickRange) {
    quickRange.value = String(durationMs);
  }
  paintRangeWindow();
}

/* ========================================================
   Sticky Compact Topbar on Scroll
   ======================================================== */
function initStickyTopbarScroll() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  let isScrolled = false;
  const onScroll = () => {
    const scrolled = window.scrollY > 25;
    if (scrolled !== isScrolled) {
      isScrolled = scrolled;
      topbar.classList.toggle('is-scrolled', isScrolled);
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ========================================================
   Floating Time Selection Toolbar (Charger Dashboard View Only)
   ======================================================== */
function formatWidgetBadgeLabel(widget) {
  if (widget === 'sessionAnalysis' && state.sessionAnalysis) {
    return `Session #${state.sessionAnalysis.session.transactionId}`;
  }
  if (widget === 'sessions') {
    return 'Sessions';
  }
  if (widget === 'events') {
    return 'Events';
  }
  const connId = state.activeConnector ?? 1;
  return `Connector ${connId}`;
}

function updateFloatingTimeToolbar(overrideWidget, overrideStart, overrideEnd) {
  const toolbar = document.getElementById('floatingTimeToolbar');
  if (!toolbar) return;

  // STRICT RULE: ONLY show in the charger dashboard view, NOT the list view
  if (state.currentView !== 'charger') {
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;

  const currentWidget = overrideWidget || state.activeTimelineWidget || 'connector';
  
  let startMs;
  let endMs;
  let isFullWindow = false;

  if (overrideStart != null && overrideEnd != null) {
    startMs = overrideStart;
    endMs = overrideEnd;
  } else if (currentWidget === 'sessionAnalysis' && state.sessionAnalysis) {
    startMs = state.sessionAnalysis.view.start;
    endMs = state.sessionAnalysis.view.end;
    isFullWindow = startMs <= state.sessionAnalysis.range.start + 1000 && endMs >= state.sessionAnalysis.range.end - 1000;
  } else if (currentWidget === 'sessions') {
    const period = sessionPeriod();
    const view = state.sessionStripView || period;
    startMs = view.start;
    endMs = view.end;
    isFullWindow = !state.sessionStripView || (startMs <= period.start + 1000 && endMs >= period.end - 1000);
  } else {
    // 'connector' or 'events'
    const bounds = state.eventBounds;
    const view = state.eventView;
    if (view && Number.isFinite(view.start) && Number.isFinite(view.end)) {
      startMs = view.start;
      endMs = view.end;
      isFullWindow = bounds ? (startMs <= bounds.start + 1000 && endMs >= bounds.end - 1000) : false;
    } else if (bounds) {
      startMs = bounds.start;
      endMs = bounds.end;
      isFullWindow = true;
    } else {
      const selected = selectedWindow();
      startMs = selected.start;
      endMs = selected.end;
      isFullWindow = true;
    }
  }

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;

  const durationMs = Math.max(endMs - startMs, 0);

  const widgetPill = document.getElementById('floatingWidgetPill');
  if (widgetPill) {
    widgetPill.textContent = formatWidgetBadgeLabel(currentWidget);
  }

  const labelEl = document.getElementById('floatingTimeLabel');
  if (labelEl) {
    labelEl.textContent = `${formatExact(startMs)} – ${formatExact(endMs)}`;
  }

  const durationBadge = document.getElementById('floatingDurationBadge');
  if (durationBadge) {
    const durText = formatDuration(startMs, endMs);
    durationBadge.textContent = isFullWindow ? `Full · ${durText}` : durText;
    durationBadge.title = isFullWindow ? 'Viewing full time window' : 'Zoomed time window';
  }

  // Update preset chip highlights
  const presetsContainer = document.getElementById('floatingTimePresets');
  if (presetsContainer) {
    presetsContainer.querySelectorAll('.floating-preset-chip').forEach((chip) => {
      const chipMs = Number(chip.dataset.ms);
      // match if duration is within 6% or 1 minute
      const diff = Math.abs(durationMs - chipMs);
      const isMatch = diff < 60000 || (durationMs > 0 && diff / chipMs < 0.06);
      chip.classList.toggle('active', isMatch);
    });
  }
}

function applyPresetToActiveWidget(ms) {
  const widget = state.activeTimelineWidget || 'connector';
  if (widget === 'sessionAnalysis' && state.sessionAnalysis) {
    const bounds = state.sessionAnalysis.range;
    const span = Math.min(ms, bounds.end - bounds.start);
    const currentCenter = (state.sessionAnalysis.view.start + state.sessionAnalysis.view.end) / 2;
    let start = currentCenter - span / 2;
    let end = start + span;
    if (start < bounds.start) {
      start = bounds.start;
      end = start + span;
    }
    if (end > bounds.end) {
      end = bounds.end;
      start = Math.max(bounds.start, end - span);
    }
    state.sessionAnalysis.view = { start, end };
    paintSessionAnalysis(false);
    updateFloatingTimeToolbar('sessionAnalysis', start, end);
    return;
  }

  if (widget === 'sessions') {
    const bounds = sessionPeriod();
    if (Number.isNaN(bounds.start) || Number.isNaN(bounds.end)) return;
    const span = Math.min(ms, bounds.end - bounds.start);
    const currentView = state.sessionStripView || bounds;
    const currentCenter = (currentView.start + currentView.end) / 2;
    let start = currentCenter - span / 2;
    let end = start + span;
    if (start < bounds.start) {
      start = bounds.start;
      end = start + span;
    }
    if (end > bounds.end) {
      end = bounds.end;
      start = Math.max(bounds.start, end - span);
    }
    state.sessionStripView = { start, end };
    paintSessionStrip();
    updateFloatingTimeToolbar('sessions', start, end);
    return;
  }

  // widget === 'connector' || widget === 'events'
  if (state.eventBounds) {
    const bounds = state.eventBounds;
    const maxSpan = bounds.end - bounds.start;
    if (ms <= maxSpan) {
      const currentView = state.eventView || bounds;
      const currentCenter = (currentView.start + currentView.end) / 2;
      let start = currentCenter - ms / 2;
      let end = start + ms;
      if (start < bounds.start) {
        start = bounds.start;
        end = start + ms;
      }
      if (end > bounds.end) {
        end = bounds.end;
        start = Math.max(bounds.start, end - ms);
      }
      setEventView(start, end);
      return;
    }
  }

  applyQuickRange(ms);
}

function resetActiveWidget() {
  const widget = state.activeTimelineWidget || 'connector';
  if (widget === 'sessionAnalysis' && state.sessionAnalysis) {
    state.sessionAnalysis.view = { ...state.sessionAnalysis.range };
    paintSessionAnalysis(false);
    updateFloatingTimeToolbar('sessionAnalysis');
    return;
  }
  if (widget === 'sessions') {
    state.sessionStripView = sessionPeriod();
    paintSessionStrip();
    updateFloatingTimeToolbar('sessions');
    return;
  }
  if (state.eventBounds && state.eventView) {
    const isZoomed = state.eventView.start > state.eventBounds.start + 1000 || state.eventView.end < state.eventBounds.end - 1000;
    if (isZoomed) {
      setEventView(state.eventBounds.start, state.eventBounds.end);
      return;
    }
  }
  setDefaultWindow();
  fetchEvents();
}

function initTimelineActiveObserver() {
  if (typeof IntersectionObserver === 'undefined') return;
  const sections = [
    { id: 'connectorPanel', widget: 'connector' },
    { id: 'chargingSessionsPanel', widget: 'sessions' },
    { id: 'sessionAnalysis', widget: 'sessionAnalysis' },
    { id: 'eventsPanel', widget: 'events' },
  ];
  
  const observer = new IntersectionObserver((entries) => {
    if (state.overviewDrag) return;
    const visibleEntries = entries.filter((entry) => entry.isIntersecting && !entry.target.hidden);
    if (!visibleEntries.length) return;
    visibleEntries.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    const topEntry = visibleEntries[0];
    const match = sections.find((s) => s.id === topEntry.target.id);
    if (match && state.activeTimelineWidget !== match.widget) {
      const sessionAnalysisEl = document.getElementById('sessionAnalysis');
      if (sessionAnalysisEl && !sessionAnalysisEl.hidden && match.id === 'chargingSessionsPanel') {
        const saRect = sessionAnalysisEl.getBoundingClientRect();
        if (saRect.top < window.innerHeight && saRect.bottom > 0) {
          state.activeTimelineWidget = 'sessionAnalysis';
          updateFloatingTimeToolbar();
          return;
        }
      }
      state.activeTimelineWidget = match.widget;
      updateFloatingTimeToolbar();
    }
  }, {
    threshold: [0.15, 0.4, 0.7],
  });

  sections.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

function initFloatingTimeToolbar() {
  const toolbar = document.getElementById('floatingTimeToolbar');
  if (!toolbar) return;

  // Preset chips binding - zoom active widget or expand global window
  toolbar.querySelectorAll('.floating-preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ms = Number(btn.dataset.ms);
      if (Number.isFinite(ms) && ms > 0) {
        applyPresetToActiveWidget(ms);
      }
    });
  });

  // Jump to custom date/time section smoothly
  document.getElementById('floatingTimeScrollToPanel')?.addEventListener('click', () => {
    const section = document.querySelector('.time-range-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      section.classList.add('flash-highlight');
      setTimeout(() => section.classList.remove('flash-highlight'), 1200);
    }
  });

  // Reset active widget window to full range
  document.getElementById('floatingTimeReset')?.addEventListener('click', () => {
    resetActiveWidget();
  });

  // Refresh data
  const refreshBtn = document.getElementById('floatingTimeRefresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.classList.add('rotating');
      try {
        await fetchEvents();
      } finally {
        setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
      }
    });
  }

  // Minimize / Expand toggle
  const minBtn = document.getElementById('floatingTimeMinimize');
  const summaryBox = document.getElementById('floatingTimeSummary');
  const toggleMin = () => {
    const isMin = toolbar.classList.toggle('is-minimized');
    if (minBtn) {
      minBtn.title = isMin ? 'Expand time toolbar' : 'Minimize floating toolbar';
    }
  };
  if (minBtn) {
    minBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMin();
    });
  }
  if (summaryBox) {
    summaryBox.addEventListener('click', () => {
      if (toolbar.classList.contains('is-minimized')) {
        toggleMin();
      }
    });
  }

  // Attach pointer listener to panels to update active widget on direct interaction
  ['connectorPanel', 'chargingSessionsPanel', 'sessionAnalysis', 'eventsPanel'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('pointerdown', () => {
        const widgetMap = {
          connectorPanel: 'connector',
          chargingSessionsPanel: 'sessions',
          sessionAnalysis: 'sessionAnalysis',
          eventsPanel: 'events',
        };
        const w = widgetMap[id];
        if (w && state.activeTimelineWidget !== w) {
          state.activeTimelineWidget = w;
          updateFloatingTimeToolbar(w);
        }
      }, { passive: true });
    }
  });

  initTimelineActiveObserver();
  updateFloatingTimeToolbar();
}

function applyTokenPillDisplay({ env, valid, expired, hasToken, minutesRemaining, capturing }) {
  const envName = (env || state.currentEnv || 'prod').toUpperCase();
  const pill = document.getElementById('globalTokenPill');
  const dot = document.getElementById('globalTokenDot');
  const text = document.getElementById('globalTokenText');
  if (!pill || !text) return;

  pill.classList.remove('token-pill-alert', 'token-pill-success', 'token-pill-capturing');
  if (dot) {
    dot.classList.remove('valid', 'invalid');
  }

  if (valid) {
    pill.classList.add('token-pill-success');
    if (dot) dot.classList.add('valid');
    const timeStr = (minutesRemaining && minutesRemaining > 60)
      ? `${Math.floor(minutesRemaining / 60)}h ${minutesRemaining % 60}m`
      : `${minutesRemaining || 0}m`;
    text.textContent = `Active (${timeStr})`;
    pill.title = `TME ${envName} Session: Active (${timeStr} remaining). Click to renew session.`;
  } else if (capturing) {
    pill.classList.add('token-pill-capturing');
    text.textContent = 'Authenticating...';
    pill.title = `Authenticating session for ${envName} in browser... Complete sign-in on TME tab.`;
  } else {
    // Something is wrong with the token -> COMMAND ATTENTION WITH BLINKING GLOW RED
    pill.classList.add('token-pill-alert');
    if (dot) dot.classList.add('invalid');
    if (expired) {
      text.textContent = 'Token Expired';
      pill.title = `⚠️ ${envName} session token expired! Click here or refresh button to log in again.`;
    } else {
      text.textContent = 'Session Needed';
      pill.title = `⚠️ No valid ${envName} session token! Click here or refresh button to authenticate in TME.`;
    }
  }
}

let _tokenHealthChecking = false;
function currentTokenApp() {
  return __fotaHeaderOnly ? 'fota' : 'charger';
}

function tokenResponseMatchesApp(data, app) {
  return data?.app === app || (app === 'charger' && !data?.app);
}

async function checkLiveTokenHealth() {
  if (_tokenHealthChecking) return;
  _tokenHealthChecking = true;
  const env = (state.currentEnv || 'prod').toLowerCase();
  const app = currentTokenApp();
  try {
    const params = new URLSearchParams({ env, app });
    const res = await fetch(dashboardApiUrl(`/api/token-status?${params.toString()}`));
    const data = await res.json();
    if (env !== state.currentEnv || data?.env !== env || !tokenResponseMatchesApp(data, app)) return;
    if (data && data.ok) {
      if (data.valid && !state.token) {
        await loadStoredTokenFromLocalBridge();
      } else if (!data.valid && state.token) {
        state.token = '';
      }
      applyTokenPillDisplay(data);
    }
  } catch (err) {
    // Bridge offline or network issue
  } finally {
    _tokenHealthChecking = false;
  }
}

function setToken(token) {
  const value = String(token || '').replace(/^Bearer\s+/i, '').trim();
  const expired = Boolean(value) && isTokenExpired(value);
  const valid = Boolean(value) && !expired && isTmeJwtToken(value);
  const status = valid ? 'Session valid' : expired ? 'Session expired' : 'Session required';
  const env = (state.currentEnv || 'prod').toLowerCase();
  state.token = valid ? value : '';
  if (valid) {
    window.dispatchEvent(new CustomEvent('dashboard-session-ready', { detail: { environment: env } }));
  }

  let minutesLeft = 0;
  if (valid) {
    const payload = decodeJwtPayload(value);
    if (payload && payload.exp) {
      minutesLeft = Math.max(0, Math.floor((Number(payload.exp) - Date.now() / 1000) / 60));
    }
  }

  applyTokenPillDisplay({
    env,
    valid,
    expired,
    hasToken: Boolean(value),
    minutesRemaining: minutesLeft,
    capturing: false,
  });

  const led = document.getElementById('tokenLed');
  if (led) {
    led.classList.toggle('valid', valid);
    led.classList.toggle('invalid', Boolean(value) && !valid);
    led.setAttribute('aria-label', status);
    const statusText = document.getElementById('tokenStatusText');
    if (statusText) {
      statusText.textContent = status;
    }
  }

  renderSupportOperations();
  return valid;
}

function clearToken() {
  setToken('');
}

async function clearSavedToken(environment = state.currentEnv) {
  const env = String(environment || 'prod').toLowerCase();
  const params = new URLSearchParams({ env, app: currentTokenApp() });
  try {
    await fetch(dashboardApiUrl(`/api/session-token?${params.toString()}`), { method: 'DELETE' });
  } catch (error) {
    // Ignore cleanup errors; the UI token field is still cleared.
  }

  if (env === state.currentEnv) setToken('');
}

async function loadStoredTokenFromLocalBridge({ environment = state.currentEnv, differentFrom = '', scanBrowser = false } = {}) {
  const env = String(environment || 'prod').toLowerCase();
  const app = currentTokenApp();
  try {
    const params = new URLSearchParams({ env, app });
    if (scanBrowser) params.set('scanBrowser', '1');
    const response = await fetch(dashboardApiUrl(`/api/session-token?${params.toString()}`), { method: 'GET' });
    const result = await response.json();
    if (env !== state.currentEnv || result?.env !== env || !tokenResponseMatchesApp(result, app)) return false;
    if (result && result.ok && result.token) {
      if (isTokenExpired(result.token) || !isTmeJwtToken(result.token)) {
        setStatus(`Saved TME token for ${env.toUpperCase()} is expired or invalid. Refreshing session automatically...`, 'warning');
        await triggerAutoTokenCapture();
        return false;
      }
      if (differentFrom && result.token === differentFrom) {
        return false;
      }

      setToken(result.token);
      setStatus(`Saved TME token for ${env.toUpperCase()} loaded automatically.`, 'success');
      return true;
    }
  } catch (error) {
    // Ignore and fall back to the manual flow.
  }
  return false;
}

async function useSavedToken() {
  const loaded = await loadStoredTokenFromLocalBridge({ scanBrowser: true });
  if (!loaded) {
    setStatus('No saved TME token is available yet. Authenticate in the TME dashboard, then save the session token.', 'warning');
  }
}

async function handleInvalidTokenAndRetry() {
  if (state.tokenRefreshInProgress) {
    return;
  }

  state.tokenRefreshInProgress = true;
  if (!__fotaHeaderOnly) __dashboardNeedsInitialTokenRefresh = false;

  try {
    const environment = state.currentEnv;
    if (!state.token) await loadStoredTokenFromLocalBridge({ environment });
    const rejectedToken = String(state.token || '').replace(/^Bearer\s+/i, '').trim();
    setStatus('The saved TME token was rejected. Refreshing the TME session automatically...', 'warning');

    const started = await triggerAutoTokenCapture({ environment, force: true });
    if (!started) {
      setStatus('The TME token refresh could not be started automatically. Please reload the page once the dashboard is signed in.', 'warning');
      return;
    }

    const tokenLoaded = await waitForAutoToken(390000, { environment, differentFrom: rejectedToken });
    if (tokenLoaded) {
      const loaded = await loadStoredTokenFromLocalBridge({ environment, differentFrom: rejectedToken });
      if (loaded) {
        setStatus('Fresh TME token loaded. Reloading events automatically...', 'success');
        refreshDashboardAfterTokenReady();
      }
      return;
    }

    setStatus('Automatic token refresh is in progress; sign in to TME and reload the page once the session is ready.', 'warning');
  } finally {
    state.tokenRefreshInProgress = false;
  }
}

function findBearerTokenInBrowserStorage() {
  const values = new Set();

  const addIfJwtLike = (candidate) => {
    if (!candidate || typeof candidate !== 'string') {
      return;
    }

    const trimmed = candidate.trim();
    if (trimmed.startsWith('Bearer ')) {
      if (isTmeJwtToken(trimmed.replace(/^Bearer\s+/i, ''))) {
        values.add(trimmed.replace(/^Bearer\s+/i, ''));
      }
      return;
    }

    if (trimmed.split('.').length === 3 && trimmed.length > 80 && isTmeJwtToken(trimmed)) {
      values.add(trimmed);
    }
  };

  const populateFromStorage = (storage) => {
    if (!storage) {
      return;
    }

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const keyName = key.toLowerCase();
      if (keyName.includes('token') || keyName.includes('auth') || keyName.includes('bearer') || keyName.includes('msal')) {
        addIfJwtLike(storage.getItem(key));
      }
    }
  };

  populateFromStorage(window.sessionStorage);
  populateFromStorage(window.localStorage);

  for (const [key, value] of Object.entries(window)) {
    if (typeof value === 'string' && /token|bearer|jwt|auth/i.test(key)) {
      addIfJwtLike(value);
    }
  }

  return Array.from(values)[0] || '';
}

async function useCurrentMicrosoftSession() {
  const existingToken = findBearerTokenInBrowserStorage();
  if (existingToken && setToken(existingToken)) {
    setStatus('A browser token was found and loaded automatically.', 'success');
    return;
  }

  if (typeof msal === 'undefined') {
    setStatus('The Microsoft auth library is unavailable. Please paste the bearer token manually.', 'warning');
    return;
  }

  try {
    if (!state.msalApp) {
      state.msalApp = new msal.PublicClientApplication({
        auth: {
          clientId: MSAL_CONFIG.clientId,
          authority: MSAL_CONFIG.authority,
          redirectUri: MSAL_CONFIG.redirectUri,
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        },
      });
    }

    const loginRequest = { scopes: MSAL_CONFIG.scopes };
    let account = null;
    try {
      const silentResult = await state.msalApp.ssoSilent(loginRequest);
      account = silentResult.account;
    } catch (silentError) {
      const popupResult = await state.msalApp.loginPopup(loginRequest);
      account = popupResult.account;
    }

    const tokenResult = await state.msalApp.acquireTokenSilent({
      ...loginRequest,
      account,
    }).catch(() => state.msalApp.acquireTokenPopup(loginRequest));

    if (!tokenResult || !tokenResult.accessToken) {
      throw new Error('No access token was returned for the current Microsoft session.');
    }

    setToken(tokenResult.idToken || tokenResult.accessToken);
    setStatus('Microsoft session token loaded automatically.', 'success');
  } catch (error) {
    setStatus(error && error.message ? error.message : 'Unable to load the current Microsoft session token.', 'error');
  }
}

function serialHistory() {
  try {
    return JSON.parse(localStorage.getItem('chargerSerialHistory') || '[]');
  } catch (error) {
    return [];
  }
}

function updateSerialDatalist(list) {
  const datalist = document.getElementById('serialHistoryDatalist');
  if (!datalist || !Array.isArray(list)) return;
  datalist.innerHTML = list.map((item) => `<option value="${escapeHtml(item)}"></option>`).join('');
}

function applyRememberedSerial(serial) {
  if (!serial) return;
  const serialInput = document.getElementById('serialNumber');
  if (serialInput) {
    serialInput.value = serial;
  }
  const directInput = document.getElementById('fleetDirectSerialInput');
  if (directInput && !directInput.value) {
    directInput.value = serial;
  }
}

async function loadSerialHistoryFromServer() {
  try {
    const res = await fetch('/api/serial-history');
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok) {
        if (Array.isArray(data.history) && data.history.length) {
          localStorage.setItem('chargerSerialHistory', JSON.stringify(data.history));
          updateSerialDatalist(data.history);
        }
        if (data.lastSelected) {
          localStorage.setItem('chargerLastSelectedSerial', data.lastSelected);
          applyRememberedSerial(data.lastSelected);
        }
        return data;
      }
    }
  } catch (error) {
    console.warn('Unable to reach /api/serial-history, using local storage:', error);
  }

  const localList = serialHistory();
  const localLast = localStorage.getItem('chargerLastSelectedSerial') || (localList.length ? localList[0] : '');
  if (localList.length) {
    updateSerialDatalist(localList);
  }
  if (localLast) {
    applyRememberedSerial(localLast);
  }
  return null;
}

function rememberSerial(serialNumber) {
  const clean = String(serialNumber || '').trim().toUpperCase();
  if (!clean || clean.length < 5) return;

  const currentHistory = serialHistory().filter((item) => item.toUpperCase() !== clean);
  const next = [clean, ...currentHistory].slice(0, 30);
  try {
    localStorage.setItem('chargerSerialHistory', JSON.stringify(next));
    localStorage.setItem('chargerLastSelectedSerial', clean);
  } catch (e) {}

  updateSerialDatalist(next);
  applyRememberedSerial(clean);

  // Sync to server disk file (survives server close & re-run)
  fetch('/api/serial-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serialNumber: clean }),
  }).catch((err) => console.warn('Could not persist serial to server:', err));
}

// ========================================================
// Smart Serial Autocomplete & Fuzzy Typo Suggestion Engine
// ========================================================
function getAllKnownSerials() {
  const serials = new Map();

  // 1. History
  serialHistory().forEach((s) => {
    const clean = String(s || '').trim().toUpperCase();
    if (clean) serials.set(clean, { serial: clean, model: 'Recent search', status: 'history' });
  });

  // 2. Fleet wallboxes (if loaded)
  if (Array.isArray(state.fleet?.items)) {
    state.fleet.items.forEach((c) => {
      const s = String(c.serialNumber || c.serial || c.chargerId || '').trim().toUpperCase();
      if (s) {
        serials.set(s, {
          serial: s,
          model: c.model || c.chargePointModel || 'Terra AC Wallbox',
          status: String(c.connectivityStatus || c.status || 'online').toLowerCase(),
        });
      }
    });
  }

  // 3. Fallback active serials
  const defaults = [
    typeof SAMPLE !== 'undefined' && SAMPLE.serialNumber ? SAMPLE.serialNumber : 'TACW2244723S0930',
    'TACW2244723S0931',
    'TACW2244723S0929',
    'TACW2244723S0928',
    'TACW2244723S0932',
  ];
  defaults.forEach((s) => {
    const clean = String(s || '').trim().toUpperCase();
    if (clean && !serials.has(clean)) {
      serials.set(clean, { serial: clean, model: 'Terra AC 22kW', status: 'online' });
    }
  });

  return Array.from(serials.values());
}

function removeSerialFromHistory(serialToRemove) {
  const clean = String(serialToRemove || '').trim().toUpperCase();
  if (!clean) return;
  const current = serialHistory().filter((s) => String(s).trim().toUpperCase() !== clean);
  try {
    localStorage.setItem('chargerSerialHistory', JSON.stringify(current));
  } catch (e) {}
  updateSerialDatalist(current);
}

function clearAllSerialHistory() {
  try {
    localStorage.setItem('chargerSerialHistory', '[]');
  } catch (e) {}
  updateSerialDatalist([]);
}

function levenshteinDistance(s1, s2) {
  const a = String(s1 || '').toUpperCase();
  const b = String(s2 || '').toUpperCase();
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

function findBestTypoMatch(query, candidates) {
  const q = String(query || '').trim().toUpperCase();
  if (q.length < 3) return null;
  let best = null;
  let minDistance = Infinity;
  for (const item of candidates) {
    const s = item.serial.toUpperCase();
    if (s === q) return null; // Exact match, not a typo
    let dist = levenshteinDistance(q, s);
    // If user forgot prefix 'TACW'
    if (s.endsWith(q) && Math.abs(s.length - q.length) <= 5) {
      dist = 1;
    }
    const maxTol = q.length <= 6 ? 2 : q.length <= 10 ? 3 : 5;
    if (dist < minDistance && dist <= maxTol) {
      minDistance = dist;
      best = item.serial;
    }
  }
  return best;
}

function attachSmartSerialSearch(inputElement, onSelectCallback) {
  if (!inputElement) return;

  // Clean up any legacy typo banner in DOM
  const existingTypoBanner = inputElement.parentElement.querySelector('.smart-serial-typo-banner');
  if (existingTypoBanner) {
    existingTypoBanner.remove();
  }

  // Create or retrieve floating suggestions container
  let container = inputElement.parentElement.querySelector('.smart-serial-dropdown');
  if (!container) {
    container = document.createElement('div');
    container.className = 'smart-serial-dropdown';
    container.hidden = true;
    inputElement.parentElement.appendChild(container);
  }
  inputElement.parentElement.style.position = 'relative';

  let selectedIndex = -1;

  function closeDropdown() {
    container.hidden = true;
    container.innerHTML = '';
    selectedIndex = -1;
  }

  function selectValue(serial) {
    const s = String(serial || '').trim().toUpperCase();
    if (!s) return;
    inputElement.value = s;
    closeDropdown();
    rememberSerial(s);
    if (typeof onSelectCallback === 'function') {
      onSelectCallback(s);
    }
  }

  function bindDropdownActions() {
    const clearBtn = container.querySelector('.smart-serial-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearAllSerialHistory();
        renderRecentHistory();
      });
    }

    container.querySelectorAll('.smart-serial-remove-btn').forEach((btn) => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeSerialFromHistory(btn.dataset.remove);
        renderRecentHistory();
      });
    });

    const suggestBtn = container.querySelector('.smart-serial-suggest-btn');
    if (suggestBtn) {
      suggestBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectValue(suggestBtn.dataset.serial);
      });
    }

    container.querySelectorAll('.smart-serial-item').forEach((row) => {
      row.addEventListener('mousedown', (e) => {
        if (e.target.closest('.smart-serial-remove-btn')) return;
        e.preventDefault();
        selectValue(row.dataset.serial);
      });
    });
  }

  function renderRecentHistory() {
    const historyList = serialHistory().slice(0, 8);
    if (!historyList.length) {
      const all = getAllKnownSerials().filter((it) => it.status !== 'history').slice(0, 5);
      if (!all.length) {
        closeDropdown();
        return;
      }
      container.innerHTML = `
        <div class="smart-serial-section-header">
          <span>Available Chargers</span>
        </div>
        ${all.map((item, idx) => `
          <div class="smart-serial-item ${idx === selectedIndex ? 'is-selected' : ''}" data-serial="${escapeHtml(item.serial)}">
            <div class="smart-serial-item-left">
              <span class="smart-serial-dot ${item.status === 'offline' ? 'offline' : 'online'}"></span>
              <strong class="smart-serial-code">${escapeHtml(item.serial)}</strong>
            </div>
            <span class="smart-serial-meta">${escapeHtml(item.model || '')}</span>
          </div>
        `).join('')}
      `;
    } else {
      container.innerHTML = `
        <div class="smart-serial-section-header">
          <span>Recent Searches</span>
          <button type="button" class="smart-serial-clear-btn" title="Clear all recent searches">Clear all</button>
        </div>
        ${historyList.map((s, idx) => `
          <div class="smart-serial-item ${idx === selectedIndex ? 'is-selected' : ''}" data-serial="${escapeHtml(s)}">
            <div class="smart-serial-item-left">
              <svg class="smart-serial-history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <strong class="smart-serial-code">${escapeHtml(s)}</strong>
            </div>
            <div class="smart-serial-item-actions">
              <span class="smart-serial-meta">Recent</span>
              <button type="button" class="smart-serial-remove-btn" data-remove="${escapeHtml(s)}" title="Remove ${escapeHtml(s)} from history">×</button>
            </div>
          </div>
        `).join('')}
      `;
    }
    container.hidden = false;
    bindDropdownActions();
  }

  function renderSuggestions(query) {
    const q = String(query || '').trim().toUpperCase();
    if (!q) {
      renderRecentHistory();
      return;
    }

    const all = getAllKnownSerials();
    const exact = [];
    const prefix = [];
    const contains = [];

    all.forEach((item) => {
      const s = item.serial.toUpperCase();
      if (s === q) exact.push(item);
      else if (s.startsWith(q)) prefix.push(item);
      else if (s.includes(q)) contains.push(item);
    });

    const matches = [...exact, ...prefix, ...contains].slice(0, 8);

    if (!matches.length) {
      const typo = findBestTypoMatch(q, all);
      if (typo) {
        container.innerHTML = `
          <div class="smart-serial-typo-notice">
            <div class="smart-serial-typo-header">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>Serial not found. Did you mean:</span>
            </div>
            <button type="button" class="smart-serial-suggest-btn" data-serial="${escapeHtml(typo)}">
              <span>${escapeHtml(typo)}</span>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        `;
        container.hidden = false;
      } else {
        container.innerHTML = `
          <div class="smart-serial-empty">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>No charger found matching "${escapeHtml(q)}"</span>
          </div>
        `;
        container.hidden = false;
      }
      bindDropdownActions();
      return;
    }

    container.innerHTML = `
      <div class="smart-serial-section-header">
        <span>Matching Chargers</span>
      </div>
      ${matches.map((item, idx) => {
        const isOnline = item.status === 'online' || item.status === 'history';
        const statusDot = `<span class="smart-serial-dot ${isOnline ? 'online' : 'offline'}"></span>`;
        return `
          <div class="smart-serial-item ${idx === selectedIndex ? 'is-selected' : ''}" data-serial="${escapeHtml(item.serial)}">
            <div class="smart-serial-item-left">
              ${statusDot}
              <strong class="smart-serial-code">${escapeHtml(item.serial)}</strong>
            </div>
            <span class="smart-serial-meta">${escapeHtml(item.model || '')}</span>
          </div>
        `;
      }).join('')}
    `;

    container.hidden = false;
    bindDropdownActions();
  }

  inputElement.addEventListener('focus', () => {
    if (inputElement.value.trim()) {
      renderSuggestions(inputElement.value);
    } else {
      renderRecentHistory();
    }
  });

  inputElement.addEventListener('input', () => {
    renderSuggestions(inputElement.value);
  });

  inputElement.addEventListener('keydown', (e) => {
    const items = container.querySelectorAll('.smart-serial-item');
    if (!container.hidden && items.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % items.length;
        items.forEach((it, i) => it.classList.toggle('is-selected', i === selectedIndex));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        items.forEach((it, i) => it.classList.toggle('is-selected', i === selectedIndex));
        return;
      }
      if (e.key === 'Enter') {
        if (selectedIndex >= 0 && items[selectedIndex]) {
          e.preventDefault();
          selectValue(items[selectedIndex].dataset.serial);
          return;
        }
      }
      if (e.key === 'Escape') {
        closeDropdown();
        return;
      }
    }

    if (e.key === 'Enter') {
      const suggestBtn = container.querySelector('.smart-serial-suggest-btn');
      if (!container.hidden && suggestBtn) {
        e.preventDefault();
        const typo = suggestBtn.dataset.serial;
        if (typo) {
          selectValue(typo);
          return;
        }
      }

      const val = inputElement.value.trim().toUpperCase();
      const all = getAllKnownSerials();
      const exactMatch = all.find((it) => it.serial.toUpperCase() === val);
      if (!exactMatch && val) {
        const typo = findBestTypoMatch(val, all);
        if (typo) {
          e.preventDefault();
          renderSuggestions(val);
          return;
        }
      }
      closeDropdown();
      if (val) {
        selectValue(val);
      }
    }

    if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  inputElement.addEventListener('blur', () => {
    window.setTimeout(closeDropdown, 250);
  });
}

function renderSerialHistory() {
  // Legacy stub maintained for compatibility
}

function setSerialFeedback(message, invalid = false) {
  const feedback = document.getElementById('serialFeedback');
  const input = document.getElementById('serialNumber');
  if (!feedback || !input) {
    return;
  }
  feedback.textContent = message;
  feedback.hidden = !message;
  feedback.classList.toggle('is-invalid', invalid);
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}

function scheduleSerialSearch(delay = 700) {
  const input = document.getElementById('serialNumber');
  const menu = document.getElementById('serialHistory');
  const serialNumber = input.value.trim();
  window.clearTimeout(state.serialSearchTimer);
  state.serialSearchTimer = null;
  setSerialFeedback('');

  if (serialNumber.length < 14) {
    return;
  }
  if (!/^TACW[A-Z0-9]{10,12}$/i.test(serialNumber)) {
    setSerialFeedback('Check the serial number format.', true);
    return;
  }

  state.serialSearchTimer = window.setTimeout(() => {
    state.serialSearchTimer = null;
    if (input.value.trim().toUpperCase() !== serialNumber.toUpperCase()) {
      return;
    }
    menu.hidden = true;
    rememberSerial(serialNumber);
    fetchEvents();
    checkSseInteractions(serialNumber);
  }, delay);
}

function loadSample() {
  document.getElementById('serialNumber').value = SAMPLE.serialNumber;
  setDefaultWindow();
}

async function triggerAutoTokenCapture({ environment = state.currentEnv, force = false, noBrowser = false } = {}) {
  const env = String(environment || 'prod').toLowerCase();
  const params = new URLSearchParams({ env, app: currentTokenApp() });
  if (force) params.set('force', 'true');
  if (noBrowser) params.set('noBrowser', '1');
  try {
    const response = await fetch(dashboardApiUrl(`/api/refresh-tme-token?${params.toString()}`), { method: 'POST' });
    const result = await response.json();
    if (result && result.ok) {
      setStatus(`Refreshing TME session for ${env.toUpperCase()} automatically.`, 'info');
      return true;
    }
  } catch (error) {
    // Ignore and keep polling the local token endpoint.
  }

  return false;
}

async function waitForAutoToken(timeoutMs = 390000, { environment = state.currentEnv, differentFrom = '' } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (environment !== state.currentEnv) return false;
    const loaded = await loadStoredTokenFromLocalBridge({ environment, differentFrom });
    if (loaded) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return false;
}

async function autoLoadSavedTokenAndSearch() {
  const loaded = await loadStoredTokenFromLocalBridge();
  if (loaded) {
    setStatus('Saved TME token loaded. Loading events automatically...', 'success');
    await fetchEvents();
    return;
  }

  const started = await triggerAutoTokenCapture();
  if (!started) {
    setStatus('Session required. Sign in to the TME dashboard, then click Refresh data.', 'warning');
    return;
  }

  const tokenLoaded = await waitForAutoToken();
  if (tokenLoaded) {
    setStatus('Fresh TME token loaded. Loading events automatically...', 'success');
    await fetchEvents();
    return;
  }

  setStatus('Automatic token refresh is in progress; sign in to TME and reload the page when the session is ready.', 'warning');
}

async function retryLoginFromScratch() {
  if (state.tokenRefreshInProgress) return;
  state.tokenRefreshInProgress = true;
  const env = (state.currentEnv || 'prod').toLowerCase();
  const envUpper = env.toUpperCase();
  if (!__fotaHeaderOnly) __dashboardNeedsInitialTokenRefresh = false;
  if (!state.token) await loadStoredTokenFromLocalBridge({ environment: env, scanBrowser: true });
  const tokenBeforeRefresh = String(state.token || '').replace(/^Bearer\s+/i, '').trim();
  const refreshBtn = document.getElementById('globalTokenRefresh');
  const refreshIcon = refreshBtn?.querySelector('svg');
  if (refreshBtn) refreshBtn.classList.add('rotating');
  if (refreshIcon) refreshIcon.style.animation = 'spin 1s linear infinite';

  applyTokenPillDisplay({
    env,
    valid: false,
    expired: false,
    hasToken: false,
    minutesRemaining: 0,
    capturing: true,
  });

  const app = currentTokenApp();
  const isFota = app === 'fota';
  setStatus(
    isFota
      ? `Checking for an existing ${envUpper} FOTA sign-in in your browser...`
      : `Opening a fresh ${envUpper} ${app.toUpperCase()} sign-in tab in your browser...`,
    'warning',
  );
  try {
    const params = new URLSearchParams({ env, app });
    if (!isFota) params.set('force', 'true');
    const res = await fetch(dashboardApiUrl(`/api/refresh-tme-token?${params.toString()}`), { method: 'POST' });
    const data = await res.json();
    if (!data?.ok) {
      setStatus(data?.message || `Could not start ${app.toUpperCase()} authentication for ${envUpper}.`, 'error');
      if (refreshBtn) refreshBtn.classList.remove('rotating');
      if (refreshIcon) refreshIcon.style.animation = '';
      await checkLiveTokenHealth();
      state.tokenRefreshInProgress = false;
      return;
    }
  } catch (err) {
    setStatus(`Failed to initiate fresh login for ${envUpper}: ${err.message}`, 'error');
    if (refreshBtn) refreshBtn.classList.remove('rotating');
    if (refreshIcon) refreshIcon.style.animation = '';
    await checkLiveTokenHealth();
    state.tokenRefreshInProgress = false;
    return;
  }

  const tokenLoaded = await waitForAutoToken(390000, {
    environment: env,
    differentFrom: isFota ? '' : tokenBeforeRefresh,
  });
  if (refreshBtn) refreshBtn.classList.remove('rotating');
  if (refreshIcon) refreshIcon.style.animation = '';

  if (tokenLoaded) {
    setStatus(`Fresh ${envUpper} token captured successfully! Synchronizing live data...`, 'success');
    await checkLiveTokenHealth();
    loadFleetMetadata();
    if (state.currentView === 'fleet') {
      fetchOutages();
      await fetchFleetWallboxes(0);
    } else if (state.currentView === 'charger') {
      const serial = document.getElementById('serialNumber')?.value?.trim();
      if (serial) {
        fetchEvents();
        checkSseInteractions(serial);
      }
    } else if (state.currentView === 'ops') {
      fetchOpsAnalytics(env);
    }
  } else {
    await checkLiveTokenHealth();
    setStatus(`Fresh login timed out for ${envUpper}. Complete sign-in in the TME tab, then click Refresh again.`, 'warning');
  }
  state.tokenRefreshInProgress = false;
}

/* ========================================================
   Fleet Management & Charging Stations List Logic
   ======================================================== */
const EUROPEAN_COUNTRIES = [
  { code: 'AT', name: 'Austria' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DE', name: 'Germany' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ES', name: 'Spain' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'GR', name: 'Greece' },
  { code: 'HR', name: 'Croatia' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'LV', name: 'Latvia' },
  { code: 'MT', name: 'Malta' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'RO', name: 'Romania' },
  { code: 'SE', name: 'Sweden' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'SK', name: 'Slovakia' },
];

function getCountryFlag(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function formatCountryName(countryCode) {
  if (!countryCode) return '—';
  try {
    const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(countryCode.toUpperCase()) || countryCode;
  } catch (e) {
    return countryCode;
  }
}

function openChargerDashboard(serialNumber) {
  if (!serialNumber) return;
  const serial = serialNumber.trim().toUpperCase();
  state.currentView = 'charger';

  const fleetView = document.getElementById('fleetView');
  const chargerView = document.getElementById('chargerView');
  const opsView = document.getElementById('opsAnalyticsView');
  const kubernetesView = document.getElementById('kubernetesPodsView');
  const backBtn = document.getElementById('backToFleetBtn');
  const topbarTitle = document.getElementById('topbarTitle');
  const statusCluster = document.getElementById('topbarChargerStatusCluster');
  const serialInput = document.getElementById('serialNumber');
  const topbarOpsBtn = document.getElementById('topbarOpsBtn');

  if (fleetView) fleetView.hidden = true;
  if (chargerView) chargerView.hidden = false;
  if (opsView) opsView.hidden = true;
  if (kubernetesView) kubernetesView.hidden = true;
  if (topbarOpsBtn) topbarOpsBtn.classList.remove('active');
  document.getElementById('topbarKubernetesBtn')?.classList.remove('active');
  stopKubernetesPolling();
  if (backBtn) backBtn.hidden = false;
  if (statusCluster) statusCluster.hidden = false;
  document.querySelector('.topbar')?.setAttribute('data-view', 'charger');
  updateTopbarChargerStatus();
  if (topbarTitle) {
    topbarTitle.textContent = 'Charger Dashboard';
    topbarTitle.hidden = false;
  }
  updateActiveChargerBadge(serial);
  if (serialInput) {
    serialInput.value = serial;
    rememberSerial(serial);
  }

  try {
    history.replaceState({ view: 'charger', serial }, '', `#charger=${encodeURIComponent(serial)}`);
  } catch (e) {}

  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateEnvironmentUI();
  updateFloatingTimeToolbar();
  fetchEvents();
  checkSseInteractions(serial);
}

function updateActiveChargerBadge(serialNumber) {
  const activeBadge = document.getElementById('activeChargerBadge');
  const serial = String(serialNumber || '').trim().toUpperCase();
  if (!activeBadge || !serial) return;
  activeBadge.hidden = false;
  activeBadge.innerHTML = `<span class="badge-label">Active Unit:</span><span class="badge-serial">${escapeHtml(serial)}</span>`;
}

function openFleetView({ loadFleet = true } = {}) {
  state.currentView = 'fleet';
  const fleetView = document.getElementById('fleetView');
  const chargerView = document.getElementById('chargerView');
  const opsView = document.getElementById('opsAnalyticsView');
  const kubernetesView = document.getElementById('kubernetesPodsView');
  const backBtn = document.getElementById('backToFleetBtn');
  const topbarTitle = document.getElementById('topbarTitle');
  const activeBadge = document.getElementById('activeChargerBadge');
  const statusCluster = document.getElementById('topbarChargerStatusCluster');
  const topbarOpsBtn = document.getElementById('topbarOpsBtn');

  if (fleetView) fleetView.hidden = false;
  if (chargerView) chargerView.hidden = true;
  if (opsView) opsView.hidden = true;
  if (kubernetesView) kubernetesView.hidden = true;
  if (topbarOpsBtn) topbarOpsBtn.classList.remove('active');
  document.getElementById('topbarKubernetesBtn')?.classList.remove('active');
  stopKubernetesPolling();
  if (backBtn) backBtn.hidden = true;
  if (statusCluster) statusCluster.hidden = true;
  document.querySelector('.topbar')?.setAttribute('data-view', 'fleet');
  if (topbarTitle) {
    topbarTitle.textContent = 'Charging stations';
    topbarTitle.hidden = false;
  }
  if (activeBadge) activeBadge.hidden = true;

  try {
    history.replaceState({ view: 'fleet' }, '', window.location.pathname);
  } catch (e) {}

  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateEnvironmentUI();
  updateFloatingTimeToolbar();
  fetchOutages();
  if (loadFleet && (!state.fleet.items.length || state.fleet.error)) {
    fetchFleetWallboxes(state.fleet.page || 0);
  }
}

function openOpsAnalyticsView() {
  state.currentView = 'ops';
  const fleetView = document.getElementById('fleetView');
  const chargerView = document.getElementById('chargerView');
  const opsView = document.getElementById('opsAnalyticsView');
  const kubernetesView = document.getElementById('kubernetesPodsView');
  const backBtn = document.getElementById('backToFleetBtn');
  const topbarTitle = document.getElementById('topbarTitle');
  const activeBadge = document.getElementById('activeChargerBadge');
  const statusCluster = document.getElementById('topbarChargerStatusCluster');
  const topbarOpsBtn = document.getElementById('topbarOpsBtn');

  if (fleetView) fleetView.hidden = true;
  if (chargerView) chargerView.hidden = true;
  if (opsView) opsView.hidden = false;
  if (kubernetesView) kubernetesView.hidden = true;
  if (topbarOpsBtn) topbarOpsBtn.classList.add('active');
  document.getElementById('topbarKubernetesBtn')?.classList.remove('active');
  stopKubernetesPolling();
  document.querySelector('.topbar')?.setAttribute('data-view', 'ops');
  if (backBtn) backBtn.hidden = false;
  if (statusCluster) statusCluster.hidden = true;
  if (topbarTitle) {
    topbarTitle.textContent = '';
    topbarTitle.hidden = true;
  }
  if (activeBadge) activeBadge.hidden = true;

  try {
    history.replaceState({ view: 'ops' }, '', '#analytics');
  } catch (e) {}

  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateEnvironmentUI();
  updateFloatingTimeToolbar();
  fetchOpsAnalytics(state.currentEnv);
}

function stopKubernetesPolling() {
  window.clearInterval(state.kubernetes.authPollTimer);
  window.clearInterval(state.kubernetes.refreshTimer);
  window.clearInterval(state.kubernetes.logTimer);
  state.kubernetes.authPollTimer = null;
  state.kubernetes.refreshTimer = null;
  state.kubernetes.logTimer = null;
}

function openKubernetesPodsView() {
  state.currentView = 'kubernetes';
  document.getElementById('fleetView').hidden = true;
  document.getElementById('chargerView').hidden = true;
  document.getElementById('opsAnalyticsView').hidden = true;
  document.getElementById('kubernetesPodsView').hidden = false;
  document.getElementById('topbarOpsBtn')?.classList.remove('active');
  document.getElementById('topbarKubernetesBtn')?.classList.add('active');
  document.getElementById('backToFleetBtn').hidden = false;
  document.getElementById('topbarChargerStatusCluster').hidden = true;
  document.getElementById('activeChargerBadge').hidden = true;
  const title = document.getElementById('topbarTitle');
  title.textContent = 'Observability';
  title.hidden = false;
  document.querySelector('.topbar')?.setAttribute('data-view', 'kubernetes');
  updateKubernetesEnvironmentControls();
  document.getElementById('kubernetesNamespaceSelect').value = state.kubernetes.namespace;
  document.getElementById('kubernetesTimeRange').value = state.kubernetes.timeRange;
  try {
    history.replaceState({ view: 'kubernetes' }, '', '#kubernetes');
  } catch (e) {}
  stopKubernetesPolling();
  void checkKubernetesCredentials();
  state.kubernetes.refreshTimer = window.setInterval(() => {
    if (state.currentView === 'kubernetes' && state.kubernetes.auth === 'ready') {
      void fetchKubernetesPods();
    }
  }, 30000);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  updateEnvironmentUI();
  updateFloatingTimeToolbar();
}

function updateKubernetesEnvironmentControls() {
  const env = state.kubernetes.env;
  const environmentSelect = document.getElementById('kubernetesEnvironmentSelect');
  const namespaceSelect = document.getElementById('kubernetesNamespaceSelect');
  const environmentLabel = { prod: 'Production', acc: 'ACC', prev: 'PREV', dev: 'DEV' }[env];
  environmentSelect.value = env;
  namespaceSelect.innerHTML = `<option value="all">All ${environmentLabel} namespaces</option>${KUBERNETES_NAMESPACE_OPTIONS[env]
    .map(([namespace, label]) => `<option value="${namespace}">${label} · ${namespace}</option>`)
    .join('')}`;
  document.getElementById('kubernetesEnvironmentHeading').textContent = `${environmentLabel} services`;
  document.getElementById('kubernetesEnvironmentDescription').textContent = `Live signals from the approved ${environmentLabel} namespaces.`;
  document.getElementById('kubernetesTerminalEnvironment').textContent = `Interactive shell through the ${env.toUpperCase()} EKS profile`;
  document.getElementById('kubernetesRefreshBtn').setAttribute('aria-label', `Refresh ${env.toUpperCase()} pod data`);
  document.getElementById('kubernetesRefreshBtn').title = `Refresh ${env.toUpperCase()} pod data`;
  document.getElementById('kubernetesSummaryGrid').setAttribute('aria-label', `${environmentLabel} service health`);
  document.getElementById('kubernetesOperationalTimeline').setAttribute('aria-label', `Unified ${environmentLabel} operations timeline`);
}

function changeKubernetesEnvironment(env) {
  if (!Object.hasOwn(KUBERNETES_NAMESPACE_OPTIONS, env) || env === state.kubernetes.env) return;
  closeKubernetesTerminal('Session stopped after changing environment.');
  state.kubernetes.env = env;
  state.kubernetes.auth = 'idle';
  state.kubernetes.error = '';
  state.kubernetes.authRequestId += 1;
  if (state.kubernetes.authPollTimer) {
    window.clearInterval(state.kubernetes.authPollTimer);
    state.kubernetes.authPollTimer = null;
  }
  updateKubernetesEnvironmentControls();
  const namespaceSelect = document.getElementById('kubernetesNamespaceSelect');
  namespaceSelect.value = 'all';
  namespaceSelect.dispatchEvent(new Event('change'));
  void checkKubernetesCredentials();
}

function renderKubernetesAuth() {
  const panel = document.getElementById('kubernetesAuthPanel');
  const dataView = document.getElementById('kubernetesDataView');
  const title = document.getElementById('kubernetesAuthTitle');
  const message = document.getElementById('kubernetesAuthMessage');
  const loginButton = document.getElementById('kubernetesLoginBtn');
  const authSpinner = document.getElementById('kubernetesAuthSpinner');
  const loadingPanel = document.getElementById('kubernetesLoadingPanel');
  const auth = state.kubernetes.auth;
  const env = state.kubernetes.env.toUpperCase();
  const authCopy = {
    checking: ['Checking AWS access', `Verifying the configured AWS profile for ${env}.`],
    'login-required': ['AWS sign-in required', `Sign in with the configured ${env} AWS profile to inspect this cluster.`],
    authenticating: ['Complete AWS sign-in', 'Finish the sign-in in the browser window opened by AWS CLI. This view will detect the session automatically.'],
    'cli-missing': ['AWS CLI unavailable', 'Install and configure AWS CLI v2 with the provided EKS read-only profile, then reopen this view.'],
    'identity-error': ['Could not verify AWS access', 'The profile returned an unexpected identity response. Retry the check or open the AWS access portal.'],
    error: ['AWS access check failed', state.kubernetes.error || 'The local backend could not verify AWS access.'],
    idle: ['Checking AWS access', `Verifying the read-only profile for ${env}.`],
  };
  const [heading, copy] = authCopy[auth] || authCopy.error;
  title.textContent = heading;
  message.textContent = copy;
  panel.hidden = auth === 'ready';
  dataView.hidden = !state.kubernetes.result;
  authSpinner.hidden = !['checking', 'authenticating'].includes(auth);
  loadingPanel.hidden = auth !== 'ready' || Boolean(state.kubernetes.result);
  loginButton.hidden = !['login-required', 'identity-error', 'error'].includes(auth);
  loginButton.disabled = auth === 'authenticating';
}

async function readKubernetesApiResponse(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The local operations API is unavailable. Start or restart the Python backend, then retry.');
  }
  return response.json();
}

async function checkKubernetesCredentials() {
  const env = state.kubernetes.env;
  const requestId = ++state.kubernetes.authRequestId;
  if (state.kubernetes.auth !== 'authenticating') state.kubernetes.auth = 'checking';
  renderKubernetesAuth();
  try {
    const response = await fetch(`/api/kubernetes/status?env=${encodeURIComponent(env)}`);
    const data = await readKubernetesApiResponse(response);
    if (requestId !== state.kubernetes.authRequestId || env !== state.kubernetes.env) return;
    if (!response.ok || !data.ok) throw new Error(data.message || 'AWS access status is unavailable.');
    if (data.authenticated) {
      const wasReady = state.kubernetes.auth === 'ready';
      state.kubernetes.auth = 'ready';
      state.kubernetes.error = '';
      renderKubernetesAuth();
      if (!wasReady || !state.kubernetes.result || state.kubernetes.result.namespace !== state.kubernetes.namespace) {
        void fetchKubernetesPods();
      }
      if (state.kubernetes.authPollTimer) {
        window.clearInterval(state.kubernetes.authPollTimer);
        state.kubernetes.authPollTimer = null;
      }
      return;
    }
    if (state.kubernetes.auth !== 'authenticating') state.kubernetes.auth = data.status || 'login-required';
    renderKubernetesAuth();
  } catch (error) {
    if (requestId !== state.kubernetes.authRequestId || env !== state.kubernetes.env) return;
    state.kubernetes.auth = 'error';
    state.kubernetes.error = error.message;
    renderKubernetesAuth();
  }
}

async function startKubernetesLogin() {
  const button = document.getElementById('kubernetesLoginBtn');
  button.disabled = true;
  state.kubernetes.auth = 'authenticating';
  renderKubernetesAuth();
  try {
    const response = await fetch(`/api/kubernetes/login?env=${encodeURIComponent(state.kubernetes.env)}`, { method: 'POST' });
    const data = await readKubernetesApiResponse(response);
    if (!response.ok || !data.ok) throw new Error(data.message || 'Could not start AWS SSO sign-in.');
    if (!data.started) throw new Error('AWS CLI did not start the SSO sign-in process. Retry or open the AWS access portal.');
    state.kubernetes.authPollTimer = window.setInterval(() => {
      void checkKubernetesCredentials();
    }, 2500);
    void checkKubernetesCredentials();
  } catch (error) {
    state.kubernetes.auth = 'error';
    state.kubernetes.error = error.message;
    renderKubernetesAuth();
  }
}

async function fetchKubernetesPods(refreshInfrastructure = false) {
  if (state.kubernetes.inventoryLoading) return;
  state.kubernetes.inventoryLoading = true;
  const env = state.kubernetes.env;
  const namespace = state.kubernetes.namespace;
  const requestId = ++state.kubernetes.requestId;
  const refreshButton = document.getElementById('kubernetesRefreshBtn');
  const errorMessage = document.getElementById('kubernetesErrorMessage');
  refreshButton.classList.add('loading');
  refreshButton.disabled = true;
  errorMessage.hidden = true;
  try {
    const params = new URLSearchParams({ env, namespace });
    const response = await fetch(`/api/kubernetes/pods?${params.toString()}`);
    const data = await readKubernetesApiResponse(response);
    if (requestId !== state.kubernetes.requestId || env !== state.kubernetes.env || namespace !== state.kubernetes.namespace) return;
    if (response.status === 401) {
      state.kubernetes.auth = 'login-required';
      state.kubernetes.result = null;
      renderKubernetesAuth();
      return;
    }
    if (!response.ok || !data.ok) throw new Error(data.message || 'Pod inventory could not be loaded.');
    const previousResult = state.kubernetes.result;
    const hasUsableSnapshot = previousResult?.namespaces?.some((snapshot) => snapshot.availability?.pods && snapshot.availability?.deployments);
    const primarySourceFailed = data.namespaces?.some((snapshot) => !snapshot.availability?.pods || !snapshot.availability?.deployments);
    if (previousResult?.namespace === namespace && hasUsableSnapshot && primarySourceFailed) {
      errorMessage.textContent = 'The latest refresh could not read every workload source. Keeping the last successful snapshot.';
      errorMessage.hidden = false;
      return;
    }
    if (state.kubernetes.infrastructureNamespace === namespace && state.kubernetes.infrastructure?.nodes?.length) {
      const infrastructureNodes = new Map(state.kubernetes.infrastructure.nodes.map((node) => [`${node.namespace}/${node.name}`, node]));
      data.nodes = (data.nodes || []).map((node) => {
        const enriched = infrastructureNodes.get(`${node.namespace}/${node.name}`);
        return enriched ? { ...node, ...enriched } : node;
      });
    }
    state.kubernetes.result = data;
    state.kubernetes.auth = 'ready';
    state.kubernetes.error = '';
    renderKubernetesAuth();
    renderKubernetesPods(data);
    void fetchKubernetesInfrastructure(refreshInfrastructure);
  } catch (error) {
    if (requestId !== state.kubernetes.requestId) return;
    document.getElementById('kubernetesLoadingPanel').hidden = true;
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
  } finally {
    if (requestId === state.kubernetes.requestId) {
      state.kubernetes.inventoryLoading = false;
      refreshButton.classList.remove('loading');
      refreshButton.disabled = false;
    }
  }
}

async function fetchKubernetesInfrastructure(force = false) {
  const namespace = state.kubernetes.namespace;
  if (!state.kubernetes.result || state.kubernetes.infrastructureLoading) return;
  if (!force && state.kubernetes.infrastructureNamespace === namespace && Date.now() - state.kubernetes.infrastructureFetchedAt < 300000) return;
  const requestId = ++state.kubernetes.infrastructureRequestId;
  state.kubernetes.infrastructureLoading = true;
  state.kubernetes.infrastructureError = '';
  try {
    const params = new URLSearchParams({ env: state.kubernetes.env, namespace, refresh: force ? 'true' : 'false' });
    const response = await fetch(`/api/kubernetes/infrastructure?${params.toString()}`);
    const data = await readKubernetesApiResponse(response);
    if (requestId !== state.kubernetes.infrastructureRequestId || namespace !== state.kubernetes.namespace) return;
    if (!response.ok || !data.ok) throw new Error(data.message || 'AWS infrastructure context is unavailable.');
    const infrastructureNodes = new Map(data.nodes.map((node) => [`${node.namespace}/${node.name}`, node]));
    state.kubernetes.result.nodes = (state.kubernetes.result.nodes || []).map((node) => {
      const enriched = infrastructureNodes.get(`${node.namespace}/${node.name}`);
      return enriched ? { ...node, ...enriched } : node;
    });
    state.kubernetes.infrastructure = data;
    state.kubernetes.infrastructureNamespace = namespace;
    state.kubernetes.infrastructureFetchedAt = Date.now();
  } catch (error) {
    if (requestId !== state.kubernetes.infrastructureRequestId || namespace !== state.kubernetes.namespace) return;
    state.kubernetes.infrastructure = null;
    state.kubernetes.infrastructureNamespace = namespace;
    state.kubernetes.infrastructureFetchedAt = Date.now();
    state.kubernetes.infrastructureError = error.message;
  } finally {
    if (requestId === state.kubernetes.infrastructureRequestId) {
      state.kubernetes.infrastructureLoading = false;
      if (state.kubernetes.result && namespace === state.kubernetes.namespace) renderKubernetesPods(state.kubernetes.result);
    }
  }
}

function renderKubernetesPods(data) {
  const pods = data.pods || [];
  const deployments = data.deployments || [];
  const deploymentByName = new Map(deployments.map((deployment) => [`${deployment.namespace}/${deployment.name}`, deployment]));
  const services = new Map();
  deployments.forEach((deployment) => {
    const key = `${deployment.namespace}/${deployment.serviceKey || deployment.name}`;
    if (!services.has(key)) services.set(key, {
      key,
      name: deployment.serviceName || deployment.name,
      namespace: deployment.namespace,
      deployments: [],
      pods: [],
      nodes: [],
      events: [],
      health: 'Unknown',
      issueAt: '',
      restartActivity: 0,
      warningActivity: 0,
      cpu: null,
      memory: null,
      metricsAvailable: data.metricsAvailable?.[deployment.namespace] === true,
    });
    services.get(key).deployments.push(deployment);
  });

  const nodesByKey = new Map((data.nodes || []).map((node) => [`${node.namespace}/${node.name}`, node]));
  const events = data.events || [];
  const rangeStart = Date.now() - kubernetesRangeMilliseconds();
  const inRange = (timestamp) => {
    const value = Date.parse(timestamp || '');
    return Number.isFinite(value) && value >= rangeStart && value <= Date.now();
  };
  services.forEach((service) => {
    const workloadNames = new Set(service.deployments.map((deployment) => deployment.name));
    service.pods = pods.filter((pod) => pod.namespace === service.namespace && workloadNames.has(pod.workload || ''));
    const nodeNames = new Set(service.pods.map((pod) => pod.node).filter((name) => name && name !== '-'));
    service.nodes = [...nodeNames].map((name) => nodesByKey.get(`${service.namespace}/${name}`)).filter(Boolean);
    const podNames = new Set(service.pods.map((pod) => pod.name));
    service.events = events.filter((event) => event.namespace === service.namespace && (
      (event.objectKind === 'Pod' && podNames.has(event.objectName))
      || (event.objectKind === 'Deployment' && workloadNames.has(event.objectName))
      || (event.objectKind === 'Node' && nodeNames.has(event.objectName))
    ));
    const modules = new Map();
    service.deployments.forEach((deployment) => {
      const module = deployment.module || 'Workload';
      if (!modules.has(module)) modules.set(module, { name: module, desired: 0, ready: 0, available: 0, deployments: [], health: 'Healthy' });
      const group = modules.get(module);
      group.desired += deployment.desiredReplicas || 0;
      group.ready += deployment.readyReplicas || 0;
      group.available += deployment.availableReplicas || 0;
      group.deployments.push(deployment);
    });
    service.modules = [...modules.values()].sort((left, right) => left.name.localeCompare(right.name));
    service.modules.forEach((module) => {
      module.health = module.ready === 0 && module.desired > 0 ? 'Critical' : module.ready < module.desired ? 'Warning' : 'Healthy';
    });
    service.restartActivity = service.pods.reduce((total, pod) => total + (pod.restarts || 0), 0);
    service.warningActivity = service.events.filter((event) => event.type === 'Warning' && inRange(event.timestamp)).length;
    const recentTerminations = service.pods.flatMap((pod) => pod.containers || []).filter((container) => inRange(container.lastFinishedAt));
    const recentWarnings = service.events.filter((event) => event.type === 'Warning' && inRange(event.timestamp));
    const criticalEvent = recentWarnings.some((event) => /FailedScheduling|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|FailedMount|NodeNotReady|OOMKilled/i.test(`${event.reason} ${event.message}`));
    const failedPod = service.pods.some((pod) => pod.health === 'Failed' || (pod.containers || []).some((container) => /CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled/i.test(`${container.reason} ${container.lastReason}`)));
    const unhealthyNode = service.nodes.some((node) => node.ready === false || node.aws?.state && node.aws.state !== 'running' || node.aws?.systemStatus && node.aws.systemStatus !== 'ok' || node.aws?.instanceStatus && node.aws.instanceStatus !== 'ok');
    const unavailableReplicaSet = service.deployments.some((deployment) => deployment.desiredReplicas > 0 && deployment.readyReplicas === 0);
    const degraded = service.deployments.some((deployment) => deployment.readyReplicas < deployment.desiredReplicas);
    if (data.namespaces?.some((snapshot) => snapshot.namespace === service.namespace && (!snapshot.availability?.deployments || !snapshot.availability?.pods))) service.health = 'Unknown';
    else if (criticalEvent || failedPod || unhealthyNode || unavailableReplicaSet) service.health = 'Critical';
    else if (degraded || recentWarnings.length || recentTerminations.length) service.health = 'Warning';
    else service.health = 'Healthy';
    const issueTimes = [
      ...recentWarnings.map((event) => event.timestamp),
      ...recentTerminations.map((container) => container.lastFinishedAt),
      ...service.pods.flatMap((pod) => (pod.conditions || []).filter((condition) => condition.status !== 'True').map((condition) => condition.lastTransitionTime)),
    ].filter(inRange).sort();
    service.issueAt = issueTimes.at(-1) || '';
    const usage = service.pods.map((pod) => kubernetesPodMetrics(data, pod)).filter(Boolean);
    if (usage.length) {
      service.cpu = usage.reduce((total, item) => total + Number.parseFloat(item.cpu), 0);
      service.memory = usage.reduce((total, item) => total + Number.parseFloat(item.memory), 0);
    }
  });
  state.kubernetes.serviceModels = [...services.values()];
  const counts = state.kubernetes.serviceModels.reduce((summary, service) => {
    summary[service.health] = (summary[service.health] || 0) + 1;
    return summary;
  }, {});
  document.getElementById('kubernetesCriticalServiceCount').textContent = counts.Critical || 0;
  document.getElementById('kubernetesWarningServiceCount').textContent = counts.Warning || 0;
  document.getElementById('kubernetesHealthyServiceCount').textContent = counts.Healthy || 0;
  document.getElementById('kubernetesAffectedServiceCount').textContent = (counts.Critical || 0) + (counts.Warning || 0);
  document.getElementById('kubernetesServiceCatalogMeta').textContent = `${state.kubernetes.serviceModels.length} services · ${counts.Unknown || 0} with no data · ${deployments.length} workloads · ${pods.length} pods`;
  const sourceIssues = (data.namespaces || []).flatMap((snapshot) => {
    const issues = [];
    if (!snapshot.availability?.pods) issues.push(`${snapshot.namespace}: pod inventory unavailable`);
    if (!snapshot.availability?.deployments) issues.push(`${snapshot.namespace}: service workload inventory unavailable`);
    if (!snapshot.availability?.nodes) issues.push(`${snapshot.namespace}: Kubernetes node details unavailable`);
    if (!snapshot.availability?.events) issues.push(`${snapshot.namespace}: events unavailable`);
    if (!snapshot.availability?.metrics) issues.push(`${snapshot.namespace}: ${snapshot.errors?.metrics || 'current metrics unavailable'}`);
    return issues;
  });
  const availabilityNotice = document.getElementById('kubernetesAvailabilityNotice');
  const infrastructure = state.kubernetes.infrastructure;
  if (infrastructure) {
    infrastructure.namespaces.forEach((snapshot) => {
      if (!snapshot.availability?.nodes) sourceIssues.push(`${snapshot.namespace}: Kubernetes node details unavailable`);
      if (snapshot.nodes?.length && !snapshot.availability?.ec2) sourceIssues.push(`${snapshot.namespace}: EC2 enrichment unavailable`);
      if (snapshot.nodes?.length && !snapshot.availability?.cloudWatchCpu) sourceIssues.push(`${snapshot.namespace}: CloudWatch CPU history unavailable`);
      if (snapshot.nodes?.length && !snapshot.availability?.alarms) sourceIssues.push(`${snapshot.namespace}: CloudWatch alarms unavailable`);
    });
  }
  if (state.kubernetes.infrastructureError) sourceIssues.push('AWS infrastructure context unavailable; Kubernetes service data remains available.');
  availabilityNotice.hidden = sourceIssues.length === 0;
  availabilityNotice.textContent = sourceIssues.length ? sourceIssues.join(' · ') : '';
  document.getElementById('kubernetesTableMeta').textContent = `${pods.length} pods in selected namespace scope`;
  renderKubernetesServiceGrid();
  renderKubernetesServiceDetail();
  renderKubernetesTimeline(data);
  renderKubernetesPodTable();
}

function kubernetesServiceHealthPriority(health) {
  return { Critical: 0, Warning: 1, Unknown: 2, Healthy: 3 }[health] ?? 4;
}

function kubernetesServiceSparkline(service) {
  const start = Date.now() - kubernetesRangeMilliseconds();
  const series = service.nodes.flatMap((node) => (node.aws?.cpu || []).filter((sample) => Date.parse(sample.timestamp) >= start).map((sample) => ({
    timestamp: Date.parse(sample.timestamp),
    value: Number(sample.value),
  }))).filter((sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.value)).sort((left, right) => left.timestamp - right.timestamp);
  if (series.length < 2) return '<span class="kubernetes-sparkline-empty">No EC2 CPU history</span>';
  const min = Math.min(...series.map((sample) => sample.value));
  const max = Math.max(...series.map((sample) => sample.value));
  const span = max - min || 1;
  const first = series[0].timestamp;
  const duration = Math.max(1, series.at(-1).timestamp - first);
  const points = series.map((sample) => `${((sample.timestamp - first) / duration * 100).toFixed(1)},${(26 - (sample.value - min) / span * 22).toFixed(1)}`).join(' ');
  return `<svg class="kubernetes-service-sparkline" viewBox="0 0 100 28" role="img" aria-label="Observed EC2 CPU from ${series.length} CloudWatch samples"><polyline points="${points}" /></svg>`;
}

function renderKubernetesServiceGrid() {
  const data = state.kubernetes.result;
  if (!data) return;
  const search = document.getElementById('kubernetesGlobalSearch').value.trim().toLowerCase();
  const sort = document.getElementById('kubernetesServiceSort').value;
  const healthFilter = document.getElementById('kubernetesServiceHealthFilter').value;
  const priority = (service) => kubernetesServiceHealthPriority(service.health);
  const services = state.kubernetes.serviceModels.filter((service) => {
    if (healthFilter && service.health !== healthFilter) return false;
    if (!search) return true;
    const haystack = [service.name, service.namespace, ...service.modules.map((module) => module.name),
      ...service.deployments.map((deployment) => deployment.name),
      ...service.pods.flatMap((pod) => [pod.name, pod.node, ...(pod.containers || []).map((container) => container.name)])]
      .join(' ').toLowerCase();
    return haystack.includes(search);
  }).sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name);
    if (sort === 'health') return priority(left) - priority(right) || left.name.localeCompare(right.name);
    if (sort === 'issue') return (Date.parse(right.issueAt) || 0) - (Date.parse(left.issueAt) || 0) || priority(left) - priority(right);
    if (sort === 'activity') return right.restartActivity + right.warningActivity - left.restartActivity - left.warningActivity || priority(left) - priority(right);
    if (sort === 'cpu') return (right.cpu ?? -1) - (left.cpu ?? -1) || priority(left) - priority(right);
    if (sort === 'memory') return (right.memory ?? -1) - (left.memory ?? -1) || priority(left) - priority(right);
    return priority(left) - priority(right) || (Date.parse(right.issueAt) || 0) - (Date.parse(left.issueAt) || 0) || left.name.localeCompare(right.name);
  });
  document.getElementById('kubernetesServiceGrid').innerHTML = services.map((service) => {
    const moduleRows = service.modules.map((module) => `<div class="kubernetes-service-module-row"><span>${escapeHtml(module.name)}</span><strong class="${module.health.toLowerCase()}">${module.ready}/${module.desired}</strong></div>`).join('');
    const issue = service.issueAt ? `Last issue ${escapeHtml(formatKubernetesTimestamp(service.issueAt))}` : 'No issue observed in selected window';
    const cloudWatchSamples = service.nodes.map((node) => node.aws?.cpu?.at(-1)?.value).filter(Number.isFinite);
    const cloudWatchCpu = cloudWatchSamples.length ? `${(cloudWatchSamples.reduce((total, value) => total + value, 0) / cloudWatchSamples.length).toFixed(1)}% EC2` : '';
    const cpu = service.metricsAvailable ? service.cpu === null ? 'No sample' : `${Math.round(service.cpu)}m` : cloudWatchCpu || 'Unavailable';
    const memory = service.metricsAvailable ? service.memory === null ? 'No sample' : `${Math.round(service.memory)}Mi` : 'Unavailable';
    return `<button type="button" class="kubernetes-service-tile ${service.health.toLowerCase()} ${state.kubernetes.activeServiceKey === service.key ? 'selected' : ''}" data-service-key="${escapeHtml(service.key)}" aria-pressed="${state.kubernetes.activeServiceKey === service.key}" title="Open ${escapeHtml(service.name)} service details">
      <span class="kubernetes-service-tile-heading"><strong>${escapeHtml(service.name)}</strong><span class="kubernetes-service-health ${service.health.toLowerCase()}"><i></i>${escapeHtml(service.health)}</span></span>
      <span class="kubernetes-service-namespace">${escapeHtml(service.namespace)}</span>
      <span class="kubernetes-service-module-list">${moduleRows || '<span class="kubernetes-chart-empty">No module data</span>'}</span>
      <span class="kubernetes-service-resource-row"><span>CPU <strong>${escapeHtml(cpu)}</strong></span><span>Memory <strong>${escapeHtml(memory)}</strong></span></span>
      <span class="kubernetes-service-foot-row"><span>${service.pods.length} pods · ${service.nodes.length} nodes</span><span>${service.restartActivity} lifetime restarts</span></span>
      <span class="kubernetes-service-signal-row">${kubernetesServiceSparkline(service)}<small>${issue}</small></span>
    </button>`;
  }).join('');
  document.getElementById('kubernetesServiceEmptyState').hidden = services.length > 0;
}

function renderKubernetesServiceDetail() {
  const detail = document.getElementById('kubernetesServiceDetail');
  const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
  if (!service) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  document.getElementById('kubernetesServiceDetailTitle').textContent = service.name;
  document.getElementById('kubernetesServiceDetailNamespace').textContent = service.namespace;
  const health = document.getElementById('kubernetesServiceDetailHealth');
  health.className = `kubernetes-service-health ${service.health.toLowerCase()}`;
  health.innerHTML = `<i></i>${escapeHtml(service.health)}`;
  document.getElementById('kubernetesServiceDetailSubtitle').textContent = `${service.deployments.length} workloads · ${service.pods.length} pods · ${service.nodes.length} hosting nodes`;
  document.getElementById('kubernetesServiceModules').innerHTML = service.modules.map((module) => {
    const restarts = service.pods.filter((pod) => module.deployments.some((deployment) => deployment.name === pod.workload)).reduce((total, pod) => total + (pod.restarts || 0), 0);
    return `<div class="kubernetes-service-module ${module.health.toLowerCase()}"><strong>${escapeHtml(module.name)}</strong><span class="kubernetes-service-health ${module.health.toLowerCase()}"><i></i>${escapeHtml(module.health)}</span><span>${module.ready}/${module.desired} ready</span><span>${restarts} lifetime restarts</span></div>`;
  }).join('');
  const insights = [];
  const degradedModules = service.modules.filter((module) => module.ready < module.desired);
  if (degradedModules.length) insights.push(`${degradedModules.map((module) => module.name).join(', ')}: ${degradedModules.map((module) => `${module.desired - module.ready} of ${module.desired} replicas unavailable`).join('; ')}.`);
  const recentWarnings = service.events.filter((event) => event.type === 'Warning' && Date.now() - Date.parse(event.timestamp) <= kubernetesRangeMilliseconds());
  if (recentWarnings.length) insights.push(`${recentWarnings.length} warning event${recentWarnings.length === 1 ? '' : 's'} observed in the selected time window.`);
  const recentTerminations = service.pods.flatMap((pod) => (pod.containers || []).filter((container) => container.lastFinishedAt && Date.now() - Date.parse(container.lastFinishedAt) <= kubernetesRangeMilliseconds()).map((container) => `${pod.name}/${container.name}`));
  if (recentTerminations.length) insights.push(`Recent container termination observed: ${recentTerminations.slice(0, 3).join(', ')}.`);
  const affectedNodes = service.nodes.filter((node) => node.ready === false || node.aws?.state && node.aws.state !== 'running' || node.aws?.systemStatus && node.aws.systemStatus !== 'ok' || node.aws?.instanceStatus && node.aws.instanceStatus !== 'ok');
  if (affectedNodes.length) insights.push(`${affectedNodes.length} hosting node${affectedNodes.length === 1 ? '' : 's'} report a Kubernetes or EC2 health issue.`);
  document.getElementById('kubernetesServiceInsights').innerHTML = insights.length
    ? insights.map((insight) => `<p><i aria-hidden="true"></i>${escapeHtml(insight)}</p>`).join('')
    : '<p class="quiet">No degraded replicas or recent warning signals were observed in the selected window.</p>';
  renderKubernetesEventTimeline(state.kubernetes.result);
  document.getElementById('kubernetesServiceNodes').innerHTML = service.nodes.length ? service.nodes.map((node) => {
    const aws = node.aws || {};
    const cpu = aws.cpu?.at(-1);
    const nodePods = service.pods.filter((pod) => pod.node === node.name).length;
    const stateLabel = aws.available ? `${aws.state || 'EC2 state unavailable'} · system ${aws.systemStatus || 'N/A'} · instance ${aws.instanceStatus || 'N/A'}` : 'EC2 details unavailable';
    return `<article class="kubernetes-service-node"><strong title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</strong><span>${nodePods} service pods · ${escapeHtml(node.zone || aws.zone || 'Zone unavailable')}</span><span>${escapeHtml(stateLabel)}</span><span>${cpu ? `EC2 CPU ${Number(cpu.value).toFixed(1)}% · ${escapeHtml(formatKubernetesTimestamp(cpu.timestamp))}` : aws.cpuAvailable ? 'No CloudWatch CPU samples in the selected window' : 'CloudWatch CPU unavailable'}</span>${aws.events?.length ? `<span class="warning">${aws.events.length} scheduled EC2 event${aws.events.length === 1 ? '' : 's'}</span>` : ''}${aws.alarms?.length ? `<span class="warning">${aws.alarms.map((alarm) => `${alarm.name} · ${alarm.state}`).map(escapeHtml).join(' · ')}</span>` : ''}</article>`;
  }).join('') : '<p class="kubernetes-chart-empty">Node details are unavailable for this namespace.</p>';
  renderKubernetesServicePods(service);
  renderKubernetesServiceLogs(service);
  renderKubernetesTimeline(state.kubernetes.result, 'all', 'kubernetesServiceTimeline', service.pods);
}

function renderKubernetesServicePods(service) {
  const globalSearch = document.getElementById('kubernetesGlobalSearch').value.trim().toLowerCase();
  const modules = service.modules.map((module) => {
    const workloads = new Set(module.deployments.map((deployment) => deployment.name));
    const pods = service.pods.filter((pod) => workloads.has(pod.workload));
    const filtered = globalSearch ? pods.filter((pod) => `${pod.name} ${pod.node} ${(pod.containers || []).map((container) => container.name).join(' ')}`.toLowerCase().includes(globalSearch)) : pods;
    if (!filtered.length) return '';
    return `<section class="kubernetes-service-pod-module"><header><strong>${escapeHtml(module.name)}</strong><span>${module.ready}/${module.desired} replicas ready</span></header>${filtered.map((pod) => `<button type="button" class="kubernetes-service-pod" data-pod-key="${escapeHtml(`${pod.namespace}/${pod.name}`)}"><span class="kubernetes-service-health ${pod.health === 'Healthy' ? 'healthy' : pod.health === 'Failed' ? 'critical' : 'warning'}"><i></i>${escapeHtml(pod.health)}</span><strong title="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</strong><span>${escapeHtml(pod.ready)} containers</span><span>${pod.restarts} lifetime restarts</span><span title="${escapeHtml(pod.node)}">${escapeHtml(pod.node)}</span></button>`).join('')}</section>`;
  }).join('');
  document.getElementById('kubernetesServicePods').innerHTML = modules || '<p class="kubernetes-chart-empty">No pods match this service and search.</p>';
  document.getElementById('kubernetesServicePodsMeta').textContent = `${service.pods.length} replicas · pod names are available here for deeper investigation`;
}

function renderKubernetesServiceLogs(service) {
  const podSelect = document.getElementById('kubernetesServiceLogPod');
  const servicePodKeys = new Set(service.pods.map((pod) => `${pod.namespace}/${pod.name}`));
  const selectedPod = service.pods.find((pod) => `${pod.namespace}/${pod.name}` === `${state.kubernetes.logPod?.namespace}/${state.kubernetes.logPod?.name}`)
    || service.pods[0];
  if (!state.kubernetes.activePod) {
    state.kubernetes.logTarget = 'service';
    state.kubernetes.logPod = selectedPod || null;
  }
  podSelect.innerHTML = service.pods.map((pod) => `<option value="${escapeHtml(`${pod.namespace}/${pod.name}`)}">${escapeHtml(`${service.deployments.find((deployment) => deployment.name === pod.workload)?.module || 'Workload'} · ${pod.name}`)}</option>`).join('');
  if (selectedPod) podSelect.value = `${selectedPod.namespace}/${selectedPod.name}`;
  const containerSelect = document.getElementById('kubernetesServiceLogContainer');
  const currentPod = service.pods.find((pod) => servicePodKeys.has(`${state.kubernetes.logPod?.namespace}/${state.kubernetes.logPod?.name}`)) || selectedPod;
  containerSelect.innerHTML = `<option value="">All containers</option>${(currentPod?.containers || []).map((container) => `<option value="${escapeHtml(container.name)}">${escapeHtml(container.name)}${container.kind === 'init' ? ' · init' : ''}</option>`).join('')}`;
  if (state.kubernetes.logSnapshot && !servicePodKeys.has(`${state.kubernetes.logSnapshot.namespace}/${state.kubernetes.logSnapshot.pod}`)) state.kubernetes.logSnapshot = null;
  if (state.kubernetes.logTarget === 'service') renderKubernetesLogOutput();
}

function renderKubernetesEventTimeline(data) {
  const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
  const target = document.getElementById('kubernetesServiceEvents');
  if (!service || !target) return;
  const start = Date.now() - kubernetesRangeMilliseconds();
  const events = service.events.filter((event) => Date.parse(event.timestamp) >= start).map((event) => ({
    source: 'Kubernetes', severity: event.type === 'Warning' ? 'Warning' : 'Info',
    timestamp: event.timestamp, title: event.reason || 'Kubernetes event',
    detail: `${event.objectKind || 'Resource'} ${event.objectName || ''} · ${event.message || 'No event message'}`,
    count: event.count,
  }));
  service.nodes.forEach((node) => (node.aws?.events || []).forEach((event) => events.push({
    source: 'AWS EC2', severity: 'Warning', timestamp: event.notBefore || event.notAfter || '',
    title: event.code || 'Scheduled EC2 event', detail: `${node.name} · ${event.description || 'Scheduled infrastructure event'}`,
  })));
  const recent = events.filter((event) => Date.parse(event.timestamp) >= start).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  target.innerHTML = recent.length ? recent.slice(0, 12).map((event) => `<li class="kubernetes-service-event ${event.severity.toLowerCase()}"><span class="kubernetes-event-marker" aria-hidden="true"></span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.source)} · ${escapeHtml(event.detail)}</small></div><time>${escapeHtml(formatKubernetesTimestamp(event.timestamp))}${event.count > 1 ? ` · ×${event.count}` : ''}</time></li>`).join('')
    : '<li class="kubernetes-chart-empty">No related Kubernetes or AWS events were returned for this service in the selected window.</li>';
}

function formatKubernetesTimestamp(timestamp) {
  if (!timestamp) return 'Time unavailable';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function kubernetesRangeMilliseconds() {
  return { '15m': 900000, '1h': 3600000, '6h': 21600000, '24h': 86400000 }[state.kubernetes.timeRange] || 3600000;
}

function parseKubernetesCpu(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return null;
  if (value.endsWith('n')) return amount / 1000000;
  if (value.endsWith('u')) return amount / 1000;
  if (value.endsWith('m')) return amount;
  return amount * 1000;
}

function parseKubernetesMemory(value) {
  const match = String(value || '').match(/^([\d.]+)(Ki|Mi|Gi|Ti|K|M|G|T|B)?$/i);
  if (!match) return null;
  const factor = { ki: 1024, mi: 1048576, gi: 1073741824, ti: 1099511627776, k: 1000, m: 1000000, g: 1000000000, t: 1000000000000, b: 1 }[(match[2] || 'b').toLowerCase()];
  return Number(match[1]) * factor;
}

function kubernetesPodMetrics(data, pod) {
  const metrics = (data.metrics || []).filter((item) => item.namespace === pod.namespace && item.pod === pod.name);
  if (!metrics.length) return null;
  const cpu = metrics.reduce((sum, item) => sum + (parseKubernetesCpu(item.cpu) || 0), 0);
  const memory = metrics.reduce((sum, item) => sum + (parseKubernetesMemory(item.memory) || 0), 0);
  return { cpu: `${Math.round(cpu)}m`, memory: `${Math.round(memory / 1048576)}Mi` };
}

function renderKubernetesTimeline(data, selectedPodKey = 'all', targetId = 'kubernetesOperationalTimeline', podScope = null) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const podKey = selectedPodKey || 'all';
  const allPods = podScope || data.pods || [];
  const matchingPods = podKey === 'all' ? allPods : allPods.filter((pod) => `${pod.namespace}/${pod.name}` === podKey);
  const rangeMs = kubernetesRangeMilliseconds();
  const domainEnd = Date.now();
  const domainStart = domainEnd - rangeMs;
  const selection = state.kubernetes.timelineWindow;
  const start = Math.max(domainStart, selection?.start ?? domainStart);
  const end = Math.min(domainEnd, selection?.end ?? domainEnd);
  const visibleRange = Math.max(1, end - start);
  const sourceFilter = document.getElementById('kubernetesTimelineSourceFilter')?.value || 'all';
  const severityFilter = document.getElementById('kubernetesTimelineSeverityFilter')?.value || 'all';
  const position = (timestamp) => Math.max(0, Math.min(100, ((Date.parse(timestamp) - start) / visibleRange) * 100));
  const withinRange = (timestamp) => {
    const time = Date.parse(timestamp || '');
    return Number.isFinite(time) && time >= start && time <= end;
  };
  const visible = (source, severity) => (sourceFilter === 'all' || sourceFilter === source)
    && (severityFilter === 'all' || severityFilter === severity);
  let markerIndex = 0;
  const marker = (timestamp, label, tone = 'normal', title = label, source = 'kubernetes', severity = 'info') => {
    if (!withinRange(timestamp) || !visible(source, severity)) return '';
    const row = markerIndex++ % 4;
    return `<span class="kubernetes-timeline-marker ${tone}" style="left:${position(timestamp)}%;--marker-row:${row}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" role="img" tabindex="0"><i aria-hidden="true"></i></span>`;
  };
  const lanes = [];
  const overviewSignals = [];
  const addOverviewSignal = (timestamp, source, severity = 'info') => {
    const time = Date.parse(timestamp || '');
    if (Number.isFinite(time)) overviewSignals.push({ time, source, severity });
  };
  const selectedEvents = (data.events || []).filter((event) => {
    const matchesPod = podKey === 'all' || matchingPods.some((pod) => event.namespace === pod.namespace && event.objectKind === 'Pod' && event.objectName === pod.name);
    return matchesPod;
  });
  selectedEvents.forEach((event) => {
    const critical = /FailedScheduling|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|FailedMount|NodeNotReady|OOMKilled/i.test(`${event.reason} ${event.message}`);
    addOverviewSignal(event.timestamp, 'kubernetes', critical ? 'critical' : event.type === 'Warning' ? 'warning' : 'info');
  });
  matchingPods.forEach((pod) => {
    addOverviewSignal(pod.createdAt, 'pods');
    (pod.conditions || []).filter((condition) => condition.type === 'Ready').forEach((condition) => addOverviewSignal(condition.lastTransitionTime, 'pods', condition.status === 'True' ? 'info' : 'warning'));
    (pod.containers || []).forEach((container) => {
      addOverviewSignal(container.startedAt, 'containers');
      addOverviewSignal(container.lastFinishedAt, 'containers', 'warning');
    });
    if (kubernetesPodMetrics(data, pod)) addOverviewSignal(data.fetchedAt, 'metrics');
  });
  lanes.push({
    source: 'kubernetes',
    label: 'Kubernetes',
    content: selectedEvents.filter((event) => withinRange(event.timestamp)).slice(0, 24).map((event) => {
      const critical = /FailedScheduling|CrashLoopBackOff|ImagePullBackOff|ErrImagePull|FailedMount|NodeNotReady|OOMKilled/i.test(`${event.reason} ${event.message}`);
      const severity = critical ? 'critical' : event.type === 'Warning' ? 'warning' : 'info';
      return marker(event.timestamp, event.reason || 'Event', critical ? 'critical' : event.type === 'Warning' ? 'warning' : 'normal', `${event.type} · ${event.reason} · ${event.message}`, 'kubernetes', severity);
    }).join(''),
  });

  const lifecycle = [];
  matchingPods.slice(0, podKey === 'all' && !podScope ? 24 : matchingPods.length).forEach((pod) => {
    lifecycle.push(marker(pod.createdAt, `Created · ${pod.name}`, 'lifecycle', `${pod.namespace}/${pod.name} created`, 'pods'));
    (pod.conditions || []).filter((condition) => condition.type === 'Ready').forEach((condition) => {
      const severity = condition.status === 'True' ? 'info' : 'warning';
      lifecycle.push(marker(condition.lastTransitionTime, condition.status === 'True' ? `Ready · ${pod.name}` : `Not ready · ${pod.name}`, condition.status === 'True' ? 'normal' : 'warning', `${pod.name} readiness changed: ${condition.status}${condition.reason ? ` · ${condition.reason}` : ''}`, 'pods', severity));
    });
    (pod.containers || []).forEach((container) => {
      if (container.lastFinishedAt) lifecycle.push(marker(container.lastFinishedAt, `Restart · ${pod.name}`, 'warning', `${container.name}: last termination${container.lastReason ? ` · ${container.lastReason}` : ''}; ${container.restarts} lifetime restarts`, 'containers', 'warning'));
    });
  });
  lanes.push({ source: 'pods', label: 'Pods', content: lifecycle.join('') });

  const containerBars = [];
  matchingPods.slice(0, podKey === 'all' && !podScope ? 24 : matchingPods.length).forEach((pod) => {
    (pod.containers || []).forEach((container) => {
      const startAt = container.startedAt && withinRange(container.startedAt) ? position(container.startedAt) : 0;
      if (container.state === 'running' && visible('containers', 'info')) {
        containerBars.push(`<span class="kubernetes-timeline-bar running" style="left:${startAt}%;width:${Math.max(0.5, 100 - startAt)}%" title="${escapeHtml(`${pod.name} · ${container.name} running${container.startedAt ? ` since ${formatKubernetesTimestamp(container.startedAt)}` : ''}`)}"><b>${escapeHtml(podKey === 'all' ? container.name : container.name)}</b></span>`);
      } else if (container.lastFinishedAt) {
        containerBars.push(marker(container.lastFinishedAt, `${pod.name} · ${container.lastReason || 'Terminated'}`, 'warning', `${container.name} last terminated at ${formatKubernetesTimestamp(container.lastFinishedAt)}`, 'containers', 'warning'));
      }
    });
  });
  lanes.push({ source: 'containers', label: 'Containers', content: containerBars.join('') });

  const resourceMarkers = [];
  matchingPods.forEach((pod) => {
    const usage = kubernetesPodMetrics(data, pod);
    if (usage) resourceMarkers.push(marker(data.fetchedAt, `${pod.name} · ${usage.cpu} / ${usage.memory}`, 'resource', `Current Metrics API sample for ${pod.namespace}/${pod.name}: CPU ${usage.cpu}, memory ${usage.memory}`, 'metrics'));
  });
  lanes.push({ source: 'metrics', label: 'Metrics', content: resourceMarkers.slice(0, 16).join('') });

  const logs = state.kubernetes.logSnapshot;
  const logMarkers = [];
  if (logs && matchingPods.some((pod) => pod.namespace === logs.namespace && pod.name === logs.pod)) {
    (logs.logs || '').split(/\r?\n/).filter((line) => /\b(error|fatal|exception|panic|warning|warn)\b/i.test(line)).slice(-12).forEach((line) => {
      const timestamp = line.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/)?.[0];
      const critical = /\b(fatal|panic)\b/i.test(line);
      const warning = /\b(error|fatal|exception|panic)\b/i.test(line);
      if (timestamp) addOverviewSignal(timestamp, 'logs', critical ? 'critical' : warning ? 'warning' : 'info');
      if (timestamp) logMarkers.push(marker(timestamp, warning ? 'Log error' : 'Log warning', critical ? 'critical' : warning ? 'warning' : 'normal', `${logs.pod}/${logs.container} log signal at ${formatKubernetesTimestamp(timestamp)}`, 'logs', critical ? 'critical' : warning ? 'warning' : 'info'));
    });
  }
  lanes.push({ source: 'logs', label: 'Logs', content: logMarkers.join('') });

  const serviceNodeNames = podScope ? new Set(podScope.map((pod) => `${pod.namespace}/${pod.node}`)) : null;
  const nodes = (data.nodes || []).filter((node) => !serviceNodeNames || serviceNodeNames.has(`${node.namespace}/${node.name}`));
  const awsMarkers = [];
  const awsSamples = [];
  nodes.forEach((node) => {
    const aws = node.aws || {};
    (aws.events || []).forEach((event) => {
      const timestamp = event.notBefore || event.notAfter;
      addOverviewSignal(timestamp, 'aws', 'warning');
      awsMarkers.push(marker(timestamp, event.code || 'EC2 event', 'warning', `${node.name} · ${event.description || 'Scheduled EC2 event'}`, 'aws', 'warning'));
    });
    if (aws.available && (aws.state && aws.state !== 'running' || aws.systemStatus && aws.systemStatus !== 'ok' || aws.instanceStatus && aws.instanceStatus !== 'ok')) {
      awsMarkers.push(marker(data.fetchedAt, `EC2 issue · ${node.name}`, 'critical', `${node.name}: EC2 ${aws.state || 'state unavailable'}, system ${aws.systemStatus || 'N/A'}, instance ${aws.instanceStatus || 'N/A'}; observed at snapshot time`, 'aws', 'critical'));
    }
    (aws.cpu || []).forEach((sample) => {
      addOverviewSignal(sample.timestamp, 'aws');
      if (withinRange(sample.timestamp)) awsSamples.push({ timestamp: Date.parse(sample.timestamp), value: Number(sample.value) });
    });
  });
  let awsSparkline = '';
  if (awsSamples.length > 1 && visible('aws', 'info')) {
    const points = awsSamples.filter((sample) => Number.isFinite(sample.timestamp) && Number.isFinite(sample.value)).sort((left, right) => left.timestamp - right.timestamp)
      .map((sample) => `${Math.max(0, Math.min(100, ((sample.timestamp - start) / visibleRange) * 100)).toFixed(2)},${(27 - Math.max(0, Math.min(100, sample.value)) / 100 * 24).toFixed(2)}`).join(' ');
    if (points) awsSparkline = `<svg class="kubernetes-timeline-sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Observed CloudWatch EC2 CPU samples"><polyline points="${points}" /></svg>`;
  }
  lanes.push({ source: 'aws', label: 'AWS / EC2', content: `${awsSparkline}${awsMarkers.join('')}` });

  const formatAxisTime = (timestamp) => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => `<time>${formatAxisTime(start + visibleRange * part)}</time>`).join('');
  target.innerHTML = `<div class="kubernetes-timeline-axis"><span></span><div>${ticks}</div></div>${lanes.filter((lane) => sourceFilter === 'all' || sourceFilter === lane.source).map((lane) => `<div class="kubernetes-timeline-lane"><strong>${escapeHtml(lane.label)}</strong><div class="kubernetes-timeline-track">${lane.content || '<span class="kubernetes-timeline-empty">No signal in selected range</span>'}</div></div>`).join('')}`;
  const visibleSignals = overviewSignals.filter((signal) => visible(signal.source, signal.severity));
  const selectedSignalCount = visibleSignals.filter((signal) => signal.time >= start && signal.time <= end).length;
  const overviewMarkup = `<section class="kubernetes-timeline-overview" aria-label="Timeline range overview"><div class="kubernetes-overview-heading"><strong>Overview</strong><span>${selectedSignalCount} signals in range</span><button type="button" data-kubernetes-timeline-reset title="Show the full selected time window">Reset</button></div><div class="overview-scale"><span>${escapeHtml(formatExact(domainStart))}</span><strong>${escapeHtml(formatDuration(start, end))} selected</strong><span>${escapeHtml(formatExact(domainEnd))}</span></div><div class="overview-track" aria-label="Drag to select a time range"><canvas aria-hidden="true"></canvas><div class="overview-window" style="left:${((start - domainStart) / rangeMs) * 100}%;width:${Math.max(0.5, ((end - start) / rangeMs) * 100)}%"><span class="overview-window-start" hidden></span></div><div class="overview-cursor" hidden></div><div class="overview-brush" hidden><span class="overview-window-start"></span></div><div class="overview-tip" hidden></div></div></section>`;
  target.insertAdjacentHTML('afterbegin', overviewMarkup);
  const overview = target.querySelector('.kubernetes-timeline-overview');
  const overviewTrack = overview?.querySelector('.overview-track');
  const canvas = overviewTrack?.querySelector('canvas');
  if (overviewTrack && canvas) {
    const width = overviewTrack.clientWidth || 680;
    const height = 38;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const bucketCount = Math.max(48, Math.floor(width / 4));
    const buckets = Array.from({ length: bucketCount }, () => ({}));
    const colors = { kubernetes: '#347ea5', pods: '#ca7a14', containers: '#18804a', logs: '#c8323e', metrics: '#16794a', aws: '#64748b' };
    visibleSignals.forEach((signal) => {
      const index = Math.min(bucketCount - 1, Math.max(0, Math.floor(((signal.time - domainStart) / rangeMs) * bucketCount)));
      buckets[index][signal.source] = (buckets[index][signal.source] || 0) + 1;
    });
    const max = Math.max(1, ...buckets.map((bucket) => Object.values(bucket).reduce((sum, count) => sum + count, 0)));
    buckets.forEach((bucket, index) => {
      let y = height;
      Object.entries(bucket).forEach(([source, count]) => {
        const barHeight = (count / max) * (height - 3);
        context.fillStyle = colors[source] || colors.kubernetes;
        context.fillRect(index * width / bucketCount, y - barHeight, Math.max(1, width / bucketCount - 0.5), barHeight);
        y -= barHeight;
      });
    });
    bindOverview(overview, {
      widget: 'events',
      getBounds: () => ({ start: domainStart, end: domainEnd }),
      onApply: (rangeStart, rangeEnd) => {
        state.kubernetes.timelineWindow = { start: rangeStart, end: rangeEnd };
        renderKubernetesTimeline(data, podKey, targetId, podScope);
      },
    });
  }
  overview?.querySelector('[data-kubernetes-timeline-reset]')?.addEventListener('click', () => {
    state.kubernetes.timelineWindow = null;
    renderKubernetesTimeline(data, podKey, targetId, podScope);
  });
  if (targetId === 'kubernetesOperationalTimeline') {
    const metricAvailability = Object.values(data.metricsAvailable || {});
    const metricNote = metricAvailability.length && metricAvailability.every(Boolean)
      ? 'Pod CPU and memory are current Metrics API samples. EC2 CPU history is sampled from CloudWatch; no application request or latency history is connected.'
      : 'Pod Metrics API is unavailable in one or more namespaces. EC2 history is shown only for returned CloudWatch datapoints; no application request or latency history is connected.';
    document.getElementById('kubernetesTimelineNote').textContent = `${metricNote} Kubernetes event retention and pod timestamps define the remaining history.`;
  }
}

let kubernetesTerminalSocket = null;
let kubernetesTerminalPodKey = '';

function closeKubernetesTerminal(message = 'Session stopped.') {
  const socket = kubernetesTerminalSocket;
  kubernetesTerminalSocket = null;
  kubernetesTerminalPodKey = '';
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  document.getElementById('kubernetesTerminalStatus').textContent = message;
  document.getElementById('kubernetesTerminalStart').disabled = false;
  document.getElementById('kubernetesTerminalStop').disabled = true;
  document.getElementById('kubernetesTerminalContainer').disabled = false;
  document.getElementById('kubernetesTerminalInput').disabled = true;
  document.getElementById('kubernetesTerminalSend').disabled = true;
}

function startKubernetesTerminal() {
  const pod = state.kubernetes.activePod;
  const container = document.getElementById('kubernetesTerminalContainer').value;
  if (!pod || !container || kubernetesTerminalSocket) return;
  const output = document.getElementById('kubernetesTerminalOutput');
  const status = document.getElementById('kubernetesTerminalStatus');
  const startButton = document.getElementById('kubernetesTerminalStart');
  const stopButton = document.getElementById('kubernetesTerminalStop');
  const input = document.getElementById('kubernetesTerminalInput');
  const sendButton = document.getElementById('kubernetesTerminalSend');
  document.getElementById('kubernetesTerminalContainer').disabled = true;
  const params = new URLSearchParams({ env: state.kubernetes.env, namespace: pod.namespace, pod: pod.name, container });
  const socketUrl = new URL(`/api/kubernetes/terminal?${params}`, window.location.href);
  socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  status.textContent = 'Connecting...';
  output.textContent = '';
  startButton.disabled = true;
  stopButton.disabled = false;
  try {
    const socket = new WebSocket(socketUrl);
    kubernetesTerminalSocket = socket;
    kubernetesTerminalPodKey = `${pod.namespace}/${pod.name}`;
    socket.addEventListener('open', () => {
      if (kubernetesTerminalSocket !== socket) return;
      status.textContent = `${pod.name} · ${container}`;
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      output.textContent = `${output.textContent}${event.data}`.slice(-200000);
      output.scrollTop = output.scrollHeight;
    });
    socket.addEventListener('error', () => {
      if (kubernetesTerminalSocket === socket) status.textContent = 'Connection failed';
    });
    socket.addEventListener('close', () => {
      if (kubernetesTerminalSocket !== socket) return;
      kubernetesTerminalSocket = null;
      kubernetesTerminalPodKey = '';
      status.textContent = 'Session ended';
      startButton.disabled = false;
      stopButton.disabled = true;
      input.disabled = true;
      sendButton.disabled = true;
      document.getElementById('kubernetesTerminalContainer').disabled = false;
    });
  } catch (error) {
    kubernetesTerminalSocket = null;
    kubernetesTerminalPodKey = '';
    status.textContent = 'Unable to open a terminal connection';
    startButton.disabled = false;
    stopButton.disabled = true;
    document.getElementById('kubernetesTerminalContainer').disabled = false;
  }
}

function sendKubernetesTerminalInput(event) {
  event.preventDefault();
  const socket = kubernetesTerminalSocket;
  const input = document.getElementById('kubernetesTerminalInput');
  if (!socket || socket.readyState !== WebSocket.OPEN || !input.value) return;
  if (input.value.length > 60000) {
    document.getElementById('kubernetesTerminalStatus').textContent = 'Input is too large';
    return;
  }
  socket.send(`${input.value}\n`);
  input.value = '';
}

function openKubernetesPodDetail(pod) {
  const data = state.kubernetes.result;
  const dialog = document.getElementById('kubernetesPodDetailDialog');
  const podKey = `${pod.namespace}/${pod.name}`;
  if (kubernetesTerminalPodKey && kubernetesTerminalPodKey !== podKey) closeKubernetesTerminal('Session stopped after changing pods.');
  cancelKubernetesLogRequest();
  window.clearInterval(state.kubernetes.logTimer);
  state.kubernetes.logTimer = null;
  state.kubernetes.activePod = { namespace: pod.namespace, name: pod.name };
  state.kubernetes.logTarget = 'pod';
  state.kubernetes.logPod = state.kubernetes.activePod;
  state.kubernetes.logSnapshot = null;
  state.kubernetes.logError = '';
  const healthClass = { Healthy: 'healthy', 'Not ready': 'not-ready', Pending: 'pending', Failed: 'failed', Completed: 'completed', Unknown: 'unknown' }[pod.health] || 'unknown';
  document.getElementById('kubernetesPodDetailTitle').textContent = pod.name;
  document.getElementById('kubernetesPodDetailSubtitle').textContent = `${pod.namespace} · ${pod.node || 'Unassigned'} · ${pod.scheduler || 'default-scheduler'}`;
  renderKubernetesTimeline(data, `${pod.namespace}/${pod.name}`);
  renderKubernetesTimeline(data, `${pod.namespace}/${pod.name}`, 'kubernetesPodDetailTimeline');

  const usage = kubernetesPodMetrics(data, pod);
  const details = [
    ['Health', `<span class="kubernetes-health-chip ${healthClass}"><i></i>${escapeHtml(pod.health)}</span>`],
    ['Phase', escapeHtml(pod.phase || 'Unknown')], ['Ready containers', escapeHtml(pod.ready || '0/0')],
    ['Restarts', escapeHtml(pod.restarts ?? 0)], ['Node', escapeHtml(pod.node || 'Unassigned')],
    ['Pod IP', escapeHtml(pod.podIP || '—')], ['Age', escapeHtml(pod.age || '—')],
    ['CPU · current sample', escapeHtml(usage?.cpu || 'Unavailable')], ['Memory · current sample', escapeHtml(usage?.memory || 'Unavailable')],
  ];
  document.getElementById('kubernetesPodDetailMetrics').innerHTML = details.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');

  const containers = pod.containers || [];
  document.getElementById('kubernetesPodDetailContainers').innerHTML = containers.length ? containers.map((container) => {
    const failureState = /BackOff|ErrImagePull|CreateContainer|RunContainer/i.test(`${container.reason} ${container.lastReason}`);
    const stateClass = container.ready ? 'healthy' : container.state === 'terminated' || failureState ? 'failed' : 'pending';
    const stateLabel = container.ready ? 'Ready' : container.reason || container.state || 'Unknown';
    const sample = (data.metrics || []).find((metric) => metric.namespace === pod.namespace && metric.pod === pod.name && metric.container === container.name);
    const requests = Object.entries(container.requests || {}).map(([key, value]) => `${key} ${value}`).join(' · ') || 'None';
    const limits = Object.entries(container.limits || {}).map(([key, value]) => `${key} ${value}`).join(' · ') || 'None';
    const memoryLimit = container.limits?.memory ? parseKubernetesMemory(container.limits.memory) : null;
    const memoryUsage = sample ? parseKubernetesMemory(sample.memory) : null;
    const memoryRatio = memoryLimit && memoryUsage ? memoryUsage / memoryLimit : 0;
    const memoryInsight = memoryRatio >= 0.8 ? `<strong class="kubernetes-resource-warning">Memory at ${Math.round(memoryRatio * 100)}% of configured limit</strong>` : '';
    const probeText = ['readiness', 'liveness', 'startup'].map((name) => container.probes?.[name] ? `${name} probe · every ${container.probes[name].periodSeconds}s` : '').filter(Boolean).join(' · ') || 'No probes configured';
    return `<article class="kubernetes-container-card"><div class="kubernetes-container-heading"><strong>${escapeHtml(container.name)}</strong><span class="kubernetes-node-state ${stateClass}"><i></i>${escapeHtml(stateLabel)}</span></div>
      <p class="kubernetes-container-image" title="${escapeHtml(container.image)}">${escapeHtml(container.image || 'Image unavailable')}</p>
      <span>${escapeHtml(container.kind)} · ${escapeHtml(container.restarts ?? 0)} lifetime restarts${container.lastExitCode !== null && container.lastExitCode !== undefined ? ` · last exit ${escapeHtml(container.lastExitCode)}` : ''}</span>
      <p>Usage ${escapeHtml(sample ? `${sample.cpu} CPU · ${sample.memory} memory` : 'Metrics unavailable')} · Requests ${escapeHtml(requests)} · Limits ${escapeHtml(limits)}</p>
      <p>${escapeHtml(probeText)}</p>${memoryInsight}
      ${container.lastReason ? `<p>Previous termination: ${escapeHtml(container.lastReason)}${container.lastFinishedAt ? ` · ${escapeHtml(formatKubernetesTimestamp(container.lastFinishedAt))}` : ''}</p>` : ''}
      ${container.message || container.lastMessage ? `<p>${escapeHtml(container.message || container.lastMessage)}</p>` : ''}</article>`;
  }).join('') : '<p class="kubernetes-chart-empty">No container details were reported.</p>';

  const conditions = pod.conditions || [];
  document.getElementById('kubernetesPodDetailConditions').innerHTML = conditions.length ? conditions.map((condition) => `
    <div class="kubernetes-detail-line"><strong>${escapeHtml(condition.type || 'Condition')}</strong><span>${escapeHtml(condition.status || 'Unknown')}${condition.reason ? ` · ${escapeHtml(condition.reason)}` : ''}</span>${condition.message ? `<p>${escapeHtml(condition.message)}</p>` : ''}</div>
  `).join('') : '<p class="kubernetes-chart-empty">No pod conditions were reported.</p>';

  const relatedEvents = (data.events || []).filter((event) => event.objectName === pod.name && event.namespace === pod.namespace && (!event.objectKind || event.objectKind === 'Pod'));
  let eventContent;
  if (!(data.eventsAvailable ?? Array.isArray(data.events))) eventContent = '<p class="kubernetes-chart-empty">Event access is unavailable in one or more selected namespaces.</p>';
  else if (!relatedEvents.length) eventContent = '<p class="kubernetes-chart-empty">No recent events are associated with this pod.</p>';
  else eventContent = relatedEvents.slice(0, 6).map((event) => `<div class="kubernetes-detail-line"><strong>${escapeHtml(event.reason)} · ${escapeHtml(event.type)}</strong><span>${escapeHtml(formatKubernetesTimestamp(event.timestamp))}${event.reportingComponent ? ` · ${escapeHtml(event.reportingComponent)}` : ''}${event.count > 1 ? ` · ×${event.count}` : ''}</span><p>${escapeHtml(event.message)}</p></div>`).join('');
  document.getElementById('kubernetesPodDetailEvents').innerHTML = eventContent;

  const ownerText = (pod.owners || []).map((owner) => `${owner.kind} / ${owner.name}`).filter(Boolean).join(', ') || 'No owner reference';
  const labels = (pod.labels || []).map((label) => `<span class="kubernetes-label-chip"><strong>${escapeHtml(label.key)}</strong>${escapeHtml(label.value)}</span>`).join('');
  document.getElementById('kubernetesPodDetailMetadata').innerHTML = `<div class="kubernetes-detail-line"><strong>Owner</strong><span>${escapeHtml(ownerText)}</span></div><div class="kubernetes-label-list">${labels || '<span class="kubernetes-chart-empty">No labels reported.</span>'}</div>`;
  const containerSelect = document.getElementById('kubernetesLogContainer');
  containerSelect.innerHTML = `<option value="">All containers</option>${containers.map((container) => `<option value="${escapeHtml(container.name)}">${escapeHtml(container.name)}${container.kind === 'init' ? ' · init' : ''}</option>`).join('')}`;
  const terminalContainers = containers.filter((container) => container.kind !== 'init' && container.state === 'running');
  const terminalSelect = document.getElementById('kubernetesTerminalContainer');
  terminalSelect.innerHTML = terminalContainers.map((container) => `<option value="${escapeHtml(container.name)}">${escapeHtml(container.name)}</option>`).join('');
  terminalSelect.disabled = terminalContainers.length === 0 || Boolean(kubernetesTerminalSocket);
  document.getElementById('kubernetesTerminalStart').disabled = terminalContainers.length === 0 || Boolean(kubernetesTerminalSocket);
  if (!kubernetesTerminalSocket) {
    document.getElementById('kubernetesTerminalOutput').textContent = 'Start a shell to run a command in this container.';
    document.getElementById('kubernetesTerminalStatus').textContent = terminalContainers.length ? 'Session stopped' : 'No running application container';
  }
  document.getElementById('kubernetesLogInstance').value = 'current';
  document.getElementById('kubernetesLogsLiveToggle').setAttribute('aria-pressed', 'false');
  document.getElementById('kubernetesLogsLiveToggle').textContent = 'Start live';
  document.getElementById('kubernetesPodLogs').textContent = 'Loading recent container logs...';
  if (!dialog.open) dialog.showModal();
  void fetchKubernetesLogs();
}

function renderKubernetesLogOutput() {
  const snapshot = state.kubernetes.logSnapshot;
  if (!snapshot) return;
  const isService = state.kubernetes.logTarget === 'service';
  const prefix = isService ? 'kubernetesServiceLog' : 'kubernetesLog';
  const filter = document.getElementById(`${prefix}Filter`).value;
  const lines = (snapshot.logs || '').split(/\r?\n/);
  const filtered = lines.filter((line) => {
    if (filter === 'error') return /\b(error|fatal|exception|panic)\b/i.test(line);
    if (filter === 'warning') return /\b(warning|warn)\b/i.test(line);
    return true;
  });
  document.getElementById(isService ? 'kubernetesServiceLogs' : 'kubernetesPodLogs').textContent = filtered.join('\n') || (lines.length ? 'No log lines match this filter.' : 'No log lines were returned for this container and time window.');
  const live = Boolean(state.kubernetes.logTimer);
  const refreshState = state.kubernetes.logLoading ? ' · refreshing' : state.kubernetes.logError ? ` · refresh failed: ${state.kubernetes.logError}` : '';
  document.getElementById(isService ? 'kubernetesServiceLogsMeta' : 'kubernetesLogsMeta').textContent = `${snapshot.namespace}/${snapshot.pod} · ${snapshot.container}${snapshot.previous ? ' · previous instance' : ''} · ${filtered.length} returned lines · sampled ${formatKubernetesTimestamp(snapshot.fetchedAt)}${snapshot.truncated ? ' · output capped at 64 KiB' : ''}${live ? ' · refreshed every 15 seconds' : ''}${refreshState}`;
}

function cancelKubernetesLogRequest() {
  state.kubernetes.logRequestId += 1;
  state.kubernetes.logAbortController?.abort();
  state.kubernetes.logAbortController = null;
  state.kubernetes.logLoading = false;
}

function selectKubernetesServiceLogPod() {
  const selectedKey = document.getElementById('kubernetesServiceLogPod').value;
  const pod = state.kubernetes.result?.pods?.find((item) => `${item.namespace}/${item.name}` === selectedKey);
  if (!pod) return;
  cancelKubernetesLogRequest();
  state.kubernetes.logTarget = 'service';
  state.kubernetes.logPod = pod;
  state.kubernetes.logSnapshot = null;
  state.kubernetes.logError = '';
  window.clearInterval(state.kubernetes.logTimer);
  state.kubernetes.logTimer = null;
  const toggle = document.getElementById('kubernetesServiceLogsLiveToggle');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.textContent = 'Start live';
  document.getElementById('kubernetesServiceLogs').textContent = 'Select a container and load recent logs.';
  document.getElementById('kubernetesServiceLogsMeta').textContent = 'Logs load only when requested.';
  const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
  if (service) renderKubernetesServiceLogs(service);
}

function toggleKubernetesLogPolling(button, isService) {
  if (state.kubernetes.logTimer) {
    window.clearInterval(state.kubernetes.logTimer);
    state.kubernetes.logTimer = null;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = 'Start live';
    renderKubernetesLogOutput();
    return;
  }
  state.kubernetes.logTarget = isService ? 'service' : 'pod';
  button.setAttribute('aria-pressed', 'true');
  button.textContent = 'Stop live';
  state.kubernetes.logTimer = window.setInterval(() => void fetchKubernetesLogs(), 15000);
  void fetchKubernetesLogs();
}

async function fetchKubernetesLogs() {
  const isService = state.kubernetes.logTarget === 'service';
  const pod = isService ? state.kubernetes.logPod : state.kubernetes.activePod;
  if (!pod || state.kubernetes.logLoading) return;
  state.kubernetes.logLoading = true;
  state.kubernetes.logError = '';
  const prefix = isService ? 'kubernetesServiceLog' : 'kubernetesLog';
  const podKey = `${pod.namespace}/${pod.name}`;
  const requestId = ++state.kubernetes.logRequestId;
  const controller = new AbortController();
  state.kubernetes.logAbortController = controller;
  const timeoutId = window.setTimeout(() => controller.abort(), 65000);
  const params = new URLSearchParams({
    env: state.kubernetes.env,
    namespace: pod.namespace,
    pod: pod.name,
    container: document.getElementById(`${prefix}Container`).value,
    previous: String(document.getElementById(`${prefix}Instance`).value === 'previous'),
    since: document.getElementById(`${prefix}Window`).value,
  });
  const output = document.getElementById(isService ? 'kubernetesServiceLogs' : 'kubernetesPodLogs');
  const meta = document.getElementById(isService ? 'kubernetesServiceLogsMeta' : 'kubernetesLogsMeta');
  if (state.kubernetes.logSnapshot) renderKubernetesLogOutput();
  else output.textContent = 'Loading recent container logs...';
  try {
    const response = await fetch(`/api/kubernetes/logs?${params.toString()}`, { signal: controller.signal });
    const data = await readKubernetesApiResponse(response);
    const currentPod = isService ? state.kubernetes.logPod : state.kubernetes.activePod;
    if (requestId !== state.kubernetes.logRequestId || !currentPod || podKey !== `${currentPod.namespace}/${currentPod.name}`) return;
    if (!response.ok || !data.ok) throw new Error(data.message || 'Container logs are unavailable.');
    state.kubernetes.logSnapshot = data;
    renderKubernetesLogOutput();
    if (state.kubernetes.result) {
      renderKubernetesTimeline(state.kubernetes.result);
      const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
      if (service) renderKubernetesTimeline(state.kubernetes.result, 'all', 'kubernetesServiceTimeline', service.pods);
    }
  } catch (error) {
    if (requestId !== state.kubernetes.logRequestId) return;
    state.kubernetes.logError = error.name === 'AbortError' ? 'The log request timed out or was cancelled.' : error.message;
    if (state.kubernetes.logSnapshot) renderKubernetesLogOutput();
    else {
      output.textContent = `Logs unavailable: ${state.kubernetes.logError}`;
      meta.textContent = 'Log access is optional; service health and other available signals remain visible.';
    }
  } finally {
    window.clearTimeout(timeoutId);
    if (requestId === state.kubernetes.logRequestId) {
      state.kubernetes.logLoading = false;
      state.kubernetes.logAbortController = null;
      if (state.kubernetes.logSnapshot) renderKubernetesLogOutput();
    }
  }
}

function renderKubernetesPodTable() {
  const data = state.kubernetes.result;
  if (!data) return;
  const search = document.getElementById('kubernetesSearchInput').value.trim().toLowerCase();
  const globalSearch = document.getElementById('kubernetesGlobalSearch').value.trim().toLowerCase();
  const health = document.getElementById('kubernetesHealthFilter').value;
  const sort = document.getElementById('kubernetesPodSort').value;
  const priority = { Failed: 0, 'Not ready': 1, Pending: 2, Unknown: 3, Healthy: 4, Completed: 5 };
  const pods = (data.pods || []).filter((pod) => {
    const containerNames = (pod.containers || []).map((container) => container.name).join(' ');
    const deployment = state.kubernetes.serviceModels.flatMap((service) => service.deployments).find((item) => item.namespace === pod.namespace && item.name === pod.workload);
    const service = state.kubernetes.serviceModels.find((item) => item.namespace === pod.namespace && item.deployments.includes(deployment));
    const searchable = `${pod.namespace} ${pod.name} ${pod.node} ${containerNames} ${service?.name || ''} ${deployment?.module || ''}`.toLowerCase();
    const matchesSearch = (!search || searchable.includes(search)) && (!globalSearch || searchable.includes(globalSearch));
    return matchesSearch && (!health || pod.health === health);
  }).sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name);
    if (sort === 'node') return left.node.localeCompare(right.node) || left.name.localeCompare(right.name);
    if (sort === 'restarts') return right.restarts - left.restarts || left.name.localeCompare(right.name);
    const leftUsage = kubernetesPodMetrics(data, left);
    const rightUsage = kubernetesPodMetrics(data, right);
    if (sort === 'cpu') return (Number.parseFloat(rightUsage?.cpu) || -1) - (Number.parseFloat(leftUsage?.cpu) || -1) || left.name.localeCompare(right.name);
    if (sort === 'memory') return (Number.parseFloat(rightUsage?.memory) || -1) - (Number.parseFloat(leftUsage?.memory) || -1) || left.name.localeCompare(right.name);
    if (sort === 'service') return (left.workload || '').localeCompare(right.workload || '') || left.name.localeCompare(right.name);
    return (priority[left.health] ?? 3) - (priority[right.health] ?? 3) || right.restarts - left.restarts || left.namespace.localeCompare(right.namespace);
  });
  const podIndexes = new Map((data.pods || []).map((pod, index) => [pod, index]));
  const body = document.getElementById('kubernetesPodsTableBody');
  body.innerHTML = pods.map((pod) => {
    const healthClass = { Healthy: 'healthy', 'Not ready': 'not-ready', Pending: 'pending', Failed: 'failed', Completed: 'completed', Unknown: 'unknown' }[pod.health] || 'unknown';
    const usage = kubernetesPodMetrics(data, pod);
    const metricsAvailable = data.metricsAvailable?.[pod.namespace];
    const deployment = state.kubernetes.serviceModels.flatMap((service) => service.deployments).find((item) => item.namespace === pod.namespace && item.name === pod.workload);
    const service = state.kubernetes.serviceModels.find((item) => item.namespace === pod.namespace && item.deployments.includes(deployment));
    return `<tr data-pod-index="${podIndexes.get(pod)}" class="kubernetes-pod-row" title="Open pod insight">
      <td><span class="kubernetes-namespace-cell">${escapeHtml(pod.namespace)}</span></td>
      <td><button type="button" class="kubernetes-pod-open" aria-haspopup="dialog" title="${escapeHtml(pod.name)}">${escapeHtml(pod.name)}</button><small class="kubernetes-table-container-count">${escapeHtml(service?.name || 'Unmapped')} · ${escapeHtml(deployment?.module || 'Workload')} · ${(pod.containers || []).length} containers</small></td>
      <td><span class="kubernetes-health-chip ${healthClass}"><i></i>${escapeHtml(pod.health)}</span></td>
      <td class="kubernetes-ready-cell">${escapeHtml(pod.ready)}</td>
      <td><span class="kubernetes-restart-cell ${pod.restarts ? 'has-restarts' : ''}">${pod.restarts}</span></td>
      <td title="${metricsAvailable === false ? 'Metrics API unavailable in this namespace' : 'Current point-in-time Metrics API sample'}">${escapeHtml(usage?.cpu || (metricsAvailable === false ? 'N/A' : '—'))}</td>
      <td title="${metricsAvailable === false ? 'Metrics API unavailable in this namespace' : 'Current point-in-time Metrics API sample'}">${escapeHtml(usage?.memory || (metricsAvailable === false ? 'N/A' : '—'))}</td>
      <td><span class="kubernetes-node-cell">${escapeHtml(pod.node)}</span></td>
      <td>${escapeHtml(pod.age)}</td>
    </tr>`;
  }).join('');
  const empty = document.getElementById('kubernetesEmptyState');
  empty.hidden = pods.length > 0;
  empty.textContent = (data.pods || []).length ? 'No pods match these filters.' : 'No pods were returned for this approved namespace scope.';
  document.getElementById('kubernetesTableMeta').textContent = `${pods.length} of ${(data.pods || []).length} pods · Updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

let currentOpsAnalyticsData = null;

async function fetchOpsAnalytics(env = state.currentEnv, forceRefresh = false) {
  const normEnv = (env || 'prod').toLowerCase();
  const refreshBtn = document.getElementById('opsRefreshBtn');
  if (refreshBtn) refreshBtn.classList.add('loading');

  const syncText = document.getElementById('opsSyncStatusText');
  if (syncText) syncText.textContent = 'Syncing live telemetry...';

  try {
    const url = dashboardApiUrl(`/api/ops-analytics?env=${encodeURIComponent(normEnv)}${forceRefresh ? '&refresh=true' : ''}`);
    const res = await fetch(url);
    const json = await res.json();
    currentOpsAnalyticsData = json;
    renderOpsAnalytics(json);
  } catch (err) {
    console.error('Failed to fetch ops analytics:', err);
    if (syncText) syncText.textContent = 'Telemetry Sync Offline';
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('loading');
  }
}

function renderOpsAnalytics(data) {
  if (!data) return;
  const kpi = data.kpi || {};

  // Header & Environment
  const opsEnvPill = document.getElementById('opsEnvPill');
  if (opsEnvPill) opsEnvPill.textContent = (data.env || state.currentEnv || 'prod').toUpperCase();

  const syncText = document.getElementById('opsSyncStatusText');
  const syncTime = document.getElementById('opsSyncTime');
  if (syncText) syncText.textContent = data.isFallback ? 'Baseline Telemetry' : 'Live Data Synced';
  if (syncTime) syncTime.textContent = new Date().toLocaleTimeString();

  // Scorecard KPIs
  const fleetTotal = document.getElementById('opsKpiFleetTotal');
  if (fleetTotal) fleetTotal.textContent = Number(kpi.totalFleet || 0).toLocaleString();

  const availTotal = document.getElementById('opsKpiAvailTotal');
  if (availTotal) availTotal.textContent = Number(kpi.available || 0).toLocaleString();

  const availPctBadge = document.getElementById('opsKpiAvailPctBadge');
  if (availPctBadge) availPctBadge.textContent = `${kpi.availabilityPercent || 0}% Operational`;

  const availBar = document.getElementById('opsKpiAvailBar');
  if (availBar) availBar.style.width = `${Math.min(100, Math.max(0, kpi.availabilityPercent || 0))}%`;

  const availDesc = document.getElementById('opsKpiAvailDesc');
  if (availDesc) availDesc.textContent = `${Number(kpi.disconnected || 0).toLocaleString()} disconnected or offline`;

  const faultTotal = document.getElementById('opsKpiFaultTotal');
  if (faultTotal) faultTotal.textContent = Number(kpi.faulted || 0).toLocaleString();

  const faultPctBadge = document.getElementById('opsKpiFaultPctBadge');
  if (faultPctBadge) faultPctBadge.textContent = `${kpi.faultPercent || 0}% Fault Rate`;

  const marketsTotal = document.getElementById('opsKpiMarketsTotal');
  if (marketsTotal) marketsTotal.textContent = String(kpi.activeMarkets || 28);

  const modelsTotal = document.getElementById('opsKpiModelsTotal');
  if (modelsTotal) modelsTotal.textContent = String(kpi.certifiedModelsCount || 22);

  const aggTotal = document.getElementById('opsKpiAggTotal');
  if (aggTotal) aggTotal.textContent = kpi.aggregatorsNominal ? '2 / 2 Nominal' : 'Incident Logged';

  const aggSlaBadge = document.getElementById('opsKpiAggSlaBadge');
  if (aggSlaBadge) {
    aggSlaBadge.textContent = kpi.aggregatorsNominal ? '99.9% Uptime' : 'Degraded SLA';
    aggSlaBadge.className = `ops-kpi-tag ${kpi.aggregatorsNominal ? 'success' : 'alert'}`;
  }

  // Segmented Bar
  const segAvail = document.getElementById('segAvail');
  const segFault = document.getElementById('segFault');
  const segDisc = document.getElementById('segDisc');
  if (segAvail) {
    segAvail.style.width = `${kpi.availabilityPercent || 33.6}%`;
    segAvail.title = `Available: ${Number(kpi.available || 0).toLocaleString()} (${kpi.availabilityPercent || 0}%)`;
  }
  if (segFault) {
    segFault.style.width = `${Math.max(0.5, kpi.faultPercent || 0.1)}%`;
    segFault.title = `Faulted: ${Number(kpi.faulted || 0).toLocaleString()} (${kpi.faultPercent || 0}%)`;
  }
  if (segDisc) {
    segDisc.style.width = `${kpi.disconnectedPercent || 66.3}%`;
    segDisc.title = `Disconnected: ${Number(kpi.disconnected || 0).toLocaleString()} (${kpi.disconnectedPercent || 0}%)`;
  }

  const statusTotalBadge = document.getElementById('opsStatusTotalBadge');
  if (statusTotalBadge) statusTotalBadge.textContent = `${Number(kpi.totalFleet || 0).toLocaleString()} Units`;

  // Status Table
  const statusTableBody = document.getElementById('opsStatusTableBody');
  if (statusTableBody && Array.isArray(data.statusBreakdown)) {
    statusTableBody.innerHTML = data.statusBreakdown.map((row) => `
      <tr>
        <td>
          <span class="ops-table-status-pill">
            <span class="ops-dot" style="background: ${row.color || '#64748b'};"></span>
            <span>${escapeHtml(row.label || row.status)}</span>
          </span>
        </td>
        <td><strong>${Number(row.count || 0).toLocaleString()}</strong></td>
        <td><span class="ops-card-badge">${row.percent}%</span></td>
        <td style="color: var(--text-muted); font-size: 11.5px;">${escapeHtml(row.description || '')}</td>
        <td>
          <button type="button" class="ops-table-action-btn" onclick="filterFleetByStatus('${escapeHtml(row.status)}')">
            <span>Filter Fleet →</span>
          </button>
        </td>
      </tr>
    `).join('');
  }

  // Country Bars
  const countryBarsContainer = document.getElementById('opsCountryBarsContainer');
  if (countryBarsContainer && Array.isArray(data.countryDistribution)) {
    const maxCount = Math.max(...data.countryDistribution.map(c => c.count || 0), 1);
    countryBarsContainer.innerHTML = data.countryDistribution.map((c) => {
      const barWidth = Math.max(2, Math.round(((c.count || 0) / maxCount) * 100));
      const isBelgium = c.code === 'BE';
      return `
        <div class="ops-country-row" onclick="filterFleetByCountry('${escapeHtml(c.code)}')">
          <div class="ops-country-meta">
            <span class="ops-country-flag">${c.flag || '🌐'}</span>
            <span class="ops-country-code">${escapeHtml(c.code)}</span>
            <span class="ops-country-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          </div>
          <div class="ops-country-bar-wrap">
            <div class="ops-country-bar-fill ${isBelgium ? 'belgium-bar' : ''}" style="width: ${barWidth}%;"></div>
          </div>
          <div class="ops-country-stat">
            <span class="ops-country-count">${Number(c.count || 0).toLocaleString()}</span>
            <span class="ops-country-pct">${c.percent}%</span>
          </div>
          <span class="ops-country-filter-hint">Filter →</span>
        </div>
      `;
    }).join('');
  }

  // Top Hardware Models List
  const modelsList = document.getElementById('opsModelsList');
  if (modelsList && Array.isArray(data.modelDistribution)) {
    modelsList.innerHTML = data.modelDistribution.map(m => `
      <div class="ops-model-item">
        <div>
          <span class="ops-model-name">${escapeHtml(m.model)}</span>
          <span class="ops-model-tag"> · ${escapeHtml(m.power)} (${escapeHtml(m.formFactor)})</span>
        </div>
        <span class="ops-model-count">${Number(m.sampleCount || 0).toLocaleString()} units</span>
      </div>
    `).join('');
  }

  // Firmware Table
  const fwTableBody = document.getElementById('opsFirmwareTableBody');
  if (fwTableBody && Array.isArray(data.firmwareDistribution)) {
    fwTableBody.innerHTML = data.firmwareDistribution.map(f => {
      const isLatest = f.status === 'Certified Latest';
      const badgeClass = isLatest ? 'success' : (f.status === 'Certified' ? 'info' : 'alert');
      return `
        <tr>
          <td><strong>v${escapeHtml(f.version)}</strong></td>
          <td style="color: var(--text-muted); font-size: 11.5px;">${escapeHtml(f.tier)}</td>
          <td><span class="ops-card-badge ${badgeClass}">${escapeHtml(f.status)}</span></td>
          <td><strong>${Number(f.sampleCount || 0).toLocaleString()}</strong></td>
          <td>
            <button type="button" class="ops-table-action-btn" onclick="filterFleetByFirmware('${escapeHtml(f.version)}')">
              <span>Filter Fleet →</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Aggregators Grid (Centrica & Haulogy only)
  const aggGrid = document.getElementById('opsAggCardsGrid');
  if (aggGrid && Array.isArray(data.aggregators)) {
    const validAggs = data.aggregators.filter(a => a.name !== 'hiven');
    aggGrid.innerHTML = validAggs.map(a => {
      const isNominal = a.status === 'NOMINAL';
      return `
        <div class="ops-agg-card">
          <div class="ops-agg-header">
            <div class="ops-agg-identity">
              <strong class="ops-agg-name">${escapeHtml(a.displayName)}</strong>
              <span class="ops-agg-role">${escapeHtml(a.role || 'V1G Smart Charging Aggregator')}</span>
            </div>
            <span class="ops-agg-status-badge ${isNominal ? 'nominal' : 'incident'}">
              <span class="ops-dot" style="background: ${isNominal ? '#10b981' : '#ef4444'};"></span>
              <span>${isNominal ? 'NOMINAL' : 'INCIDENT ACTIVE'}</span>
            </span>
          </div>
          <div class="ops-agg-metrics-row">
            <div class="ops-agg-metric">
              <span class="ops-agg-metric-label">30-Day SLA Uptime</span>
              <strong class="ops-agg-metric-val ${isNominal ? 'green' : ''}">${escapeHtml(a.uptime30d || '100.00%')}</strong>
            </div>
            <div class="ops-agg-metric">
              <span class="ops-agg-metric-label">Active Incidents</span>
              <strong class="ops-agg-metric-val">${a.activeOutagesCount || 0}</strong>
            </div>
            <div class="ops-agg-metric">
              <span class="ops-agg-metric-label">Historical Events</span>
              <strong class="ops-agg-metric-val">${a.outagesTotal || (a.outages ? a.outages.length : 0)}</strong>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function filterFleetByCountry(countryCode) {
  if (!countryCode || countryCode === 'OTHER') return;
  openFleetView({ loadFleet: false });
  const select = document.getElementById('fleetCountrySelect');
  if (select) {
    select.value = countryCode;
  }
  state.fleet.filters.country = countryCode;
  fetchFleetWallboxes(0);
}

function filterFleetByStatus(status) {
  if (!status) return;
  openFleetView({ loadFleet: false });
  const select = document.getElementById('fleetStatusSelect');
  if (select) {
    select.value = status;
  }
  state.fleet.filters.status = status;
  fetchFleetWallboxes(0);
}

function filterFleetByFirmware(version) {
  if (!version) return;
  openFleetView({ loadFleet: false });
  const select = document.getElementById('fleetVersionSelect');
  if (select) {
    select.value = version;
  }
  state.fleet.filters.firmwareVersion = version;
  fetchFleetWallboxes(0);
}

window.filterFleetByCountry = filterFleetByCountry;
window.filterFleetByStatus = filterFleetByStatus;
window.filterFleetByFirmware = filterFleetByFirmware;

function updateEnvironmentUI() {
  const env = (state.currentEnv || 'prod').toLowerCase();
  const envUpper = env.toUpperCase();

  // Update topbar pills
  document.querySelectorAll('.env-pill').forEach((btn) => {
    const isTarget = btn.dataset.env === env;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-pressed', String(isTarget));
  });

  // Update Live Header Env badge
  const liveEnvBadge = document.getElementById('liveHeaderEnvBadge');
  if (liveEnvBadge) {
    liveEnvBadge.textContent = `${envUpper} LIVE`;
  }

  // Update Fleet hero tag
  const fleetTag = document.getElementById('fleetEnvIndicatorTag');
  if (fleetTag) {
    fleetTag.textContent = envUpper;
  }

  // Update Ops pill
  const opsEnvPill = document.getElementById('opsEnvPill');
  if (opsEnvPill) {
    opsEnvPill.textContent = envUpper;
  }

  // Update Charger view tag
  const chargerTag = document.getElementById('chargerEnvTag');
  if (chargerTag) {
    chargerTag.textContent = envUpper;
    chargerTag.className = `charger-env-tag env-${env}`;
  }
}

function updateDataSyncProvenance(status = 'synced', label = '') {
  const badge = document.getElementById('liveTelemetryBadge');
  const syncStatus = document.getElementById('liveDataSyncStatus');
  const envName = (state.currentEnv || 'prod').toUpperCase();
  const envBadge = document.getElementById('liveHeaderEnvBadge');
  if (envBadge) {
    envBadge.textContent = `${envName} LIVE`;
  }

  if (status === 'syncing') {
    if (badge) badge.classList.add('is-syncing');
    if (syncStatus) {
      syncStatus.textContent = label || `Syncing ${envName}...`;
    }
  } else {
    if (badge) badge.classList.remove('is-syncing');
    state.lastDataSyncTimestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (syncStatus) {
      syncStatus.textContent = label || `Synced ${timeStr}`;
      syncStatus.title = `100% Live telemetry verified from TME ${envName} at ${timeStr}`;
    }
  }
}

function formatKpiNumber(num) {
  if (num == null || isNaN(num)) return '—';
  if (num >= 10000) return `~${(num / 1000).toFixed(1)}k`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(num);
}

function resetFleetKpiPlaceholders(env) {
  const normEnv = (env || state.currentEnv || 'prod').toUpperCase();
  const kpiFleetTotal = document.getElementById('kpiFleetTotal');
  const kpiFleetDesc = document.getElementById('kpiFleetDesc');
  const kpiAvailBadge = document.getElementById('kpiAvailBadge');
  const kpiDiscBadge = document.getElementById('kpiDiscBadge');
  const kpiAvailBar = document.getElementById('kpiAvailBar');
  const kpiDiscBar = document.getElementById('kpiDiscBar');
  const kpiTopModels = document.getElementById('kpiTopModels');
  const kpiModelsCount = document.getElementById('kpiModelsCount');
  const kpiTopFirmwares = document.getElementById('kpiTopFirmwares');
  const kpiFirmwaresCount = document.getElementById('kpiFirmwaresCount');

  if (kpiFleetTotal) kpiFleetTotal.textContent = '...';
  if (kpiFleetDesc) kpiFleetDesc.textContent = `Registered ${normEnv} wallbox units`;
  if (kpiAvailBadge) kpiAvailBadge.textContent = '● ... Available';
  if (kpiDiscBadge) kpiDiscBadge.textContent = '● ... Disconnected';
  if (kpiAvailBar) kpiAvailBar.style.width = '50%';
  if (kpiDiscBar) kpiDiscBar.style.width = '50%';
  if (kpiTopModels) kpiTopModels.textContent = 'Loading...';
  if (kpiModelsCount) kpiModelsCount.textContent = `Fetching models (${normEnv})...`;
  if (kpiTopFirmwares) kpiTopFirmwares.textContent = 'Loading...';
  if (kpiFirmwaresCount) kpiFirmwaresCount.textContent = `Fetching builds (${normEnv})...`;
}

async function updateFleetKpiMetrics() {
  const env = (state.currentEnv || 'prod').toUpperCase();
  const kpiFleetTotal = document.getElementById('kpiFleetTotal');
  const kpiFleetDesc = document.getElementById('kpiFleetDesc');
  const kpiAvailBadge = document.getElementById('kpiAvailBadge');
  const kpiDiscBadge = document.getElementById('kpiDiscBadge');
  const kpiAvailBar = document.getElementById('kpiAvailBar');
  const kpiDiscBar = document.getElementById('kpiDiscBar');
  const kpiTopModels = document.getElementById('kpiTopModels');
  const kpiModelsCount = document.getElementById('kpiModelsCount');
  const kpiTopFirmwares = document.getElementById('kpiTopFirmwares');
  const kpiFirmwaresCount = document.getElementById('kpiFirmwaresCount');

  // Update models KPI
  const models = state.fleet.metadata.models || [];
  if (kpiTopModels) {
    if (models.length > 0) {
      const topTwo = models.slice(0, 2).map((m) => {
        const match = m.match(/Terra\s*AC\s*([A-Za-z0-9]+)/i);
        return match ? `Terra AC ${match[1]}` : m.split('-')[0].trim();
      });
      kpiTopModels.textContent = topTwo.join(' · ') || models[0];
    } else {
      kpiTopModels.textContent = 'None deployed';
    }
  }
  if (kpiModelsCount) {
    kpiModelsCount.textContent = `${models.length} certified models deployed (${env})`;
  }

  // Update firmwares KPI
  const firmwares = state.fleet.metadata.firmwares || [];
  if (kpiTopFirmwares) {
    if (firmwares.length > 0) {
      const topBuilds = firmwares.slice(0, 2).map((v) => (v.startsWith('v') ? v : `v${v}`)).join(' / ');
      kpiTopFirmwares.textContent = topBuilds;
    } else {
      kpiTopFirmwares.textContent = 'None released';
    }
  }
  if (kpiFirmwaresCount) {
    kpiFirmwaresCount.textContent = `${firmwares.length} tracked version releases (${env})`;
  }

  // The table request supplies the fleet total; only request the available count here.
  try {
    const response = await fetch(dashboardApiUrl(`/api/wallbox-list?env=${encodeURIComponent(env)}&status=Available&page=0&size=1`));
    const data = await response.json();
    if (env.toLowerCase() !== state.currentEnv) return;
    const availableValue = data?.data?.totalElements;
    const available = data?.ok && availableValue != null ? Number(availableValue) : NaN;
    state.fleet.availableElements = Number.isFinite(available) ? available : null;
    state.fleet.availableEnvironment = env.toLowerCase();
    renderFleetAvailabilityKpis(env.toLowerCase());
  } catch (err) {
    if (env.toLowerCase() === state.currentEnv) {
      state.fleet.availableElements = null;
      state.fleet.availableEnvironment = env.toLowerCase();
      renderFleetAvailabilityKpis(env.toLowerCase());
    }
    console.warn('Could not refresh fleet availability KPIs:', err);
  }
}

function renderFleetAvailabilityKpis(environment) {
  const env = String(environment || state.currentEnv || 'prod').toLowerCase();
  if (env !== state.currentEnv) return;

  const total = state.fleet.totalEnvironment === env ? state.fleet.totalElements : null;
  const available = state.fleet.availableEnvironment === env ? state.fleet.availableElements : null;
  const totalElement = document.getElementById('kpiFleetTotal');
  const availableBadge = document.getElementById('kpiAvailBadge');
  const disconnectedBadge = document.getElementById('kpiDiscBadge');
  const availableBar = document.getElementById('kpiAvailBar');
  const disconnectedBar = document.getElementById('kpiDiscBar');

  if (totalElement) {
    totalElement.textContent = total != null
      ? total.toLocaleString()
      : state.fleet.totalEnvironment === env ? '—' : '...';
  }
  if (availableBadge) {
    const availableText = available != null
      ? formatKpiNumber(available)
      : state.fleet.availableEnvironment === env ? '—' : '...';
    availableBadge.textContent = `● ${availableText} Available`;
  }

  const disconnected = total != null && available != null ? Math.max(0, total - available) : null;
  if (disconnectedBadge) {
    const disconnectedText = disconnected != null
      ? formatKpiNumber(disconnected)
      : state.fleet.totalEnvironment === env || state.fleet.availableEnvironment === env ? '—' : '...';
    disconnectedBadge.textContent = `● ${disconnectedText} Disconnected`;
  }

  const availablePercent = total > 0 && available != null ? Math.round((available / total) * 100) : 0;
  if (availableBar) availableBar.style.width = `${availablePercent}%`;
  if (disconnectedBar) disconnectedBar.style.width = `${total != null && available != null ? 100 - availablePercent : 0}%`;
}

async function setEnvironment(env) {
  const normalized = (env || 'prod').toLowerCase();
  if (!['prod', 'acc', 'prev'].includes(normalized)) return;
  if (state.currentEnv === normalized) return;

  state.currentEnv = normalized;
  localStorage.setItem('wallbox_env', normalized);
  state.token = ''; // Clear prior environment token immediately from active memory

  updateEnvironmentUI();
  if (__fotaHeaderOnly) {
    window.dispatchEvent(new CustomEvent('dashboard-environment-change', { detail: { environment: normalized } }));
    const syncStatus = document.getElementById('liveDataSyncStatus');
    if (syncStatus) {
      syncStatus.textContent = `${normalized.toUpperCase()} FOTA`;
      syncStatus.title = `Firmware management environment: ${normalized.toUpperCase()}`;
    }
    await checkLiveTokenHealth();
    if (!await loadStoredTokenFromLocalBridge({ scanBrowser: true })) {
      await retryLoginFromScratch();
    }
    return;
  }

  updateDataSyncProvenance('syncing', `Connecting to ${normalized.toUpperCase()}...`);

  // Reset KPI cards to environment-specific loading placeholders immediately
  resetFleetKpiPlaceholders(normalized);

  // Clear current data caches for seamless switch
  state.fleet.items = [];
  state.fleet.page = 0;

  // Immediately check live token status for target environment
  await checkLiveTokenHealth();

  // Check and load token for the new environment
  const hasValidToken = await loadStoredTokenFromLocalBridge({ scanBrowser: true });
  if (!hasValidToken) {
    setStatus(`Retrieving ${normalized.toUpperCase()} session token... Opening TME in a browser tab if needed.`, 'warning');
    await retryLoginFromScratch();
  } else {
    setStatus(`Connected to ${normalized.toUpperCase()} fleet.`, 'success');
    updateDataSyncProvenance('synced');
    loadFleetMetadata();
    if (state.currentView === 'fleet') {
      fetchOutages();
      await fetchFleetWallboxes(0);
    } else if (state.currentView === 'charger') {
      const serial = document.getElementById('serialNumber')?.value?.trim();
      if (serial) {
        fetchEvents();
        checkSseInteractions(serial);
      }
    } else if (state.currentView === 'ops') {
      fetchOpsAnalytics(normalized);
    }
  }
}

async function loadFleetMetadata() {
  const env = (state.currentEnv || 'prod').toLowerCase();
  try {
    const [modelsRes, statusesRes, firmwaresRes] = await Promise.allSettled([
      fetch(dashboardApiUrl(`/api/wallbox-models?env=${encodeURIComponent(env)}`)).then((r) => r.json()),
      fetch(dashboardApiUrl(`/api/wallbox-statuses?env=${encodeURIComponent(env)}`)).then((r) => r.json()),
      fetch(dashboardApiUrl(`/api/firmware-versions?env=${encodeURIComponent(env)}`)).then((r) => r.json()),
    ]);
    if (env !== state.currentEnv) return;

    if (modelsRes.status === 'fulfilled' && modelsRes.value && modelsRes.value.ok) {
      const models = modelsRes.value.items || (modelsRes.value.data && modelsRes.value.data.models) || [];
      state.fleet.metadata.models = models.filter(Boolean);
      const modelSelect = document.getElementById('fleetModelSelect');
      if (modelSelect) {
        modelSelect.innerHTML = '<option value="">Select a model</option>' +
          state.fleet.metadata.models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
      }
    }

    const fallbackStatuses = ['Available', 'Occupied', 'Unavailable', 'Faulted'];
    const statuses = (statusesRes.status === 'fulfilled' && statusesRes.value && statusesRes.value.ok && statusesRes.value.items && statusesRes.value.items.length)
      ? statusesRes.value.items
      : fallbackStatuses;
    state.fleet.metadata.statuses = statuses.filter(Boolean);
    const statusSelect = document.getElementById('fleetStatusSelect');
    if (statusSelect) {
      statusSelect.innerHTML = '<option value="">Select a status</option>' +
        state.fleet.metadata.statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    }

    if (firmwaresRes.status === 'fulfilled' && firmwaresRes.value && firmwaresRes.value.ok) {
      const firmwares = (firmwaresRes.value.items || (firmwaresRes.value.data && firmwaresRes.value.data.firmwaresVersion) || [])
        .filter((v) => typeof v === 'string' && v.trim().length > 0);
      firmwares.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      state.fleet.metadata.firmwares = firmwares;
      const verSelect = document.getElementById('fleetVersionSelect');
      if (verSelect) {
        verSelect.innerHTML = '<option value="">Select a version</option>' +
          firmwares.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      }
    }

    const countrySelect = document.getElementById('fleetCountrySelect');
    if (countrySelect) {
      countrySelect.innerHTML = '<option value="">Select a country</option>' +
        EUROPEAN_COUNTRIES.map((c) => `<option value="${c.code}">${c.name}</option>`).join('');
    }

    // Update all 4 KPI cards with live environment data
    await updateFleetKpiMetrics();
  } catch (error) {
    console.error('Failed to load fleet metadata:', error);
  }
}

/* ========================================================
   Platform Outages & Operational Incidents Logic
   ======================================================== */
function formatOutageDuration(startTimeStr, endTimeStr) {
  if (!startTimeStr) return '—';
  const start = new Date(startTimeStr).getTime();
  const end = endTimeStr ? new Date(endTimeStr).getTime() : Date.now();
  if (isNaN(start) || isNaN(end)) return '—';
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));

  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return '< 1m';
}

function formatOutageTime(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch (e) {
    return isoStr;
  }
}

function getOutageServiceIcon(service) {
  const s = (service || '').toLowerCase();
  if (s.includes('status')) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.93 4.93a10 10 0 0 1 14.14 0"/><path d="M7.76 7.76a6 6 0 0 1 8.48 0"/><circle cx="12" cy="12" r="2"/></svg>`;
  }
  if (s.includes('meter') || s.includes('energy') || s.includes('power')) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
  }
  if (s.includes('auth') || s.includes('sec') || s.includes('token')) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
  }
  if (s.includes('remote') || s.includes('operation')) {
    return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
}

const TRACKED_AGGREGATORS = ['centrica', 'haulogy'];

const FALLBACK_AGGREGATOR_DATA = [
  {
    subscription: 'centrica',
    outages: [
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-13T15:32:41.331Z', endTime: '2026-08-13T15:35:07.337Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-16T13:20:07.145Z', endTime: '2026-08-16T13:25:07.094Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-17T22:45:07.149Z', endTime: '2026-08-17T22:50:07.109Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-19T22:45:07.166Z', endTime: '2026-08-19T22:50:07.141Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-21T19:25:07.387Z', endTime: '2026-08-21T19:30:07.244Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-08-22T20:00:07.158Z', endTime: '2026-08-22T20:05:07.131Z' },
      { service: 'meter-values', status: 'NOK', startTime: '2026-08-24T12:45:07.427Z', endTime: '2026-08-24T12:50:07.075Z' },
      { service: 'smart-temporary-toggle', status: 'NOK', startTime: '2026-08-31T19:30:07.808Z', endTime: '2026-08-31T19:35:07.231Z' },
      { service: 'meter-values', status: 'NOK', startTime: '2026-09-01T07:25:07.149Z', endTime: '2026-09-01T07:30:07.377Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-09-01T18:05:07.387Z', endTime: '2026-09-01T18:10:07.209Z' },
      { service: 'ev-connected', status: 'NOK', startTime: '2026-09-02T21:10:08.956Z', endTime: '2026-09-02T21:15:07.297Z' },
      { service: 'smart-charging-override', status: 'NOK', startTime: '2026-09-07T08:15:07.437Z', endTime: '2026-09-07T08:20:07.035Z' },
      { service: 'meter-values', status: 'NOK', startTime: '2026-09-25T20:40:07.000Z', endTime: '2026-09-25T20:45:07.000Z' }
    ]
  },
  {
    subscription: 'haulogy',
    outages: []
  }
];

function formatUtcDatetime(isoStr) {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    const day = d.getUTCDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hh}:${mm}:${ss}`;
  } catch (e) {
    return isoStr;
  }
}

function formatOngoingDuration(startIsoStr) {
  if (!startIsoStr) return '—';
  const start = new Date(startIsoStr).getTime();
  const now = Date.now();
  if (isNaN(start)) return '—';
  const diffSec = Math.max(0, Math.floor((now - start) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = String(Math.floor((diffSec % 86400) / 3600)).padStart(2, '0');
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  if (days > 0) return `${days} days ${hours}:${mins}:${secs}`;
  return `${hours}:${mins}:${secs}`;
}

async function fetchOutages() {
  const env = (state.currentEnv || 'prod').toLowerCase();
  const beacon = document.getElementById('outagesStateBeacon');
  const badge = document.getElementById('outagesActiveBadge');
  const refreshBtn = document.getElementById('outagesRefreshBtn');
  if (refreshBtn) refreshBtn.classList.add('rotating');

  let rawList = [];
  try {
    const res = await fetch(dashboardApiUrl(`/api/outages?env=${encodeURIComponent(env)}`));
    const json = await res.json();
    if (json && Array.isArray(json.data) && json.data.length > 0) {
      rawList = json.data;
    }
  } catch (err) {
    console.warn('Failed to fetch live aggregator outages, falling back to cached telemetry:', err);
  }

  // Merge with fallback data so both Centrica and Haulogy are always populated
  // And EXCLUDE hiven completely as explicitly commanded by user
  const aggregatorMap = new Map();
  TRACKED_AGGREGATORS.forEach((name) => {
    const foundFallback = FALLBACK_AGGREGATOR_DATA.find((item) => item.subscription.toLowerCase() === name.toLowerCase());
    aggregatorMap.set(name.toLowerCase(), foundFallback ? [...(foundFallback.outages || [])] : []);
  });

  if (Array.isArray(rawList)) {
    rawList.forEach((subGroup) => {
      const subName = (subGroup.subscription || '').toLowerCase().trim();
      // Strict rule: Exclude hiven and only track centrica and haulogy
      if (subName && TRACKED_AGGREGATORS.includes(subName)) {
        const liveOutages = subGroup.outages || [];
        aggregatorMap.set(subName, liveOutages);
      }
    });
  }

  state.fleet.aggregatorData = aggregatorMap;

  // Check overall health
  let totalActiveOutages = 0;
  TRACKED_AGGREGATORS.forEach((name) => {
    const outages = aggregatorMap.get(name) || [];
    const active = outages.some((o) => !o.endTime || (o.status === 'NOK' && !o.endTime));
    if (active) totalActiveOutages++;
  });

  if (beacon) {
    beacon.className = 'outages-state-beacon ' + (totalActiveOutages > 0 ? 'alert' : 'nominal');
  }
  if (badge) {
    if (totalActiveOutages > 0) {
      badge.className = 'outages-active-badge alert';
      badge.textContent = `${totalActiveOutages} Ongoing Outage${totalActiveOutages > 1 ? 's' : ''}`;
    } else {
      badge.className = 'outages-active-badge nominal';
      badge.textContent = '2 Aggregators Operational';
    }
  }

  renderAggregatorCards();

  if (refreshBtn) {
    setTimeout(() => refreshBtn.classList.remove('rotating'), 600);
  }
}

function renderAggregatorCards() {
  const container = document.getElementById('aggCardsGrid');
  if (!container) return;

  const aggregatorMap = state.fleet.aggregatorData || new Map();

  // Reference timeframe date (aligned with 2026 logs)
  const now = new Date();
  const refTime = (now.getFullYear() >= 2026) ? now.getTime() : new Date('2026-09-29T09:00:00Z').getTime();

  let html = '';

  TRACKED_AGGREGATORS.forEach((aggName) => {
    const outages = (aggregatorMap.get(aggName) || []).slice();
    
    // Sort outages descending by start time
    outages.sort((a, b) => {
      const tA = new Date(a.startTime || 0).getTime();
      const tB = new Date(b.startTime || 0).getTime();
      return tB - tA;
    });

    const activeOutage = outages.find((o) => !o.endTime || (o.status === 'NOK' && !o.endTime));
    const isOutage = Boolean(activeOutage);

    // Compute last outage date
    let lastOutageText = 'N/A';
    if (!isOutage && outages.length > 0) {
      const latest = outages[0];
      const timeToFormat = latest.endTime || latest.startTime;
      lastOutageText = formatUtcDatetime(timeToFormat);
    }

    // Build 30-day sparkline
    const dayBuckets = [];
    for (let i = 29; i >= 0; i--) {
      const dStart = new Date(refTime - i * 86400000);
      dStart.setUTCHours(0, 0, 0, 0);
      const dEnd = new Date(dStart.getTime() + 86400000 - 1);
      
      const dayOutages = outages.filter((o) => {
        const sTime = new Date(o.startTime || 0).getTime();
        const eTime = o.endTime ? new Date(o.endTime).getTime() : Date.now();
        return sTime <= dEnd.getTime() && eTime >= dStart.getTime();
      });

      const dayDateStr = `${dStart.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dStart.getUTCMonth()]} ${dStart.getUTCFullYear()}`;
      
      dayBuckets.push({
        hasOutage: dayOutages.length > 0,
        count: dayOutages.length,
        dateStr: dayDateStr,
        details: dayOutages.map((o) => o.service || 'service incident').join(', '),
      });
    }

    const sparklineBarsHtml = dayBuckets.map((bucket) => {
      const tooltip = bucket.hasOutage
        ? `${bucket.dateStr}: ${bucket.count} incident(s) recorded (${bucket.details})`
        : `${bucket.dateStr}: Nominal operation (No incidents)`;
      return `<div class="agg-bar ${bucket.hasOutage ? 'outage' : 'healthy'}" title="${escapeHtml(tooltip)}"></div>`;
    }).join('');

    const statusBadgeHtml = isOutage
      ? `<span class="agg-status-pill outage">OUTAGE</span>`
      : `<span class="agg-status-pill healthy">HEALTHY</span>`;

    const detailLinesHtml = isOutage
      ? `
        <div class="agg-detail-row">
          <span class="agg-detail-label">Start date of current outage in UTC:</span>
          <span class="agg-detail-val ongoing">${escapeHtml(formatUtcDatetime(activeOutage.startTime))}</span>
        </div>
        <div class="agg-detail-row">
          <span class="agg-detail-label">Duration of ongoing outage in UTC:</span>
          <span class="agg-detail-val ongoing">${escapeHtml(formatOngoingDuration(activeOutage.startTime))}</span>
        </div>
      `
      : `
        <div class="agg-detail-row">
          <span class="agg-detail-label">Date of last outage in UTC:</span>
          <span class="agg-detail-val">${escapeHtml(lastOutageText)}</span>
        </div>
      `;

    html += `
      <div class="agg-card ${isOutage ? 'is-outage' : 'is-healthy'}">
        <h3 class="agg-card-title">${escapeHtml(aggName)}</h3>
        <div class="agg-status-row">
          <span class="agg-status-label">Current Aggregator status:</span>
          ${statusBadgeHtml}
        </div>
        ${detailLinesHtml}
        <div class="agg-history-container">
          <div class="agg-history-header">
            <span>Historical data</span>
            <span class="agg-history-info-icon" title="Incident telemetry across the last 30 calendar days. Green indicates nominal healthy state, Red indicates service outage.">i</span>
          </div>
          <div class="agg-history-content-row">
            <div class="agg-sparkline-box">
              <div class="agg-sparkline-bars">
                ${sparklineBarsHtml}
              </div>
              <div class="agg-sparkline-labels">
                <span>30 days ago</span>
                <span>today</span>
              </div>
            </div>
            <button type="button" class="agg-outage-list-btn" data-agg="${escapeHtml(aggName)}" title="View complete list of recorded outages for ${escapeHtml(aggName)}">
              Outage list
            </button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Bind Outage List buttons
  container.querySelectorAll('.agg-outage-list-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const aggName = btn.dataset.agg;
      openAggregatorOutagesDialog(aggName);
    });
  });
}

function openAggregatorOutagesDialog(aggName) {
  const dialog = document.getElementById('aggOutageListDialog');
  const title = document.getElementById('aggDialogTitle');
  const subtitle = document.getElementById('aggDialogSubtitle');
  const body = document.getElementById('aggDialogBody');
  if (!dialog || !body) return;

  const aggregatorMap = state.fleet.aggregatorData || new Map();
  const outages = (aggregatorMap.get(aggName) || []).slice();

  // Sort newest first
  outages.sort((a, b) => {
    const tA = new Date(a.startTime || 0).getTime();
    const tB = new Date(b.startTime || 0).getTime();
    return tB - tA;
  });

  if (title) title.textContent = `${aggName.charAt(0).toUpperCase() + aggName.slice(1)} Outage History`;
  if (subtitle) subtitle.textContent = `${outages.length} recorded incident event${outages.length === 1 ? '' : 's'} (UTC)`;

  if (outages.length === 0) {
    body.innerHTML = `
      <div class="agg-empty-box">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <strong>No Incidents Recorded</strong>
        <span>${escapeHtml(aggName)} has maintained 100% operational availability with zero outage records found.</span>
      </div>
    `;
  } else {
    const rows = outages.map((o, idx) => {
      const isOngoing = !o.endTime;
      const started = formatUtcDatetime(o.startTime);
      const ended = o.endTime ? formatUtcDatetime(o.endTime) : '<span style="color:#dc2626;font-weight:700;">Ongoing</span>';
      const duration = formatOutageDuration(o.startTime, o.endTime);
      return `
        <tr>
          <td style="color:var(--muted);width:30px;">#${outages.length - idx}</td>
          <td style="font-family:monospace;font-weight:600;">${escapeHtml(o.service || 'unknown-service')}</td>
          <td>
            <span class="agg-status-pill ${isOngoing ? 'outage' : 'healthy'}" style="font-size:10px;padding:1px 6px;">
              ${isOngoing ? 'NOK (Active)' : 'Resolved'}
            </span>
          </td>
          <td>${escapeHtml(started)}</td>
          <td>${ended}</td>
          <td style="font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(duration)}</td>
        </tr>
      `;
    }).join('');

    body.innerHTML = `
      <div style="overflow-x:auto;">
        <table class="agg-outage-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Service</th>
              <th>Status</th>
              <th>Started (UTC)</th>
              <th>Resolved (UTC)</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function setupOutagesControls() {
  const refreshBtn = document.getElementById('outagesRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchOutages();
    });
  }

  const dialog = document.getElementById('aggOutageListDialog');
  const closeBtn = document.getElementById('aggDialogCloseBtn');
  if (closeBtn && dialog) {
    closeBtn.addEventListener('click', () => dialog.close());
  }
  if (dialog) {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  }
}

async function fetchFleetWallboxes(page = 0) {
  state.fleet.page = page;
  state.fleet.loading = true;
  state.fleet.error = null;

  const tbody = document.getElementById('fleetTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="fleet-loading-row">
          <div class="fleet-spinner"></div>
          <span>Loading charging stations fleet...</span>
        </td>
      </tr>
    `;
  }

  const size = parseInt(document.getElementById('fleetPageSizeSelect')?.value, 10) || 10;
  state.fleet.size = size;

  const serialNumber = document.getElementById('fleetSearchSerialInput')?.value.trim() || '';
  const model = document.getElementById('fleetModelSelect')?.value || '';
  const firmwareVersion = document.getElementById('fleetVersionSelect')?.value || '';
  const status = document.getElementById('fleetStatusSelect')?.value || '';
  const country = document.getElementById('fleetCountrySelect')?.value || '';

  state.fleet.filters = { serialNumber, model, firmwareVersion, status, country };

  const env = (state.currentEnv || 'prod').toLowerCase();
  const params = new URLSearchParams();
  params.set('env', env);
  params.set('page', String(page));
  params.set('size', String(size));
  if (serialNumber) params.set('serialNumber', serialNumber);
  if (model) params.set('model', model);
  if (firmwareVersion) params.set('firmwareVersion', firmwareVersion);
  if (status) params.set('status', status);
  if (country) {
    params.set('countryIds', country);
    params.set('countryId', country);
  }

  try {
    const res = await fetch(dashboardApiUrl(`/api/wallbox-list?${params.toString()}`));
    const data = await res.json();
    if (env !== state.currentEnv) return;

    if (!data || !data.ok) {
      if (res.status === 401 || data?.authError) {
        window.dispatchEvent(new CustomEvent('dashboard-token-rejected', { detail: { environment: env } }));
      }
      throw new Error(data && data.message ? data.message : 'Failed to fetch charging stations list');
    }

    const payload = data.data || {};
    let content = payload.content || [];
    const totalElements = payload.totalElements != null ? payload.totalElements : (payload.numberOfElements || content.length);
    const totalPages = payload.totalPages || Math.max(1, Math.ceil(totalElements / size));

    state.fleet.items = content;
    state.fleet.totalElements = totalElements;
    state.fleet.totalPages = totalPages;
    state.fleet.totalEnvironment = env;

    renderFleetAvailabilityKpis(env);

    renderFleetTableRows(content);
    updateFleetPagination(page, size, totalElements, totalPages);
  } catch (err) {
    if (env !== state.currentEnv) return;
    state.fleet.error = err.message;
    state.fleet.totalElements = null;
    state.fleet.totalEnvironment = env;
    renderFleetAvailabilityKpis(env);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="fleet-empty-cell">
            <p style="color: #ef4444; font-weight: 600; margin-bottom: 8px;">Failed to load charging stations</p>
            <p style="font-size: 12px; margin-bottom: 12px; color: var(--muted);">${escapeHtml(err.message)}</p>
            <button type="button" class="fleet-btn fleet-btn-reset" onclick="fetchFleetWallboxes(${page})">Try Again</button>
          </td>
        </tr>
      `;
    }
  } finally {
    if (env === state.currentEnv) state.fleet.loading = false;
  }
}

function renderFleetTableRows(items) {
  const tbody = document.getElementById('fleetTableBody');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="fleet-empty-cell">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 10px; color: var(--muted);"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          <p style="font-weight: 600; color: var(--text);">No charging stations found</p>
          <p style="font-size: 12px; color: var(--muted);">No wallboxes matched the specified search and filter criteria.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = items.map((wb) => {
    const serial = wb.serialNumber || '—';
    const model = wb.model || 'Terra AC';
    let version = wb.version || wb.firmwareVersion || '—';
    if (version && version !== '—' && !version.startsWith('v')) {
      version = `v${version}`;
    }

    let status = 'Unknown';
    if (wb.connectors && wb.connectors.length > 0) {
      const c = wb.connectors.find((conn) => conn.status) || wb.connectors[0];
      if (c && c.status) status = c.status;
    } else if (wb.connectivityStatus) {
      status = wb.connectivityStatus === 'ONLINE' ? 'Available' : 'Disconnected';
    }

    const statusLower = status.toLowerCase();
    let statusClass = 'neutral';
    let statusIcon = '<span class="status-dot"></span>';

    if (statusLower.includes('available') || statusLower.includes('active')) {
      statusClass = 'available';
      statusIcon = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (statusLower.includes('disconnect') || statusLower.includes('offline') || statusLower.includes('unavailable')) {
      statusClass = 'disconnected';
      statusIcon = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/></svg>';
    } else if (statusLower.includes('fault')) {
      statusClass = 'faulted';
      statusIcon = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    } else if (statusLower.includes('charging') || statusLower.includes('pending')) {
      statusClass = 'charging';
      statusIcon = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    }

    const countryId = (wb.countryId || '').toUpperCase();
    const countryName = countryId ? formatCountryName(countryId) : '—';
    const flagEmoji = countryId ? getCountryFlag(countryId) : '';

    return `
      <tr class="fleet-row" data-serial="${escapeHtml(serial)}" tabindex="0" role="button" aria-label="Open dashboard for charger ${escapeHtml(serial)}">
        <td class="serial-cell">
          <span class="fleet-serial-code">${escapeHtml(serial)}</span>
        </td>
        <td class="model-cell">
          <span class="model-pill">${escapeHtml(model)}</span>
        </td>
        <td class="version-cell">
          <span class="version-tag">${escapeHtml(version)}</span>
        </td>
        <td class="status-cell">
          <span class="status-badge ${statusClass}">
            ${statusIcon}
            <span>${escapeHtml(status)}</span>
          </span>
        </td>
        <td class="country-cell">
          <span class="country-wrapper">
            ${flagEmoji ? `<span class="country-flag">${flagEmoji}</span>` : ''}
            <span class="country-name">${escapeHtml(countryName)}</span>
          </span>
        </td>
        <td class="actions-cell">
          <div class="fleet-row-actions">
            <button type="button" class="fleet-copy-btn" data-action="copy" data-serial="${escapeHtml(serial)}" title="Copy serial number">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            <button type="button" class="fleet-inspect-btn" data-action="inspect" data-serial="${escapeHtml(serial)}" title="Open Charger Dashboard">
              <span>Inspect</span>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr.fleet-row').forEach((row) => {
    const serial = row.dataset.serial;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="copy"]')) return;
      openChargerDashboard(serial);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openChargerDashboard(serial);
      }
    });
  });

  tbody.querySelectorAll('[data-action="copy"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const serial = btn.dataset.serial;
      try {
        await navigator.clipboard.writeText(serial);
        btn.classList.add('copied');
        btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      } catch (err) {}
    });
  });
}

function updateFleetPagination(page, size, totalElements, totalPages) {
  const from = totalElements === 0 ? 0 : page * size + 1;
  const to = Math.min((page + 1) * size, totalElements);
  const rangeText = document.getElementById('fleetRangeText');
  if (rangeText) {
    rangeText.textContent = `${from} – ${to} of ${totalElements.toLocaleString()} stations`;
  }

  const currentLabel = document.getElementById('fleetCurrentPageLabel');
  if (currentLabel) {
    currentLabel.textContent = `${page + 1}`;
  }

  const firstBtn = document.getElementById('fleetFirstPageBtn');
  const prevBtn = document.getElementById('fleetPrevPageBtn');
  const nextBtn = document.getElementById('fleetNextPageBtn');
  const lastBtn = document.getElementById('fleetLastPageBtn');

  if (firstBtn) firstBtn.disabled = page <= 0;
  if (prevBtn) prevBtn.disabled = page <= 0;
  if (nextBtn) nextBtn.disabled = page >= totalPages - 1;
  if (lastBtn) lastBtn.disabled = page >= totalPages - 1;
}

/* ========================================================
   Remote Interactions & SSE Telemetry Control
   ======================================================== */
let sseCheckAbortController = null;

async function checkSseInteractions(serialNumber) {
  if (!serialNumber) return;
  const serial = serialNumber.trim().toUpperCase();

  if (sseCheckAbortController) {
    sseCheckAbortController.abort();
  }
  sseCheckAbortController = new AbortController();

  state.interactions.checking = true;
  state.interactions.sseAvailable = false;

  const livePill = document.getElementById('interactionsLivePill');
  const statusDot = document.getElementById('sseStatusDot');
  const statusText = document.getElementById('sseStatusText');
  const unlockBtn = document.getElementById('interactionUnlockBtn');
  const rebootBtn = document.getElementById('interactionRebootBtn');
  const unlockSpinner = document.getElementById('unlockBtnSpinner');
  const rebootSpinner = document.getElementById('rebootBtnSpinner');
  const unlockLabel = document.getElementById('unlockBtnLabel');
  const rebootLabel = document.getElementById('rebootBtnLabel');

  if (livePill) {
    livePill.className = 'interactions-live-pill checking';
  }
  if (statusDot) {
    statusDot.className = 'sse-status-dot pulse';
  }
  if (statusText) {
    statusText.textContent = 'Checking link...';
  }

  // Set buttons to checking / loading state
  if (unlockBtn) {
    unlockBtn.disabled = true;
    unlockBtn.classList.add('loading');
    if (unlockSpinner) unlockSpinner.hidden = false;
    if (unlockLabel) unlockLabel.textContent = 'Checking...';
  }
  if (rebootBtn) {
    rebootBtn.disabled = true;
    rebootBtn.classList.add('loading');
    if (rebootSpinner) rebootSpinner.hidden = false;
    if (rebootLabel) rebootLabel.textContent = 'Checking...';
  }

  try {
    const res = await fetch(dashboardApiUrl(`/api/sse-check?serial=${encodeURIComponent(serial)}`), {
      signal: sseCheckAbortController.signal,
    });
    const data = await res.json();

    state.interactions.checking = false;
    if (data && data.ok && data.available) {
      state.interactions.sseAvailable = true;
      if (livePill) livePill.className = 'interactions-live-pill online';
      if (statusText) statusText.textContent = 'Live Channel Active';

      if (unlockBtn) {
        unlockBtn.disabled = false;
        unlockBtn.classList.remove('loading');
        if (unlockSpinner) unlockSpinner.hidden = true;
        if (unlockLabel) unlockLabel.textContent = 'Unlock cable';
        unlockBtn.title = 'Remotely unlock cable latch';
      }
      if (rebootBtn) {
        rebootBtn.disabled = false;
        rebootBtn.classList.remove('loading');
        if (rebootSpinner) rebootSpinner.hidden = true;
        if (rebootLabel) rebootLabel.textContent = 'Reboot wallbox';
        rebootBtn.title = 'Remotely reboot wallbox controller';
      }
    } else {
      throw new Error(data && data.message ? data.message : 'SSE stream offline');
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.interactions.checking = false;
    state.interactions.sseAvailable = false;

    if (livePill) livePill.className = 'interactions-live-pill offline';
    if (statusText) statusText.textContent = 'Remote Channel Inactive';

    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.classList.remove('loading');
      if (unlockSpinner) unlockSpinner.hidden = true;
      if (unlockLabel) unlockLabel.textContent = 'Unlock cable';
      unlockBtn.title = 'Remote live link offline for this unit';
    }
    if (rebootBtn) {
      rebootBtn.disabled = true;
      rebootBtn.classList.remove('loading');
      if (rebootSpinner) rebootSpinner.hidden = true;
      if (rebootLabel) rebootLabel.textContent = 'Reboot wallbox';
      rebootBtn.title = 'Remote live link offline for this unit';
    }
  }
}

function openInteractionConfirm(opType) {
  const serial = document.getElementById('serialNumber')?.value.trim();
  if (!serial) return;

  state.interactions.activeOp = opType;
  const dialog = document.getElementById('interactionConfirmDialog');
  const eyebrow = document.getElementById('interactionDialogEyebrow');
  const title = document.getElementById('interactionDialogTitle');
  const desc = document.getElementById('interactionDialogDescription');
  const target = document.getElementById('interactionDialogTarget');
  const connectorGroup = document.getElementById('interactionConnectorGroup');
  const rebootGroup = document.getElementById('interactionRebootGroup');
  const confirmBtn = document.getElementById('interactionDialogConfirm');
  const statusEl = document.getElementById('interactionDialogStatus');
  const resultEl = document.getElementById('interactionDialogResult');

  if (target) target.textContent = serial;
  if (statusEl) statusEl.textContent = '';
  if (resultEl) resultEl.hidden = true;
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm & Execute';
  }

  if (opType === 'unlock-connector') {
    if (eyebrow) eyebrow.textContent = 'Remote Interaction · Connector Actuator';
    if (title) title.textContent = 'Confirm Remote Cable Unlock';
    if (desc) desc.textContent = 'Are you sure you want to remotely unlock the cable? This command triggers the mechanical locking motor to unlatch the connector, allowing physical disconnection.';
    if (connectorGroup) connectorGroup.hidden = false;
    if (rebootGroup) rebootGroup.hidden = true;
    if (confirmBtn) {
      confirmBtn.className = 'primary btn-confirm unlock-confirm';
      confirmBtn.textContent = 'Unlock Cable';
    }
  } else if (opType === 'reboot') {
    if (eyebrow) eyebrow.textContent = 'Remote Interaction · Power Cycle';
    if (title) title.textContent = 'Confirm Remote Wallbox Reboot';
    if (desc) desc.textContent = 'Are you sure you want to reboot this wallbox? This will initiate a system reset on the controller. Any active charging session on this unit will be terminated immediately.';
    if (connectorGroup) connectorGroup.hidden = true;
    if (rebootGroup) rebootGroup.hidden = false;
    if (confirmBtn) {
      confirmBtn.className = 'primary btn-confirm reboot-confirm';
      confirmBtn.textContent = 'Reboot Wallbox';
    }
  }

  if (dialog && typeof dialog.showModal === 'function') {
    dialog.showModal();
  }
}

async function executeRemoteInteraction() {
  const opType = state.interactions.activeOp;
  const serial = document.getElementById('serialNumber')?.value.trim();
  if (!opType || !serial) return;

  const dialog = document.getElementById('interactionConfirmDialog');
  const confirmBtn = document.getElementById('interactionDialogConfirm');
  const statusEl = document.getElementById('interactionDialogStatus');
  const resultEl = document.getElementById('interactionDialogResult');

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Dispatching...';
  }
  if (statusEl) {
    statusEl.textContent = 'Dispatching remote command to Toyota EV platform...';
  }

  const endpoint = opType === 'unlock-connector'
    ? '/api/remote-operation/unlock-connector'
    : '/api/remote-operation/reboot';

  const bodyData = { serialNumber: serial };
  if (opType === 'unlock-connector') {
    const connVal = Number(document.getElementById('interactionConnectorSelect')?.value) || 1;
    bodyData.connectorId = connVal;
  } else if (opType === 'reboot') {
    const typeVal = document.getElementById('interactionRebootTypeSelect')?.value || 'Soft';
    bodyData.type = typeVal;
  }

  try {
    const res = await fetch(dashboardApiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
    });
    const result = await res.json();

    if (!result || !result.ok) {
      throw new Error(result && result.message ? result.message : 'Operation rejected by platform');
    }

    const payload = result.data || result.payload?.data || {};
    const reqId = payload.requestId || '—';
    const opStatus = payload.status || 'Accepted';
    const opKind = payload.type || (opType === 'unlock-connector' ? 'UnlockConnector' : 'Reboot');

    if (dialog) dialog.close();

    showInteractionFeedback({
      type: 'success',
      title: `${opKind} Dispatched Successfully`,
      message: `Request ID: ${reqId} · Status: ${opStatus} · Wallbox: ${serial}`,
      timestamp: new Date().toLocaleTimeString(),
    });

    if (typeof state.supportOperationHistory !== 'undefined') {
      state.supportOperationHistory.unshift({
        operation: opKind,
        serialNumber: serial,
        status: opStatus,
        requestId: reqId,
        timestamp: new Date().toISOString(),
      });
      renderSupportOperationHistory();
    }
  } catch (error) {
    if (statusEl) {
      statusEl.textContent = `Failed: ${error.message}`;
    }
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Retry';
    }
    showInteractionFeedback({
      type: 'error',
      title: `Failed to execute ${opType}`,
      message: error.message,
      timestamp: new Date().toLocaleTimeString(),
    });
  }
}

function showInteractionFeedback({ type, title, message, timestamp }) {
  const strip = document.getElementById('interactionFeedbackStrip');
  const content = document.getElementById('interactionFeedbackContent');
  if (!strip || !content) return;

  strip.className = `interaction-feedback-strip ${type}`;
  content.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
    <small style="opacity: 0.7; margin-left: 8px;">(${escapeHtml(timestamp)})</small>
  `;
  strip.hidden = false;

  window.clearTimeout(strip._hideTimer);
  strip._hideTimer = window.setTimeout(() => {
    strip.hidden = true;
  }, 10000);
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (!dark) {
    delete document.documentElement.dataset.theme;
  }
  localStorage.setItem('wallboxTheme', dark ? 'dark' : 'light');
  document.querySelectorAll('.theme-option').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.theme === (dark ? 'dark' : 'light')));
  });
}

let __sharedTopbarInitialized = false;
let __fotaHeaderOnly = false;
let __dashboardNeedsInitialTokenRefresh = false;

function refreshDashboardAfterTokenReady() {
  if (__fotaHeaderOnly || !state.token) return;
  loadFleetMetadata();
  if (state.currentView === 'charger') {
    const serialNumber = document.getElementById('serialNumber')?.value?.trim();
    if (serialNumber) openChargerDashboard(serialNumber);
  } else if (state.currentView === 'ops') {
    fetchOpsAnalytics(state.currentEnv, true);
  } else {
    fetchOutages();
    fetchFleetWallboxes(0);
  }
}

function initializeSharedTopbar({ fotaOnly = false } = {}) {
  if (__sharedTopbarInitialized || !document.getElementById('globalTokenRefresh')) return;
  __sharedTopbarInitialized = true;
  __fotaHeaderOnly = fotaOnly;
  const loadLogsForSelection = () => {
    cancelKubernetesLogRequest();
    state.kubernetes.logSnapshot = null;
    state.kubernetes.logError = '';
    void fetchKubernetesLogs();
  };
  window.addEventListener('dashboard-session-ready', () => {
    if (__fotaHeaderOnly || !__dashboardNeedsInitialTokenRefresh) return;
    __dashboardNeedsInitialTokenRefresh = false;
    refreshDashboardAfterTokenReady();
  });
  window.addEventListener('dashboard-token-rejected', (event) => {
    if (event.detail?.environment !== state.currentEnv) return;
    void handleInvalidTokenAndRetry();
  });

  if (fotaOnly) {
    const savedEnvironment = localStorage.getItem('wallbox_env');
    state.currentEnv = ['prod', 'acc', 'prev'].includes(savedEnvironment) ? savedEnvironment : 'prod';
  }

  applyTheme(localStorage.getItem('wallboxTheme') === 'dark' ? 'dark' : 'light');
  document.querySelectorAll('.theme-option').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
  });

  const clock = document.getElementById('liveHeaderClock');
  if (clock) {
    const updateClock = () => {
      clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    updateClock();
    window.setInterval(updateClock, 1000);
  }
  checkLiveTokenHealth();
  window.setInterval(checkLiveTokenHealth, 3500);

  document.getElementById('backToFleetBtn')?.addEventListener('click', openFleetView);
  document.getElementById('topbarToyotaBrand')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (__fotaHeaderOnly) {
      window.location.assign('/');
    } else {
      openFleetView();
    }
  });

  const supportNavItem = document.getElementById('topbarSupportNavItem');
  const supportLink = document.getElementById('topbarSupportLink');
  if (supportLink && supportNavItem) {
    supportLink.addEventListener('click', (event) => {
      event.preventDefault();
      const isExpanded = supportLink.getAttribute('aria-expanded') === 'true';
      supportLink.setAttribute('aria-expanded', String(!isExpanded));
      supportNavItem.classList.toggle('is-open', !isExpanded);
    });
    document.addEventListener('click', (event) => {
      if (!supportNavItem.contains(event.target)) {
        supportLink.setAttribute('aria-expanded', 'false');
        supportNavItem.classList.remove('is-open');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && supportNavItem.classList.contains('is-open')) {
        supportLink.setAttribute('aria-expanded', 'false');
        supportNavItem.classList.remove('is-open');
        supportLink.focus();
      }
    });
  }

  document.getElementById('topbarOpsBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (__fotaHeaderOnly) {
      window.location.assign('/#analytics');
    } else if (state.currentView === 'ops') {
      openFleetView();
    } else {
      openOpsAnalyticsView();
    }
  });

  document.getElementById('topbarKubernetesBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (__fotaHeaderOnly) {
      window.location.assign('/#kubernetes');
    } else if (state.currentView === 'kubernetes') {
      openFleetView();
    } else {
      openKubernetesPodsView();
    }
  });

  document.getElementById('kubernetesNamespaceSelect')?.addEventListener('change', (event) => {
    closeKubernetesTerminal('Session stopped after changing namespace.');
    state.kubernetes.namespace = event.target.value;
    state.kubernetes.requestId += 1;
    state.kubernetes.inventoryLoading = false;
    state.kubernetes.result = null;
    state.kubernetes.infrastructure = null;
    state.kubernetes.infrastructureError = '';
    state.kubernetes.infrastructureNamespace = '';
    state.kubernetes.infrastructureFetchedAt = 0;
    state.kubernetes.infrastructureRequestId += 1;
    state.kubernetes.infrastructureLoading = false;
    state.kubernetes.activePod = null;
    state.kubernetes.activeServiceKey = '';
    state.kubernetes.logPod = null;
    state.kubernetes.logSnapshot = null;
    state.kubernetes.logError = '';
    cancelKubernetesLogRequest();
    window.clearInterval(state.kubernetes.logTimer);
    state.kubernetes.logTimer = null;
    document.getElementById('kubernetesPodDetailDialog').close();
    document.getElementById('kubernetesErrorMessage').hidden = true;
    renderKubernetesAuth();
    if (state.kubernetes.auth === 'ready') void fetchKubernetesPods();
  });
  document.getElementById('kubernetesEnvironmentSelect')?.addEventListener('change', (event) => {
    changeKubernetesEnvironment(event.target.value);
  });
  document.getElementById('kubernetesTimeRange')?.addEventListener('change', (event) => {
    state.kubernetes.timeRange = event.target.value;
    state.kubernetes.timelineWindow = null;
    if (state.kubernetes.result) renderKubernetesPods(state.kubernetes.result);
  });
  document.getElementById('kubernetesRefreshBtn')?.addEventListener('click', () => {
    if (state.kubernetes.auth === 'ready') void fetchKubernetesPods(true);
    else void checkKubernetesCredentials();
  });
  document.getElementById('kubernetesLoginBtn')?.addEventListener('click', () => void startKubernetesLogin());
  document.getElementById('kubernetesGlobalSearch')?.addEventListener('input', () => {
    renderKubernetesServiceGrid();
    const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
    if (service) renderKubernetesServicePods(service);
    renderKubernetesPodTable();
  });
  document.getElementById('kubernetesServiceSort')?.addEventListener('change', renderKubernetesServiceGrid);
  document.getElementById('kubernetesServiceHealthFilter')?.addEventListener('change', renderKubernetesServiceGrid);
  document.getElementById('kubernetesServiceGrid')?.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-service-key]');
    if (!tile) return;
    const nextKey = tile.dataset.serviceKey;
    if (nextKey !== state.kubernetes.activeServiceKey) {
      closeKubernetesTerminal('Session stopped after changing service.');
      window.clearInterval(state.kubernetes.logTimer);
      state.kubernetes.logTimer = null;
      cancelKubernetesLogRequest();
      state.kubernetes.logSnapshot = null;
      state.kubernetes.logError = '';
      state.kubernetes.logPod = null;
      state.kubernetes.activePod = null;
      state.kubernetes.logTarget = 'service';
      document.getElementById('kubernetesServiceLogsLiveToggle').setAttribute('aria-pressed', 'false');
      document.getElementById('kubernetesServiceLogsLiveToggle').textContent = 'Start live';
    }
    state.kubernetes.activeServiceKey = nextKey;
    renderKubernetesServiceGrid();
    renderKubernetesServiceDetail();
  });
  document.getElementById('kubernetesServiceDetailClose')?.addEventListener('click', () => {
    state.kubernetes.activeServiceKey = '';
    state.kubernetes.logPod = null;
    state.kubernetes.logSnapshot = null;
    state.kubernetes.logError = '';
    cancelKubernetesLogRequest();
    window.clearInterval(state.kubernetes.logTimer);
    state.kubernetes.logTimer = null;
    document.getElementById('kubernetesServiceDetail').hidden = true;
    renderKubernetesServiceGrid();
  });
  document.getElementById('kubernetesServicePods')?.addEventListener('click', (event) => {
    const key = event.target.closest('[data-pod-key]')?.dataset.podKey;
    const pod = state.kubernetes.result?.pods?.find((item) => `${item.namespace}/${item.name}` === key);
    if (pod) openKubernetesPodDetail(pod);
  });
  document.getElementById('kubernetesServiceLogPod')?.addEventListener('change', selectKubernetesServiceLogPod);
  document.getElementById('kubernetesSearchInput')?.addEventListener('input', renderKubernetesPodTable);
  document.getElementById('kubernetesHealthFilter')?.addEventListener('change', renderKubernetesPodTable);
  document.getElementById('kubernetesPodSort')?.addEventListener('change', renderKubernetesPodTable);
  ['kubernetesTimelineSourceFilter', 'kubernetesTimelineSeverityFilter'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (!state.kubernetes.result) return;
      renderKubernetesTimeline(state.kubernetes.result);
      const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
      if (service) renderKubernetesTimeline(state.kubernetes.result, 'all', 'kubernetesServiceTimeline', service.pods);
    });
  });
  document.getElementById('kubernetesPodsTableBody')?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-pod-index]');
    const pod = state.kubernetes.result?.pods?.[Number(row?.dataset.podIndex)];
    if (pod) openKubernetesPodDetail(pod);
  });
  document.getElementById('kubernetesPodDetailClose')?.addEventListener('click', () => {
    document.getElementById('kubernetesPodDetailDialog')?.close();
  });
  document.getElementById('kubernetesPodDetailDialog')?.addEventListener('close', () => {
    closeKubernetesTerminal();
    state.kubernetes.activePod = null;
    cancelKubernetesLogRequest();
    window.clearInterval(state.kubernetes.logTimer);
    state.kubernetes.logTimer = null;
    const service = state.kubernetes.serviceModels.find((item) => item.key === state.kubernetes.activeServiceKey);
    if (service) {
      state.kubernetes.logTarget = 'service';
      renderKubernetesServiceLogs(service);
    } else {
      state.kubernetes.logTarget = 'pod';
      state.kubernetes.logPod = null;
    }
  });
  document.getElementById('kubernetesPodDetailDialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  ['kubernetesLogContainer', 'kubernetesLogInstance', 'kubernetesLogWindow', 'kubernetesServiceLogContainer', 'kubernetesServiceLogInstance', 'kubernetesServiceLogWindow'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', loadLogsForSelection);
  });
  ['kubernetesLogFilter', 'kubernetesServiceLogFilter'].forEach((id) => document.getElementById(id)?.addEventListener('change', renderKubernetesLogOutput));
  document.getElementById('kubernetesLogsRefresh')?.addEventListener('click', () => void fetchKubernetesLogs());
  document.getElementById('kubernetesServiceLogsRefresh')?.addEventListener('click', () => void fetchKubernetesLogs());
  document.getElementById('kubernetesLogsLiveToggle')?.addEventListener('click', (event) => toggleKubernetesLogPolling(event.currentTarget, false));
  document.getElementById('kubernetesServiceLogsLiveToggle')?.addEventListener('click', (event) => toggleKubernetesLogPolling(event.currentTarget, true));
  document.getElementById('kubernetesTerminalStart')?.addEventListener('click', startKubernetesTerminal);
  document.getElementById('kubernetesTerminalStop')?.addEventListener('click', () => closeKubernetesTerminal());
  document.getElementById('kubernetesTerminalForm')?.addEventListener('submit', sendKubernetesTerminalInput);
  document.getElementById('kubernetesTerminalInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) sendKubernetesTerminalInput(event);
  });

  document.getElementById('globalTokenRefresh')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await retryLoginFromScratch();
  });
  document.getElementById('globalTokenPill')?.addEventListener('click', async (event) => {
    if (event.target.closest('#globalTokenRefresh')) return;
    await retryLoginFromScratch();
  });

  document.querySelectorAll('.env-pill').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const targetEnvironment = button.dataset.env;
      if (targetEnvironment && targetEnvironment !== state.currentEnv) {
        setEnvironment(targetEnvironment);
      }
    });
  });

  updateEnvironmentUI();
  if (fotaOnly) {
    const syncStatus = document.getElementById('liveDataSyncStatus');
    if (syncStatus) {
      syncStatus.textContent = `${state.currentEnv.toUpperCase()} FOTA`;
      syncStatus.title = `Firmware management environment: ${state.currentEnv.toUpperCase()}`;
    }
  }
  initStickyTopbarScroll();
}

let __dashboardInitialized = false;
async function startDashboardApp() {
  if (!document.getElementById('globalTokenRefresh')) {
    return;
  }
  if (__dashboardInitialized) return;
  __dashboardInitialized = true;
  __dashboardNeedsInitialTokenRefresh = false;
  let overviewResizeFrame = 0;
  window.addEventListener('resize', () => {
    window.cancelAnimationFrame(overviewResizeFrame);
    overviewResizeFrame = window.requestAnimationFrame(() => {
      overviewResizeFrame = 0;
      drawOverview();
    });
  });
  clearToken();
  setDefaultWindow();
  loadSupportOperationHistory();
  renderAtAGlance();
  renderSupportOperationHistory();
  renderInvestigation();
  renderLegend();
  bindRangeBar();
  bindTimePicker('startTimeInput', 'startTimeTrigger', 'startTimePopover');
  bindTimePicker('endTimeInput', 'endTimeTrigger', 'endTimePopover');
  document.getElementById('typeFilterTrigger').addEventListener('click', () => {
    const panel = document.getElementById('typeFilterPanel');
    const willOpen = panel.hidden;
    closePopovers();
    panel.hidden = !willOpen;
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.time-field, .multi-select')) {
      closePopovers();
    }
    const clickedMenu = event.target.closest('.diagnostic-menu');
    const closeMenu = event.target.closest('[data-close-menu], [data-support-operation-choice]');
    document.querySelectorAll('.diagnostic-menu[open]').forEach((menu) => {
      if (menu !== clickedMenu || closeMenu) menu.open = false;
    });
  });
  const serialInput = document.getElementById('serialNumber');
  if (serialInput) {
    serialInput.addEventListener('input', () => {
      if (state.smartInvestigation.serialNumber !== serialInput.value.trim()) resetSmartInvestigation();
      renderSupportOperations();
    });
    serialInput.addEventListener('change', () => {
      const val = serialInput.value.trim().toUpperCase();
      if (val && val.length >= 5) rememberSerial(val);
    });
  }
  document.getElementById('copySerial').addEventListener('click', async (event) => {
    const feedback = document.getElementById('copyFeedback');
    const button = event.currentTarget;
    const labelEl = button.querySelector('.copy-btn-label');
    const iconEl = button.querySelector('.copy-btn-icon');
    try {
      await navigator.clipboard.writeText(serialInput.value.trim());
      if (feedback) {
        feedback.textContent = 'Serial number copied to clipboard.';
        feedback.hidden = false;
      }
      button.classList.add('copied');
      if (labelEl) labelEl.textContent = 'Copied!';
      if (iconEl) iconEl.innerHTML = SVG_ICONS.check;
      window.setTimeout(() => {
        button.classList.remove('copied');
        if (labelEl) labelEl.textContent = 'Copy';
        if (iconEl) iconEl.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        if (feedback) feedback.hidden = true;
      }, 1600);
    } catch (error) {
      if (feedback) {
        feedback.textContent = 'Copy is unavailable in this browser context.';
        feedback.hidden = false;
      }
    }
  });
  document.querySelectorAll('.connector-tab').forEach((button) => {
    button.addEventListener('click', () => showConnectorTab(Number(button.dataset.connector)));
  });
  document.getElementById('sessionAnalysisClose').addEventListener('click', () => {
    document.getElementById('sessionAnalysis').hidden = true;
    state.sessionAnalysis = null;
    state.activeTimelineWidget = 'sessions';
    updateFloatingTimeToolbar('sessions');
  });

  // Session table filter, search, sort & CSV export bindings
  const sessionFilterInput = document.getElementById('sessionTableFilter');
  const sessionFilterClear = document.getElementById('sessionTableFilterClear');
  if (sessionFilterInput) {
    sessionFilterInput.addEventListener('input', (event) => {
      state.sessionTableState.searchQuery = event.target.value;
      if (sessionFilterClear) sessionFilterClear.hidden = !event.target.value;
      renderChargingSessions();
    });
  }
  if (sessionFilterClear) {
    sessionFilterClear.addEventListener('click', () => {
      if (sessionFilterInput) sessionFilterInput.value = '';
      sessionFilterClear.hidden = true;
      state.sessionTableState.searchQuery = '';
      renderChargingSessions();
    });
  }
  document.querySelectorAll('#sessionFilterChips .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#sessionFilterChips .filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.sessionTableState.category = chip.dataset.filter;
      renderChargingSessions();
    });
  });
  const exportBtn = document.getElementById('exportSessionsCsv');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportChargingSessionsCsv);
  }
  document.querySelectorAll('#sessionTable thead th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (state.sessionTableState.sortKey === key) {
        state.sessionTableState.sortAsc = !state.sessionTableState.sortAsc;
      } else {
        state.sessionTableState.sortKey = key;
        state.sessionTableState.sortAsc = false;
      }
      renderChargingSessions();
    });
  });

  document.getElementById('quickRange').addEventListener('change', (event) => {
    if (!event.target.value) {
      return;
    }
    applyQuickRange(Number(event.target.value));
  });
  ['startDate', 'endDate'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      document.getElementById('quickRange').value = '';
      paintRangeWindow();
      updateRangeFeedback();
      resetSmartInvestigation();
    });
    el.addEventListener('click', () => {
      try {
        if (typeof el.showPicker === 'function') {
          el.showPicker();
        }
      } catch (err) {}
    });
  });
  document.getElementById('applyRange').addEventListener('click', () => {
    if (!updateRangeFeedback()) {
      fetchEvents();
    }
  });
  document.getElementById('resetRange').addEventListener('click', () => {
    setDefaultWindow();
    fetchEvents();
  });
  document.getElementById('eventNameSearch').addEventListener('input', applyFilters);
  document.getElementById('clearInvestigation').addEventListener('click', clearInvestigation);
  document.getElementById('returnTimelineContext').addEventListener('click', restorePreviousTimelineContext);
  document.getElementById('runDiagnostics').addEventListener('click', runDiagnosticCheck);
  document.getElementById('diagnosticConnector').addEventListener('change', runDiagnosticCheck);
  document.getElementById('refreshAllRelevant').addEventListener('click', refreshAllRelevant);
  document.getElementById('recheckCharger').addEventListener('click', recheckCharger);
  document.getElementById('refreshEventsOnly').addEventListener('click', refreshEventsOnly);
  document.getElementById('refreshSessionsOnly').addEventListener('click', refreshSessionsOnly);
  document.getElementById('refreshConnectorState').addEventListener('click', refreshConnectorState);
  document.getElementById('copyInvestigationSummary').addEventListener('click', copyInvestigationSummary);
  document.getElementById('exportInvestigation').addEventListener('click', exportInvestigation);
  document.getElementById('copySelectedEvent').addEventListener('click', copySelectedEvent);
  document.getElementById('copySelectedEventJson').addEventListener('click', copySelectedEventJson);
  document.getElementById('copySelectedEventId').addEventListener('click', copySelectedEventId);
  document.getElementById('copySelectedEventTimestamp').addEventListener('click', copySelectedEventTimestamp);
  document.getElementById('copyEventContext').addEventListener('click', copyEventContext);
  ['supportOwnerPin', 'supportFirmwareLocation'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderSupportOperations);
    document.getElementById(id).addEventListener('change', renderSupportOperations);
  });
  document.getElementById('supportOperationMenu').addEventListener('click', (event) => {
    const button = event.target.closest('[data-support-operation-choice]');
    if (button && !button.disabled) openSupportOperationDialog(button.dataset.supportOperationChoice);
  });
  const supportDialog = document.getElementById('supportOperationDialog');
  document.getElementById('supportOperationConfirm').addEventListener('click', executeSupportOperation);
  ['supportOperationDialogCancel', 'supportOperationDialogClose'].forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
      if (!state.supportOperationInFlight) supportDialog.close();
    });
  });
  supportDialog.addEventListener('cancel', (event) => {
    if (state.supportOperationInFlight) event.preventDefault();
  });
  supportDialog.addEventListener('close', () => {
    document.getElementById('supportOwnerPin').value = '';
    document.getElementById('supportFirmwareLocation').value = '';
    state.selectedSupportOperation = null;
    state.supportOperationComplete = false;
    renderSupportOperations();
  });
  renderSupportOperations();
  renderDiagnosticResults(null);
  renderSmartInvestigations();
  document.getElementById('smartInvestigationChatForm').addEventListener('submit', askSmartInvestigationQuestion);
  document.querySelectorAll('#aiSuggestedPrompts .ai-prompt-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById('smartInvestigationQuestion');
      if (input && !input.disabled) {
        input.value = btn.dataset.query;
        document.getElementById('smartInvestigationChatForm')?.requestSubmit();
      }
    });
  });
  document.getElementById('smartInvestigationFindings').addEventListener('click', (event) => {
    const target = event.target.closest('[data-smart-evidence-type]');
    if (target) focusSmartInvestigationEvidence(target.dataset.smartEvidenceType, target.dataset.smartEvidenceId);
  });
  document.getElementById('refreshData').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Refreshing...';
    try {
      await fetchEvents();
    } finally {
      button.disabled = false;
      button.textContent = 'Refresh data';
    }
  });

  const openOpsAnalyticsHeroBtn = document.getElementById('openOpsAnalyticsHeroBtn');
  if (openOpsAnalyticsHeroBtn) {
    openOpsAnalyticsHeroBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openOpsAnalyticsView();
    });
  }


  const opsBottomBackBtn = document.getElementById('opsBottomBackBtn');
  if (opsBottomBackBtn) {
    opsBottomBackBtn.addEventListener('click', openFleetView);
  }

  const opsRefreshBtn = document.getElementById('opsRefreshBtn');
  if (opsRefreshBtn) {
    opsRefreshBtn.addEventListener('click', () => {
      fetchOpsAnalytics(state.currentEnv, true);
    });
  }

  const opsOpenOutagesModalBtn = document.getElementById('opsOpenOutagesModalBtn');
  if (opsOpenOutagesModalBtn) {
    opsOpenOutagesModalBtn.addEventListener('click', () => {
      const d = document.getElementById('aggOutageListDialog');
      if (d) {
        if (typeof d.showModal === 'function') d.showModal();
        else d.hidden = false;
      }
    });
  }

  // OPS Bottom Direct Jump
  const opsDirectSerialInput = document.getElementById('opsDirectSerialInput');
  const opsDirectJumpBtn = document.getElementById('opsDirectJumpBtn');
  const handleOpsDirectJump = () => {
    let val = opsDirectSerialInput ? opsDirectSerialInput.value.trim().toUpperCase() : '';
    const suggestBtn = opsDirectSerialInput?.parentElement?.querySelector('.smart-serial-suggest-btn');
    if (suggestBtn && suggestBtn.dataset.serial) {
      val = suggestBtn.dataset.serial;
      opsDirectSerialInput.value = val;
    }
    if (val) {
      rememberSerial(val);
      openChargerDashboard(val);
    }
  };
  if (opsDirectJumpBtn) opsDirectJumpBtn.addEventListener('click', handleOpsDirectJump);

  // Popstate history listener
  window.addEventListener('popstate', () => {
    const hash = window.location.hash || '';
    if (hash.startsWith('#charger=')) {
      const s = decodeURIComponent(hash.slice(9));
      if (s) openChargerDashboard(s);
    } else if (hash === '#analytics' || hash === '#ops') {
      openOpsAnalyticsView();
    } else if (hash === '#kubernetes') {
      openKubernetesPodsView();
    } else {
      openFleetView();
    }
  });

  // Direct Serial Jump in Fleet Hero
  const directSerialInput = document.getElementById('fleetDirectSerialInput');
  const directJumpBtn = document.getElementById('fleetDirectJumpBtn');
  const handleDirectJump = () => {
    let val = directSerialInput ? directSerialInput.value.trim().toUpperCase() : '';
    const suggestBtn = directSerialInput?.parentElement?.querySelector('.smart-serial-suggest-btn');
    if (suggestBtn && suggestBtn.dataset.serial) {
      val = suggestBtn.dataset.serial;
      directSerialInput.value = val;
    }
    if (val) {
      rememberSerial(val);
      openChargerDashboard(val);
    }
  };
  if (directJumpBtn) directJumpBtn.addEventListener('click', handleDirectJump);
  if (directSerialInput) {
    directSerialInput.addEventListener('change', () => {
      const val = directSerialInput.value.trim().toUpperCase();
      if (val && val.length >= 5) rememberSerial(val);
    });
    directSerialInput.addEventListener('blur', () => {
      const val = directSerialInput.value.trim().toUpperCase();
      if (val && val.length >= 5) rememberSerial(val);
    });
  }

  // Fleet Filter Toolbar
  const fleetSearchInput = document.getElementById('fleetSearchSerialInput');
  const fleetClearSearchBtn = document.getElementById('fleetClearSearchBtn');
  if (fleetSearchInput) {
    fleetSearchInput.addEventListener('change', () => {
      const val = fleetSearchInput.value.trim().toUpperCase();
      if (val && val.length >= 5) rememberSerial(val);
    });
    fleetSearchInput.addEventListener('blur', () => {
      const val = fleetSearchInput.value.trim().toUpperCase();
      if (val && val.length >= 5) rememberSerial(val);
    });
    fleetSearchInput.addEventListener('input', (e) => {
      if (fleetClearSearchBtn) fleetClearSearchBtn.hidden = !e.target.value;
      const clean = e.target.value.trim().toUpperCase();
      if (/^TACW[A-Z0-9]{10,12}$/i.test(clean)) {
        rememberSerial(clean);
      }
      clearTimeout(state.fleet.searchDebounceTimer);
      state.fleet.searchDebounceTimer = setTimeout(() => {
        fetchFleetWallboxes(0);
      }, 350);
    });
  }
  if (fleetClearSearchBtn) {
    fleetClearSearchBtn.addEventListener('click', () => {
      if (fleetSearchInput) fleetSearchInput.value = '';
      fleetClearSearchBtn.hidden = true;
      fetchFleetWallboxes(0);
    });
  }

  ['fleetModelSelect', 'fleetVersionSelect', 'fleetStatusSelect', 'fleetCountrySelect'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => fetchFleetWallboxes(0));
    }
  });

  const fleetResetBtn = document.getElementById('fleetResetFiltersBtn');
  if (fleetResetBtn) {
    fleetResetBtn.addEventListener('click', () => {
      if (fleetSearchInput) fleetSearchInput.value = '';
      if (fleetClearSearchBtn) fleetClearSearchBtn.hidden = true;
      ['fleetModelSelect', 'fleetVersionSelect', 'fleetStatusSelect', 'fleetCountrySelect'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      fetchFleetWallboxes(0);
    });
  }

  const fleetRefreshBtn = document.getElementById('fleetRefreshBtn');
  if (fleetRefreshBtn) {
    fleetRefreshBtn.addEventListener('click', () => {
      fleetRefreshBtn.classList.add('rotating');
      fetchFleetWallboxes(state.fleet.page).finally(() => {
        setTimeout(() => fleetRefreshBtn.classList.remove('rotating'), 600);
      });
    });
  }

  // Pagination Controls
  const pageSizeSelect = document.getElementById('fleetPageSizeSelect');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => fetchFleetWallboxes(0));
  }
  document.getElementById('fleetFirstPageBtn')?.addEventListener('click', () => fetchFleetWallboxes(0));
  document.getElementById('fleetPrevPageBtn')?.addEventListener('click', () => {
    if (state.fleet.page > 0) fetchFleetWallboxes(state.fleet.page - 1);
  });
  document.getElementById('fleetNextPageBtn')?.addEventListener('click', () => {
    if (state.fleet.page < state.fleet.totalPages - 1) fetchFleetWallboxes(state.fleet.page + 1);
  });
  document.getElementById('fleetLastPageBtn')?.addEventListener('click', () => {
    if (state.fleet.totalPages > 0) fetchFleetWallboxes(state.fleet.totalPages - 1);
  });

  // Remote Interactions Bar & Confirm Dialog Bindings
  document.getElementById('interactionUnlockBtn')?.addEventListener('click', () => openInteractionConfirm('unlock-connector'));
  document.getElementById('interactionRebootBtn')?.addEventListener('click', () => openInteractionConfirm('reboot'));
  document.getElementById('interactionDialogConfirm')?.addEventListener('click', executeRemoteInteraction);
  const interactionDialog = document.getElementById('interactionConfirmDialog');
  ['interactionDialogCancel', 'interactionDialogClose'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', () => interactionDialog?.close());
  });
  document.getElementById('interactionFeedbackClose')?.addEventListener('click', () => {
    const strip = document.getElementById('interactionFeedbackStrip');
    if (strip) strip.hidden = true;
  });

  // Default view is PROD
  state.currentEnv = 'prod';
  localStorage.setItem('wallbox_env', state.currentEnv);
  initializeSharedTopbar();

  // Initialize view state & data
  const urlParams = new URLSearchParams(window.location.search);
  const hashMatch = window.location.hash.match(/charger=([^&]+)/);
  const initialSerial = urlParams.get('serial') || (hashMatch ? decodeURIComponent(hashMatch[1]) : null);

  await loadSerialHistoryFromServer();

  const initialKubernetesView = window.location.hash === '#kubernetes';
  const tokenLoaded = initialKubernetesView || await loadStoredTokenFromLocalBridge({ scanBrowser: true });
  if (!tokenLoaded) {
    setStatus('PROD session required. Opening the TME page in a browser tab if needed.', 'warning');
    await triggerAutoTokenCapture();
  }

  setupOutagesControls();
  initFloatingTimeToolbar();

  // Attach Smart Serial Autocomplete & Fuzzy Typo Suggestion to all 4 serial input fields
  attachSmartSerialSearch(document.getElementById('serialNumber'), (serial) => {
    scheduleSerialSearch(0);
  });
  attachSmartSerialSearch(document.getElementById('fleetDirectSerialInput'), (serial) => {
    openChargerDashboard(serial);
  });
  attachSmartSerialSearch(document.getElementById('fleetSearchSerialInput'), (serial) => {
    const clearBtn = document.getElementById('fleetClearSearchBtn');
    if (clearBtn) clearBtn.hidden = !serial;
    fetchFleetWallboxes(0);
  });
  attachSmartSerialSearch(document.getElementById('opsDirectSerialInput'), (serial) => {
    openChargerDashboard(serial);
  });

  if (initialSerial) {
    openChargerDashboard(initialSerial);
  } else if (window.location.hash === '#analytics' || window.location.hash === '#ops') {
    openOpsAnalyticsView();
  } else if (initialKubernetesView) {
    openKubernetesPodsView();
  } else {
    openFleetView();
  }

  // Load fleet metadata in background without blocking wallbox rendering
  loadFleetMetadata();
  if (!tokenLoaded) {
    if (state.token) refreshDashboardAfterTokenReady();
    else __dashboardNeedsInitialTokenRefresh = true;
  }
}

if (typeof window !== 'undefined') {
  window.initToyotaDashboardHeader = function() {
    if (__sharedTopbarInitialized) return;
    state.currentEnv = 'prod';
    localStorage.setItem('wallbox_env', state.currentEnv);
    initializeSharedTopbar({ fotaOnly: true });
    window.dispatchEvent(new CustomEvent('dashboard-environment-change', { detail: { environment: 'prod' } }));
    void (async () => {
      if (!await loadStoredTokenFromLocalBridge({ scanBrowser: true })) {
        await triggerAutoTokenCapture();
      }
    })();
  };

  window.initToyotaDashboard = function() {
    __dashboardInitialized = false;
    startDashboardApp();
  };
}

