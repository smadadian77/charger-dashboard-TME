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
  allEvents: [],
  filteredEvents: [],
  selectedEventId: null,
  wallbox: null,
  access: null,
  smartCharging: null,
  tariff: null,
  channelInfo: null,
  activeChargingLimit: '',
  chargingSessions: [],
  timeline: null,
  connectorTimeline: null,
  connectorIntervalsById: null,
  activeConnector: 1,
  syncingRange: false,
  msalApp: null,
  tokenRefreshInProgress: false,
};

const typeColors = {
  CHARGER_CONFIGURATION: '#2563eb',
  CHARGING_SESSION_DATA: '#16a34a',
  CHARGER_STATUS_DATA: '#f97316',
  RFID_CARD_MANAGEMENT: '#db2777',
  SUPPORT_INTERVENTION: '#dc2626',
  THIRD_PARTY_INTEGRATION: '#ca8a04',
  SMART_CHARGING: '#7c3aed',
  UNKNOWN: '#57534e',
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
  banner.textContent = message;
  banner.className = `status-banner ${level}`;
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
    return false;
  }

  const expSeconds = Number(payload.exp);
  if (!Number.isFinite(expSeconds)) {
    return false;
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

  const audience = payload.aud;
  if (audience === '00000003-0000-0000-c000-000000000000' || audience === 'https://graph.microsoft.com') {
    return false;
  }

  return Boolean(payload.exp || payload.iat);
}

function formatApiError(result) {
  const raw = result && typeof result === 'object' ? result.details || result.message || '' : '';
  let message = typeof raw === 'string' ? raw : '';

  try {
    if (message && message.startsWith('{')) {
      const parsed = JSON.parse(message);
      if (parsed && parsed.message) {
        message = parsed.message;
      }
    }
  } catch (error) {
    // Ignore parse errors and keep the original message.
  }

  const text = `${message || ''} ${result && result.message ? result.message : ''}`.toLowerCase();
  if (text.includes('unauthorized') || text.includes('token') || text.includes('pkey:verify') || text.includes('expired')) {
    return 'The token is invalid or expired. A fresh TME session is being requested automatically.';
  }

  return result && result.message ? result.message : 'The API request failed. Check the serial number, size, and token.';
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
    <span class="legend-item">
      <span class="legend-swatch" style="background:${typeColors[type] || typeColors.Unknown};"></span>
      ${label}
    </span>
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

function applyFilters() {
  const selectedTypes = getSelectedTypeValues();
  const searchText = document.getElementById('eventNameSearch').value.trim().toLowerCase();
  const window = selectedWindow();
  if (!Number.isNaN(window.start) && !Number.isNaN(window.end)) {
    state.eventBounds = window;
  }

  state.filteredEvents = state.allEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    const matchesWindow = Number.isNaN(window.start) || Number.isNaN(window.end) || (time >= window.start && time <= window.end);
    const matchesType = selectedTypes.includes('all') || selectedTypes.includes(event.type);
    const matchesSearch = !searchText || event.eventName.toLowerCase().includes(searchText);
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
    const color = type === 'all' ? '#111827' : (typeColors[type] || typeColors.UNKNOWN);
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
  { id: 'Preparing', color: '#8b5cf6' },
  { id: 'Charging', color: '#eab308' },
  { id: 'SuspendedEV', color: '#f59e0b' },
  { id: 'SuspendedEVSE', color: '#f97316' },
  { id: 'Finishing', color: '#facc15' },
  { id: 'Faulted', color: '#ef4444' },
  { id: 'Disconnected', color: '#9ca3af' },
];

const CONNECTOR_ZERO_STATES = [
  { id: 'Faulted', color: '#ef4444' },
  { id: 'Available', color: '#22c55e' },
  { id: 'Unavailable', color: '#b45309' },
  { id: 'Disconnected', color: '#9ca3af' },
  { id: 'ActivationPending', label: 'Activation Pending', color: '#2563eb' },
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

function connectorIntervals(events, connectorId = 1) {
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

  const queryEnd = new Date(combineDateTime(
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
  if (notify && state.timeline && state.timeline._range && !state.syncingRange) {
    state.timeline._range({ start: new Date(nextStart), end: new Date(nextEnd) });
  }
}

function selectEvent(eventId) {
  state.selectedEventId = String(eventId);
  const selectedEvent = state.filteredEvents.find((event) => String(event.id) === String(eventId));
  if (selectedEvent) {
    document.getElementById('detailPane').textContent = JSON.stringify(selectedEvent.raw, null, 2);
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
  const width = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
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
  timedEvents(state.filteredEvents).forEach((item) => {
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

function bindOverview(root, tipForTime) {
  const track = (root || document).querySelector('.overview-track');
  if (!track || track.dataset.bound === 'true') {
    return;
  }
  track.dataset.bound = 'true';
  const cursor = track.querySelector('.overview-cursor');
  const tip = track.querySelector('.overview-tip');
  const brush = track.querySelector('.overview-brush');

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

  track.addEventListener('mousemove', (event) => {
    if (!state.eventBounds) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const time = overviewTime(event.clientX, rect);
    const tipText = tipForTime ? tipForTime(time) : formatExact(time);
    const dragStart = state.overviewDrag && state.overviewDrag.track === track ? state.overviewDrag.x : null;
    if (dragStart == null) {
      showTip(event.clientX, event.clientY, tipText);
      return;
    }
    const left = Math.min(dragStart, event.clientX);
    const right = Math.max(dragStart, event.clientX);
    const startTime = overviewTime(left, rect);
    const endTime = overviewTime(right, rect);
    brush.hidden = false;
    brush.style.left = `${left - rect.left}px`;
    brush.style.width = `${Math.max(1, right - left)}px`;
    placeStartLabel(brush.querySelector('.overview-window-start'), startTime);
    showTip(event.clientX, event.clientY, tipText);
    setOverviewSummary(startTime, endTime);
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
    state.overviewDrag = { x: event.clientX, track, brush, cursor, tip };
    brush.hidden = false;
    brush.style.left = `${event.clientX - track.getBoundingClientRect().left}px`;
    brush.style.width = '1px';
  });

  if (!state.overviewMouseUp) {
    state.overviewMouseUp = (event) => {
      const drag = state.overviewDrag;
      if (!drag || !state.eventBounds) {
        return;
      }
      const rect = drag.track.getBoundingClientRect();
      const start = overviewTime(Math.min(drag.x, event.clientX), rect);
      const end = overviewTime(Math.max(drag.x, event.clientX), rect);
      state.overviewDrag = null;
      drag.brush.hidden = true;
      drag.cursor.hidden = true;
      drag.tip.hidden = true;
      if (end - start < 1000) {
        setEventView(start - 60 * 1000, start + 60 * 1000);
        return;
      }
      setEventView(start, end);
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

  if (!records.length) {
    if (state.eventBounds) {
      state.eventView = { ...state.eventBounds };
    }
    container.innerHTML = '<div class="empty-state">No data to display.</div>';
    if (overview) overview.innerHTML = '';
    if (legend) legend.innerHTML = '';
    const label = document.getElementById('timelineWindow');
    if (label) label.textContent = 'No events in this filter';
    return;
  }

  if (!state.eventBounds) {
    state.eventBounds = eventBounds(records);
  }
  state.eventView = { ...state.eventBounds };
  const types = Array.from(new Set(records.map((event) => event.type)));
  if (legend) {
    legend.innerHTML = types.map((type) => `
      <span class="legend-item"><span class="legend-swatch" style="background:${typeColors[type] || typeColors.UNKNOWN};"></span>${escapeHtml(typeLabels[type] || type)}</span>
    `).join('');
  }

  overview.innerHTML = `
    <div class="overview-scale"><span>${escapeHtml(formatExact(state.eventBounds.start))}</span><strong class="overview-duration"></strong><span>${escapeHtml(formatExact(state.eventBounds.end))}</span></div>
    <div class="overview-track">
      <canvas id="overviewCanvas"></canvas>
      <div id="overviewWindow" class="overview-window"><span class="overview-window-start"></span></div>
      <div class="overview-cursor" hidden></div>
      <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
      <div class="overview-tip" hidden></div>
    </div>
  `;
  bindOverview(overview);

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
    const rect = plot.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const span = state.eventView.end - state.eventView.start;
    const next = Math.min(Math.max(span * (event.deltaY > 0 ? 1.3 : 0.75), 15 * 1000), state.eventBounds.end - state.eventBounds.start);
    const anchor = state.eventView.start + ratio * span;
    setEventView(anchor - ratio * next, anchor + (1 - ratio) * next);
  }, { passive: false });

  let panStart = null;
  plot.addEventListener('mousedown', (event) => {
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
    fitButton.onclick = () => setEventView(state.eventBounds.start, state.eventBounds.end);
  }
  setEventView(state.eventBounds.start, state.eventBounds.end, false);
}

function connectorColor(status, connectorId = 1) {
  return connectorStateList(connectorId).find((item) => item.id === status)?.color || '#57534e';
}

function connectorStateLabel(item) {
  return (item && (item.label || item.id)) || '';
}

function connectorView(connectorId) {
  if (connectorId === 0) {
    return {
      legendId: 'connector0Legend',
      overviewId: 'connector0Overview',
      timelineId: 'connector0Timeline',
      fitId: 'connector0Fit',
      barsId: 'connector0OverviewBars',
      windowId: 'connector0Window',
      empty: 'No connector 0 status messages in this window.',
    };
  }
  return {
    legendId: 'connectorLegend',
    overviewId: 'connectorOverview',
    timelineId: 'connectorTimeline',
    fitId: 'connectorFit',
    barsId: 'connectorOverviewBars',
    windowId: 'connectorWindow',
    empty: 'No connector 1 status messages in this window.',
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
}

function redrawConnectorCharts() {
  drawConnectorChart(0);
  drawConnectorOverview(0);
  drawConnectorChart(1);
  drawConnectorOverview(1);
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
    <div class="overview-scale"><span>${escapeHtml(formatExact(state.eventBounds.start))}</span><strong class="overview-duration"></strong><span>${escapeHtml(formatExact(state.eventBounds.end))}</span></div>
    <div class="overview-track">
      <div id="${viewIds.barsId}" class="overview-bars"></div>
      <div id="${viewIds.windowId}" class="overview-window"><span class="overview-window-start"></span></div>
      <div class="overview-cursor" hidden></div>
      <div class="overview-brush" hidden><span class="overview-window-start"></span></div>
      <div class="overview-tip" hidden></div>
    </div>
  `;
  bindOverview(overview);
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
  const fitButton = document.getElementById(viewIds.fitId);
  if (fitButton) {
    fitButton.onclick = () => setEventView(state.eventBounds.start, state.eventBounds.end);
  }
}

function renderConnectorTimeline() {
  destroyChart(state.connectorTimeline);
  state.connectorTimeline = { destroy() {} };
  state.connectorIntervalsById = { 0: [], 1: [] };
  state.connectorIntervals = [];
  mountConnectorChart(0);
  mountConnectorChart(1);
  redrawConnectorCharts();
}

const SMART_STATES = [
  { id: 'Enabled', color: '#16a34a' },
  { id: 'Suspended', color: '#94a3b8' },
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
    const color = period.power > 0 ? '#16a34a' : '#ef4444';
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
    tbody.innerHTML = '<tr><td colspan="3" class="empty-row">No events available.</td></tr>';
    return;
  }

  tbody.innerHTML = records
    .map((event) => {
      const isSelected = state.selectedEventId && String(event.id) === String(state.selectedEventId);
      return `
        <tr data-id="${escapeHtml(String(event.id))}" class="${isSelected ? 'selected-row' : ''}">
          <td class="event-time">${escapeHtml(formatExact(event.timestamp))}</td>
          <td><span class="event-type" style="--type:${typeColors[event.type] || typeColors.Unknown}"><i></i>${escapeHtml(prettyEnum(event.type))}</span></td>
          <td>${escapeHtml(prettyEnum(event.eventName))}</td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    row.addEventListener('click', () => {
      const rowId = row.dataset.id;
      state.selectedEventId = rowId;
      const event = state.filteredEvents.find((item) => String(item.id) === String(rowId));
      if (event) {
        document.getElementById('detailPane').textContent = JSON.stringify(event.raw, null, 2);
      }
      renderTable();
    });
  });
}

function renderDetail() {
  if (!state.filteredEvents.length) {
    document.getElementById('detailPane').textContent = 'Select an event from the timeline or table to inspect its payload.';
    return;
  }

  const selectedEvent = state.filteredEvents.find((event) => String(event.id) === String(state.selectedEventId)) || state.filteredEvents[0];
  state.selectedEventId = selectedEvent.id;
  document.getElementById('detailPane').textContent = JSON.stringify(selectedEvent.raw, null, 2);
}

async function fetchChargingSessions(serialNumber, token, startTime, endTime) {
  try {
    const response = await fetch('/api/charging-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token, startTime, endTime }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return [];
    }
    const windowStart = startTime ? new Date(startTime).getTime() : 0;
    const windowEnd = endTime ? new Date(endTime).getTime() : Number.POSITIVE_INFINITY;
    return (result.sessions || []).filter((session) => {
      const start = new Date(session.startTime).getTime();
      const stop = session.stopTime ? new Date(session.stopTime).getTime() : windowEnd;
      return !Number.isNaN(start) && start <= windowEnd && stop >= windowStart;
    });
  } catch (error) {
    return [];
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

function paintSessionStrip() {
  const strip = document.getElementById('sessionStrip');
  const sessions = state.sessionStripSessions || [];
  const period = sessionPeriod();
  const view = state.sessionStripView || period;
  if (!strip || !sessions.length || Number.isNaN(period.start) || Number.isNaN(period.end)) {
    if (strip) strip.innerHTML = '';
    return;
  }
  const span = Math.max(view.end - view.start, 1);
  const placed = [];
  const dots = sessions.map((session) => {
    const start = new Date(session.startTime).getTime();
    if (Number.isNaN(start) || start < view.start || start > view.end) {
      return '';
    }
    const x = (start - view.start) / span;
    let row = 0;
    while (placed.some((item) => item.row === row && Math.abs(item.x - x) < 0.018)) {
      row += 1;
    }
    placed.push({ row, x });
    const tone = sessionStatusClass(session.status) || 'ongoing';
    return `<button type="button" class="session-dot ${tone}" style="left:${x * 100}%; top:${8 + (row % 4) * 16}px;" data-id="${escapeHtml(String(session.transactionId))}"></button>`;
  }).join('');
  const rows = placed.length ? Math.max(...placed.map((item) => item.row % 4)) + 1 : 1;
  strip.innerHTML = `
    <div class="session-strip-scale">
      <span>${escapeHtml(formatExact(view.start))}</span>
      <button type="button" id="sessionStripFit">Fit period</button>
      <span>${escapeHtml(formatExact(view.end))}</span>
    </div>
    <div class="session-strip-track" style="height:${20 + rows * 16}px;">${dots}</div>
  `;
  const track = strip.querySelector('.session-strip-track');
  bindTimeGuide(track, (ratio) => view.start + ratio * (view.end - view.start));
  track.addEventListener('wheel', (event) => {
    event.preventDefault();
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
  }, { passive: false });
  strip.querySelector('#sessionStripFit').addEventListener('click', () => {
    state.sessionStripView = sessionPeriod();
    paintSessionStrip();
  });
  strip.querySelectorAll('.session-dot').forEach((dot) => {
    dot.addEventListener('mouseenter', (event) => {
      const session = sessions.find((item) => String(item.transactionId) === dot.dataset.id);
      const hover = document.getElementById('eventHover');
      if (!session || !hover) {
        return;
      }
      const duration = Number(session.duration);
      hover.textContent = `Session ${session.transactionId} · ${session.status || 'Unknown'} · ${formatExact(session.startTime)} – ${formatDate(session.stopTime)} · ${Number.isFinite(duration) ? formatDuration(0, duration * 1000) : '—'} · ${session.consumption == null ? '—' : `${session.consumption} kWh`}`;
      hover.hidden = false;
      hover.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 460)}px`;
      hover.style.top = `${event.clientY + 14}px`;
    });
    dot.addEventListener('mouseleave', hideEventHover);
    dot.addEventListener('click', () => openSessionAnalysis(dot.dataset.id));
  });
}

function sessionRange(session) {
  const start = new Date(session.startTime).getTime();
  const end = session.stopTime ? new Date(session.stopTime).getTime() : Date.now();
  return { start, end: Math.max(end, start + 1000) };
}

function openSessionAnalysis(transactionId) {
  const session = (state.chargingSessions || []).find((item) => String(item.transactionId) === String(transactionId));
  const panel = document.getElementById('sessionAnalysis');
  const body = document.getElementById('sessionAnalysisBody');
  if (!session || !panel || !body) {
    return;
  }
  state.selectedSessionId = String(transactionId);
  document.querySelectorAll('.session-row').forEach((row) => {
    row.classList.toggle('selected-row', row.dataset.session === String(transactionId));
  });
  const range = sessionRange(session);
  const during = state.allEvents.filter((event) => {
    const time = new Date(event.timestamp).getTime();
    return time >= range.start && time <= range.end;
  });
  const statusBefore = state.allEvents
    .filter((event) => event.eventName === 'STATUS_NOTIFICATION' && new Date(event.timestamp).getTime() <= range.start)
    .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
  const statusEvents = statusBefore.slice(-1).concat(during.filter((event) => event.eventName === 'STATUS_NOTIFICATION'));
  const intervals = connectorIntervals(statusEvents, 1).filter((interval) => interval.end > range.start && interval.time < range.end);
  const span = range.end - range.start;
  const lanes = CONNECTOR_STATES.map((item) => {
    const bars = intervals
      .filter((interval) => interval.status === item.id)
      .map((interval) => {
        const start = Math.max(interval.time, range.start);
        const end = Math.min(interval.end, range.end);
        const left = ((start - range.start) / span) * 100;
        const width = ((end - start) / span) * 100;
        return `<i title="${escapeHtml(`${item.id} · ${formatExact(interval.time)} – ${formatExact(interval.end)}`)}" style="left:${left}%; width:${Math.max(width, 0.6)}%; background:${item.color};"></i>`;
      }).join('');
    return bars ? `<div class="analysis-lane"><span>${item.id}</span><div class="analysis-track">${bars}</div></div>` : '';
  }).join('');
  const schedules = scheduleRecords(state.allEvents).filter((record) => record.transactionId === String(transactionId));
  const smart = /smart/i.test(session.sessionType || '') || /smart/i.test(session.mode || '') || schedules.length > 0;
  const other = during.filter((event) => event.eventName !== 'STATUS_NOTIFICATION');
  const counts = new Map();
  other.forEach((event) => counts.set(event.eventName, (counts.get(event.eventName) || 0) + 1));
  document.getElementById('sessionAnalysisTitle').textContent = `Session ${session.transactionId}`;
  state.sessionAnalysis = {
    session,
    range,
    view: { ...range },
    intervals,
    schedules,
    smart,
    counts,
    selectedSchedule: schedules[0] ? schedules[0].id : '',
  };
  panel.hidden = false;
  paintSessionAnalysis(true);
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
  const statusColor = (period) => ({ label: period.status, color: connectorColor(period.status) });
  const powerColor = (period) => ({
    label: period.power > 0 ? 'Allowed' : 'Suspended',
    color: period.power > 0 ? '#16a34a' : '#ef4444',
  });
  const selected = analysis.schedules.find((item) => item.id === analysis.selectedSchedule);
  const lanes = CONNECTOR_STATES.map((item) => {
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
  body.innerHTML = `
    <div class="analysis-facts">
      <span>${escapeHtml(analysis.session.status || 'Unknown')}</span>
      <span>${escapeHtml(formatExact(view.start))} – ${escapeHtml(formatExact(view.end))}</span>
      <span>${escapeHtml(analysis.session.consumption == null ? '—' : `${analysis.session.consumption} kWh`)}</span>
      <span>SoC ${escapeHtml(analysis.session.socAtStart == null ? '—' : `${analysis.session.socAtStart}%`)} → ${escapeHtml(analysis.session.socAtStop == null ? '—' : `${analysis.session.socAtStop}%`)}</span>
      <button type="button" id="analysisFit">Fit session</button>
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
  const chart = body.querySelector('.analysis-chart');
  bindTimeGuide(chart, (ratio) => {
    const current = state.sessionAnalysis && state.sessionAnalysis.view;
    return current ? current.start + ratio * (current.end - current.start) : NaN;
  });
  chart.addEventListener('wheel', (event) => {
    event.preventDefault();
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
  }, { passive: false });
  body.querySelector('#analysisFit').addEventListener('click', () => {
    analysis.view = { ...analysis.range };
    paintSessionAnalysis(false);
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

function renderChargingSessions() {
  const tbody = document.getElementById('sessionTableBody');
  if (!tbody) {
    return;
  }
  const sessions = state.chargingSessions || [];
  renderSessionStrip(sessions);
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No charging sessions in this period.</td></tr>';
    return;
  }
  tbody.innerHTML = sessions.map((session) => {
    const duration = Number(session.duration);
    const tone = sessionStatusClass(session.status);
    const soc = [session.socAtStart, session.socAtStop].map((value) => value == null ? '—' : `${value}%`).join(' → ');
    return `
      <tr class="session-row ${tone}" data-session="${escapeHtml(String(session.transactionId))}">
        <td>${escapeHtml(displayValue(session.transactionId))}</td>
        <td><span class="session-status ${tone}">${escapeHtml(displayValue(session.status))}</span></td>
        <td>${escapeHtml(displayValue(session.sessionType))}</td>
        <td>${escapeHtml(displayValue(session.authMode || session.mode))}</td>
        <td class="nowrap">${escapeHtml(formatDate(session.startTime))}</td>
        <td class="nowrap">${escapeHtml(formatDate(session.stopTime))}</td>
        <td>${escapeHtml(Number.isFinite(duration) ? formatDuration(0, duration * 1000) : '—')}</td>
        <td>${escapeHtml(session.consumption == null ? '—' : `${session.consumption} kWh`)}</td>
        <td class="nowrap">${escapeHtml(soc)}</td>
        <td>${escapeHtml(session.smartChargingOverridden ? 'Overridden' : displayValue(session.mode))}</td>
      </tr>
    `;
  }).join('');
  tbody.querySelectorAll('tr[data-session]').forEach((row) => {
    row.addEventListener('click', () => openSessionAnalysis(row.dataset.session));
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
        ${rows.map(([label, value]) => `
          <div>
            <dt>${escapeHtml(String(label))}</dt>
            <dd>${escapeHtml(displayValue(value))}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `).join('');
}

async function fetchSmartCharging(serialNumber, token) {
  try {
    const response = await fetch('/api/smart-charging', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return null;
    }
    state.tariff = result.tariff || null;
    return result.smartCharging || null;
  } catch (error) {
    return null;
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
    summary.textContent = 'Search to load smart charging';
    profile.innerHTML = '<p class="empty-state">No smart charging record yet.</p>';
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
    ['Status', status],
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
    const response = await fetch('/api/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return null;
    }
    return result.access || null;
  } catch (error) {
    return null;
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
  const powerLoss = windowEvents.filter((event) => /powerloss/i.test(event.eventName) || /powerloss/i.test(blob(event)));
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
  root.innerHTML = `
    <dl>
      ${rows.map(([label, value]) => `
        <div>
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value)}</dd>
        </div>
      `).join('')}
    </dl>
  `;
}

function renderAccessProfile() {
  const profile = document.getElementById('accessProfile');
  const summary = document.getElementById('accessSummary');
  if (!profile || !summary) {
    return;
  }
  const access = state.access;
  if (!access) {
    summary.textContent = 'Search to load access';
    profile.innerHTML = '<p class="empty-state">No access record yet.</p>';
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
    const response = await fetch('/api/wallbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return null;
    }
    return result.wallbox || null;
  } catch (error) {
    return null;
  }
}

async function fetchChannelInfo(serialNumber, token) {
  try {
    const response = await fetch('/api/channel-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serialNumber, token }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      return { channelInfo: null, activeChargingLimit: '' };
    }
    return {
      channelInfo: result.channelInfo || null,
      activeChargingLimit: String(result.activeChargingLimit || ''),
    };
  } catch (error) {
    return { channelInfo: null, activeChargingLimit: '' };
  }
}

async function fetchEventPage(serialNumber, token, startTime, endTime, page) {
  const response = await fetch('/api/events', {
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

async function fetchEventPages(serialNumber, token, startTime, endTime) {
  const windowStart = startTime ? new Date(startTime).getTime() : 0;
  const seen = new Set();
  const merged = [];
  for (let page = 0; page < 40; page += 1) {
    let batch = [];
    let last = true;
    try {
      const result = await fetchEventPage(serialNumber, token, startTime, endTime, page);
      batch = result.records;
      last = result.last;
    } catch (error) {
      if (!merged.length) {
        throw error;
      }
      const oldest = oldestEventTime(merged);
      window.alert(`Loaded logs back to ${formatDate(oldest)}. A later request failed, so some older logs in this window may be missing.`);
      break;
    }
    const before = merged.length;
    batch.forEach((event) => {
      if (!seen.has(String(event.id))) {
        seen.add(String(event.id));
        merged.push(event);
      }
    });
    state.allEvents = merged.slice().sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    state.filteredEvents = state.allEvents;
    applyFilters();
    setStatus(`Loaded ${state.allEvents.length} event(s)${last ? '' : ', still reading older logs...'}`, 'info');
    const oldest = oldestEventTime(batch);
    if (last || batch.length < 100 || merged.length === before || oldest == null || oldest <= windowStart) {
      break;
    }
  }
  return merged.sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
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

  if (!token) {
    setToken('');
    setStatus('No valid TME session yet. Sign in on the TME tab if it opens.', 'warning');
    await triggerAutoTokenCapture();
    return;
  }

  if (isTokenExpired(token) || !isTmeJwtToken(token)) {
    await clearSavedToken();
    setStatus('The saved TME bearer token is not valid for the log-management API and has been cleared. Sign in again to refresh it before searching.', 'warning');
    return;
  }

  if (startTime && endTime && new Date(startTime) > new Date(endTime)) {
    setStatus('The From date must be earlier than or equal to the To date.', 'warning');
    return;
  }

  setStatus('Loading wallbox events...', 'info');

  try {
    state.wallbox = await fetchWallbox(serialNumber, token);
    const channelInfo = await fetchChannelInfo(serialNumber, token);
    state.channelInfo = channelInfo.channelInfo;
    state.activeChargingLimit = channelInfo.activeChargingLimit;
    state.access = await fetchAccess(serialNumber, token);
    state.smartCharging = await fetchSmartCharging(serialNumber, token);
    renderAccessProfile();
    renderSmartChargingInfo();
    renderChargerProfile();
    state.chargingSessions = await fetchChargingSessions(serialNumber, token, startTime, endTime);
    renderChargingSessions();
    const records = await fetchEventPages(serialNumber, token, startTime, endTime);
    state.allEvents = records;
    state.filteredEvents = records;
    state.timelineView = null;
    buildTypeFilterOptions(records);
    renderLegend();
    applyFilters();
    rememberSerial(serialNumber);
    setStatus(`Loaded ${records.length} event(s) for ${serialNumber}.`, 'success');
    renderAtAGlance();
  } catch (error) {
    const message = error.message || 'The request failed.';
    const normalizedMessage = message.toLowerCase();

    if (/unauthorized|expired|invalid|token/.test(normalizedMessage)) {
      await handleInvalidTokenAndRetry();
    } else {
      setStatus(message, 'error');
    }

    state.allEvents = [];
    state.filteredEvents = [];
    renderTable();
    renderTimeline();
    updateSummary();
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

function activeLimitTooltip(limit) {
  const ceiling = escapeHtml(limit || '—');
  return `Active Limit Calculation\nThe charger evaluates all inputs and enforces the lowest value as a safety ceiling.`;
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
    ['Status', statusRows],
    ['History and faults', [
      ['Activated', formatDate(wallbox.activationTime)],
      ['Registered', formatDate(wallbox.registrationTime)],
      ['Last factory reset', formatDate(wallbox.lastFactoryReset)],
      ['Last peak update', formatDate(wallbox.lastPeakUpdateTimestamp)],
      ['Active errors', wallbox.activeChargingErrors],
      ['Peaks', formatPeaks(wallbox.peaks)],
    ]],
    ['Access', [
      ['Owner PIN', wallbox.ownerPin, '', true],
    ]],
    state.activeChargingLimit ? ['Channel info', [
      ['Active charging limit', state.activeChargingLimit, '', false, false, activeLimitTooltip(state.activeChargingLimit)],
    ]] : [],
  ];
}

function renderChargerProfile() {
  const profile = document.getElementById('chargerProfile');
  const summary = document.getElementById('chargerSummary');
  if (!profile || !summary) {
    return;
  }
  const wallbox = state.wallbox;
  if (!wallbox) {
    summary.textContent = 'Search to load charger details';
    profile.innerHTML = '<p class="empty-state">No charger record yet.</p>';
    return;
  }
  const connectivity = wallbox.connectivityStatus || 'Unknown';
  const connectivityChanged = formatDate(wallbox.connectivityStatusUpdatedOn);
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
  profile.innerHTML = `
    ${chargerFacts(wallbox).filter(([title, rows]) => rows.length).map(([title, rows]) => `
      <section class="charger-group">
        <h3>${escapeHtml(title)}</h3>
        <dl>
          ${(rows.length ? rows : [['None', '—']]).map(([label, value, tone, copyable, place, tooltip]) => `
            <div class="${place || ''}">
              <dt>${escapeHtml(label)}</dt>
              <dd>
                ${tooltip ? `
                  <span class="limit-tip" tabindex="0">
                    <span class="limit-tip-value">${tone ? `<span class="status-pill tone-${tone}">${escapeHtml(displayValue(value))}</span>` : escapeHtml(displayValue(value))}
                    <span class="limit-tip-text">${tooltip}</span>
                  </span>
                ` : (tone ? `<span class="status-pill tone-${tone}">${escapeHtml(displayValue(value))}</span>` : escapeHtml(displayValue(value)))}
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

function svgServer() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="5" rx="2"/><rect x="4" y="13" width="16" height="5" rx="2"/><circle cx="9" cy="9" r=".6" fill="currentColor"/><circle cx="9" cy="16" r=".6" fill="currentColor"/></svg>';
}

function svgBolt() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-10h-7l1-8z"/></svg>';
}

function svgPlug() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h4v6H4zM8 7h8v6H8zM12 13v4M8 17h8"/></svg>';
}

function svgKey() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4"/><path d="M11 7h6a2 2 0 0 1 2 2v2M15 11l2 2"/></svg>';
}

function svgShield() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v5c0 5-3.5 7.5-8 10-4.5-2.5-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>';
}

function svgSliders() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M9 12h10M6 18h14"/><circle cx="6" cy="6" r="2.5" fill="currentColor"/><circle cx="14" cy="12" r="2.5" fill="currentColor"/><circle cx="11" cy="18" r="2.5" fill="currentColor"/></svg>';
}

function renderAtAGlance() {
  const grid = document.getElementById('glanceGrid');
  if (!grid) {
    return;
  }
  const wallbox = state.wallbox;
  const access = state.access;
  const smart = state.smartCharging;
  const tariff = state.tariff;

  const connectivity = String(wallbox && wallbox.connectivityStatus || '').toUpperCase();
  const online = connectivity === 'ONLINE';
  const connectivityChanged = formatDate(wallbox && wallbox.connectivityStatusUpdatedOn);

  const connectors = (wallbox && wallbox.connectors) || [];
  const availableConnectors = connectors.filter((c) => /available/i.test(String(c.status || '')));
  const connectorCount = connectors.length || 2;
  const connectorLabel = connectors.length ? connectors.map((c) => `Connector ${Number(c.id) + 1} · ${c.status}`).join('<br>') : '';

  const freevending = access && access.open;
  const userCount = (access && access.users) ? access.users.length : 1;
  const rfidCount = (access && access.rfids) ? access.rfids.length : 1;
  const country = (access && access.countryId) || 'GB';

  const activeErrors = wallbox && wallbox.activeChargingErrors;
  const hasErrors = activeErrors && String(activeErrors).trim() && String(activeErrors).trim().toLowerCase() !== 'none';
  const healthy = !hasErrors;

  const smartStatus = (smart && (smart.smartChargingStatus || wallbox && wallbox.smartChargingStatus)) || 'DISABLED';
  const smartEnabled = /enabled|active|on/i.test(String(smartStatus));
  const maxPower = formatPowerWatts(wallbox && wallbox.maxChargingPower);
  const calibration = smart && smart.calibrationStatus ? prettyEnum(smart.calibrationStatus) : 'Not calibrated';

  const cards = [
    {
      title: 'Charger Status',
      icon: svgServer(),
      primary: online ? 'ONLINE' : (connectivity || 'UNKNOWN'),
      sub: online ? 'Operational' : 'Check connectivity',
      statusDot: online ? 'good' : 'bad',
      support: [
        `Last connectivity${online ? '' : ' change'}: ${connectivityChanged || '—'}`,
      ],
      cardClass: online ? '' : 'warn',
    },
    {
      title: 'Power',
      icon: svgBolt(),
      primary: maxPower,
      sub: 'Maximum power',
      support: [
        `Phase: ${wallbox && wallbox.numberOfPhases ? wallbox.numberOfPhases : 1}`,
        `Configured maximum; not current draw`,
      ],
      capacity: 50,
    },
    {
      title: 'Connectors',
      icon: svgPlug(),
      primary: `${availableConnectors.length || connectorCount} / ${connectorCount}`,
      sub: 'Available',
      statusDot: availableConnectors.length === connectorCount ? 'good' : 'warn',
      connectors: connectors.length ? connectors.map((c) => `<span class="glance-connector">Connector ${Number(c.id) + 1} · ${c.status}</span>`) : [`<span class="glance-connector">Connector 1 · Available</span>`, `<span class="glance-connector">Connector 2 · Available</span>`],
      support: connectorLabel ? [] : [],
    },
    {
      title: 'Access',
      icon: svgKey(),
      primary: freevending ? 'Freevending Enabled' : 'Freevending Disabled',
      sub: `${userCount} user${userCount === 1 ? '' : 's'} · ${rfidCount} RFID`,
      statusDot: freevending ? 'good' : 'bad',
      support: [`Country · ${country}`],
    },
    {
      title: 'System Health',
      icon: svgShield(),
      primary: hasErrors ? 'Active Errors' : 'No Active Errors',
      sub: hasErrors ? String(activeErrors) : 'All systems normal',
      statusDot: healthy ? 'good' : 'bad',
      metrics: [
        ['0', 'Power Loss'],
        ['0', 'Disconnections'],
        ['0', 'Reconnections'],
      ],
    },
    {
      title: 'Smart Charging',
      icon: svgSliders(),
      primary: smartEnabled ? 'ENABLED' : 'DISABLED',
      sub: `Max power · ${maxPower}`,
      statusDot: smartEnabled ? 'good' : 'warn',
      support: [`Calibration · ${calibration}`],
      cardClass: smartEnabled ? '' : 'warn',
    },
  ];

  grid.innerHTML = cards.map((card) => `
    <article class="glance-card${card.cardClass ? ' ' + card.cardClass : ''}" role="group" aria-label="${card.title}">
      <div class="glance-card-head">
        <h3 class="glance-card-title">${escapeHtml(card.title)}</h3>
        <span class="glance-card-icon" aria-hidden="true">${card.icon}</span>
      </div>
      <div class="glance-primary">
        <span class="glance-primary-value">${escapeHtml(card.primary)}</span>
        ${card.sub ? `<span class="glance-primary-sub">${escapeHtml(card.sub)}</span>` : ''}
      </div>
      ${card.statusDot ? `<span class="glance-status-dot ${card.statusDot}"></span>` : ''}
      ${card.connectors ? `<div class="glance-connectors">${card.connectors.join('')}</div>` : ''}
      ${card.capacity ? `<div class="glance-capacity"><i style="width:${card.capacity}%"></i></div>` : ''}
      ${card.metrics ? `<div class="glance-metrics">${card.metrics.map(([value, label]) => `<div class="glance-metric"><span class="glance-metric-value">${escapeHtml(value)}</span><span class="glance-metric-label">${escapeHtml(label)}</span></div>`).join('')}</div>` : ''}
      ${card.support.length ? `<div class="glance-support">${card.support.map((line) => `<span class="glance-support-line">${line}</span>`).join('')}</div>` : ''}
    </article>
  `).join('');
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
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
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
  const end = Date.now();
  return { start: end - 30 * 24 * 60 * 60 * 1000, end };
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
  const start = Math.min(Math.max(selected.start, domain.start), domain.end);
  const end = Math.min(Math.max(selected.end, start), domain.end);
  windowBox.style.left = `${((start - domain.start) / span) * 100}%`;
  windowBox.style.width = `${Math.max(((end - start) / span) * 100, 0.4)}%`;
  const label = windowBox.querySelector('.overview-window-start');
  if (label) {
    label.hidden = true;
  }
  if (duration) {
    duration.textContent = `${formatExact(start)} – ${formatExact(end)} · ${formatDuration(start, end)}`;
  }
  if (startLabel) {
    startLabel.textContent = formatExact(domain.start);
  }
  const ticks = document.getElementById('rangeTicks');
  if (ticks) {
    ticks.innerHTML = Array.from({ length: 7 }, (_, index) => {
      const time = domain.start + (span * index) / 6;
      const label = new Date(time).toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<i style="left:${(index / 6) * 100}%"><span>${escapeHtml(label)}</span></i>`;
    }).join('');
  }
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
  track.addEventListener('mousemove', (event) => {
    const rect = track.getBoundingClientRect();
    const time = timeAt(event.clientX);
    cursor.hidden = false;
    cursor.style.left = `${event.clientX - rect.left}px`;
    tip.hidden = false;
    tip.textContent = formatExact(time);
    tip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 220)}px`;
    tip.style.top = `${Math.max(8, event.clientY - 32)}px`;
    if (!state.rangeDrag) {
      return;
    }
    const left = Math.min(state.rangeDrag, event.clientX);
    const right = Math.max(state.rangeDrag, event.clientX);
    brush.hidden = false;
    brush.style.left = `${left - rect.left}px`;
    brush.style.width = `${Math.max(1, right - left)}px`;
    brush.querySelector('.overview-window-start').textContent = formatExact(timeAt(left));
    document.getElementById('rangeDuration').textContent = formatDuration(timeAt(left), timeAt(right));
  });
  track.addEventListener('mouseleave', () => {
    if (state.rangeDrag) {
      return;
    }
    cursor.hidden = true;
    tip.hidden = true;
  });
  track.addEventListener('mousedown', (event) => {
    event.preventDefault();
    state.rangeDrag = event.clientX;
    brush.hidden = false;
    brush.style.left = `${event.clientX - track.getBoundingClientRect().left}px`;
    brush.style.width = '1px';
  });
  window.addEventListener('mouseup', (event) => {
    if (!state.rangeDrag) {
      return;
    }
    const start = timeAt(Math.min(state.rangeDrag, event.clientX));
    const end = timeAt(Math.max(state.rangeDrag, event.clientX));
    state.rangeDrag = null;
    brush.hidden = true;
    cursor.hidden = true;
    tip.hidden = true;
    if (end - start < 1000) {
      applyWindowDates(start - 60 * 1000, start + 60 * 1000, true);
      return;
    }
    applyWindowDates(start, end, true);
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

function setToken(token) {
  const value = String(token || '').replace(/^Bearer\s+/i, '').trim();
  const valid = Boolean(value) && !isTokenExpired(value) && isTmeJwtToken(value);
  state.token = valid ? value : '';
  const led = document.getElementById('tokenLed');
  if (led) {
    led.classList.toggle('valid', valid);
    led.setAttribute('aria-label', valid ? 'TME token valid' : 'TME token missing');
  }
  return valid;
}

function clearToken() {
  setToken('');
}

async function clearSavedToken() {
  try {
    await fetch('/api/session-token', { method: 'DELETE' });
  } catch (error) {
    // Ignore cleanup errors; the UI token field is still cleared.
  }

  setToken('');
}

async function loadStoredTokenFromLocalBridge() {
  try {
    const response = await fetch('/api/session-token', { method: 'GET' });
    const result = await response.json();
    if (result && result.ok && result.token) {
      if (isTokenExpired(result.token) || !isTmeJwtToken(result.token)) {
        await clearSavedToken();
        setStatus('Saved TME token is invalid for the log-management API and was cleared. Refreshing the session automatically...', 'warning');
        await triggerAutoTokenCapture();
        return false;
      }

      setToken(result.token);
      setStatus('Saved TME token loaded automatically.', 'success');
      return true;
    }
  } catch (error) {
    // Ignore and fall back to the manual flow.
  }
  return false;
}

async function useSavedToken() {
  const loaded = await loadStoredTokenFromLocalBridge();
  if (!loaded) {
    setStatus('No saved TME token is available yet. Authenticate in the TME dashboard, then save the session token.', 'warning');
  }
}

async function handleInvalidTokenAndRetry() {
  if (state.tokenRefreshInProgress) {
    return;
  }

  state.tokenRefreshInProgress = true;

  try {
    await clearSavedToken();
    setStatus('The saved TME token was rejected. Refreshing the TME session automatically...', 'warning');

    const started = await triggerAutoTokenCapture();
    if (!started) {
      setStatus('The TME token refresh could not be started automatically. Please reload the page once the dashboard is signed in.', 'warning');
      return;
    }

    const tokenLoaded = await waitForAutoToken();
    if (tokenLoaded) {
      const loaded = await loadStoredTokenFromLocalBridge();
      if (loaded) {
        setStatus('Fresh TME token loaded. Reloading events automatically...', 'success');
        await fetchEvents();
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

function rememberSerial(serialNumber) {
  const next = [serialNumber, ...serialHistory().filter((item) => item !== serialNumber)].slice(0, 12);
  localStorage.setItem('chargerSerialHistory', JSON.stringify(next));
}

function renderSerialHistory() {
  const input = document.getElementById('serialNumber');
  const menu = document.getElementById('serialHistory');
  const query = input.value.trim().toLowerCase();
  const matches = serialHistory().filter((item) => item.toLowerCase().includes(query));
  if (!matches.length) {
    menu.hidden = true;
    menu.innerHTML = '';
    return;
  }
  menu.innerHTML = matches.map((item) => `<button type="button" data-serial="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join('');
  menu.hidden = false;
  menu.querySelectorAll('button').forEach((button) => {
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      input.value = button.dataset.serial;
      menu.hidden = true;
    });
  });
}

function loadSample() {
  document.getElementById('serialNumber').value = SAMPLE.serialNumber;
  setDefaultWindow();
}

async function triggerAutoTokenCapture() {
  try {
    const response = await fetch('/api/refresh-tme-token', { method: 'GET' });
    const result = await response.json();
    if (result && result.ok) {
      setStatus('Refreshing the TME session automatically.', 'info');
      return true;
    }
  } catch (error) {
    // Ignore and keep polling the local token endpoint.
  }

  return false;
}

async function waitForAutoToken(timeoutMs = 120000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const loaded = await loadStoredTokenFromLocalBridge();
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

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (!dark) {
    delete document.documentElement.dataset.theme;
  }
  localStorage.setItem('wallboxTheme', dark ? 'dark' : 'light');
  const button = document.getElementById('themeSwitch');
  if (button) {
    button.setAttribute('aria-pressed', dark ? 'true' : 'false');
    button.setAttribute('aria-label', dark ? 'Switch to day mode' : 'Switch to night mode');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  applyTheme(localStorage.getItem('wallboxTheme') === 'dark' ? 'dark' : 'light');
  document.getElementById('themeSwitch').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  clearToken();
  setDefaultWindow();
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
  });
  const serialInput = document.getElementById('serialNumber');
  serialInput.addEventListener('focus', renderSerialHistory);
  serialInput.addEventListener('input', renderSerialHistory);
  serialInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      closePopovers();
      fetchEvents();
    }
  });
  serialInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      document.getElementById('serialHistory').hidden = true;
    }, 150);
  });
  document.querySelectorAll('.connector-tab').forEach((button) => {
    button.addEventListener('click', () => showConnectorTab(Number(button.dataset.connector)));
  });
  document.getElementById('sessionAnalysisClose').addEventListener('click', () => {
    document.getElementById('sessionAnalysis').hidden = true;
  });
  document.getElementById('quickRange').addEventListener('change', (event) => {
    if (!event.target.value) {
      return;
    }
    applyQuickRange(Number(event.target.value));
  });
  ['startDate', 'endDate', 'startTimeTrigger', 'endTimeTrigger'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      document.getElementById('quickRange').value = '';
      paintRangeWindow();
    });
  });
  document.getElementById('eventNameSearch').addEventListener('input', applyFilters);

  renderAtAGlance();

  await autoLoadSavedTokenAndSearch();
});
