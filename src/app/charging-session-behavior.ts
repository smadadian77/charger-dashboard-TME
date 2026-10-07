export interface SessionStateChange {
  state: string;
  at: number;
  eventId?: string | number | null;
}

export interface SessionBehaviorEvent {
  id?: string | number | null;
  eventName: string;
  at: number;
}

export interface SessionOpportunityWindow {
  start: number;
  end: number;
  power: number | null;
  eventId?: string | number | null;
}

export interface SessionBehaviorInput {
  start: number;
  end: number;
  stateChanges: readonly SessionStateChange[];
  events?: readonly SessionBehaviorEvent[];
  opportunities?: readonly SessionOpportunityWindow[];
  sessionEnergyKwh?: number | null;
  smartChargingEnabled?: boolean;
}

export interface SessionBehaviorSegment {
  state: string;
  role: 'charging' | 'connected-waiting' | 'unavailable' | 'available' | 'unknown';
  start: number;
  end: number;
  durationMs: number;
  eventIds: string[];
  relatedEvents: Array<{ id: string | null; name: string; at: number }>;
}

export interface SessionBehaviorFinding {
  kind: 'opportunity-overlap';
  title: string;
  summary: string;
  impactMs?: number;
  opportunityMs?: number;
  opportunityShare?: number;
  states?: string[];
  fromState?: string;
  toState?: string;
  occurrences?: number;
  evidenceIds: string[];
  uncertainty: string[];
}

const materialOpportunityShare = 0.15;

function canonicalState(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function stateRole(state: string): SessionBehaviorSegment['role'] {
  const normalized = canonicalState(state);
  if (!normalized) return 'unknown';
  if (normalized === 'charging' || /^charging\w*$/.test(normalized)) return 'charging';
  if (/fault|error|unavailable|disconnect|offline/.test(normalized)) return 'unavailable';
  if (/suspend|prepar|finish|connect|ready|occup/.test(normalized)) return 'connected-waiting';
  if (/available|^idle$/.test(normalized)) return 'available';
  return 'unknown';
}

function mergeWindows(windows: readonly SessionOpportunityWindow[], start: number, end: number) {
  const clipped = windows
    .filter((window) => Number.isFinite(window.power) && Number(window.power) > 0 && window.end > window.start)
    .map((window) => ({
      start: Math.max(start, window.start),
      end: Math.min(end, window.end),
      eventId: window.eventId == null ? null : String(window.eventId)
    }))
    .filter((window) => window.end > window.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number; eventIds: string[] }> = [];
  for (const window of clipped) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end) {
      previous.end = Math.max(previous.end, window.end);
      if (window.eventId && !previous.eventIds.includes(window.eventId)) previous.eventIds.push(window.eventId);
    } else {
      merged.push({ start: window.start, end: window.end, eventIds: window.eventId ? [window.eventId] : [] });
    }
  }
  return merged;
}

export function analyzeChargingSessionBehavior(input: SessionBehaviorInput) {
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.end <= input.start) {
    return null;
  }
  const events = (input.events ?? []).filter((event) => Number.isFinite(event.at)
    && event.at >= input.start && event.at <= input.end)
    .sort((left, right) => left.at - right.at);
  const changes = input.stateChanges.filter((change) =>
    typeof change.state === 'string' && change.state.trim() && Number.isFinite(change.at) && change.at <= input.end
  ).map((change, index) => ({ ...change, index, eventId: change.eventId == null ? null : String(change.eventId) }))
    .sort((left, right) => left.at - right.at || left.index - right.index);
  const before = changes.filter((change) => change.at <= input.start).at(-1) ?? null;
  const inRange = changes.filter((change) => change.at > input.start && change.at < input.end);
  let currentState = before?.state || 'Unknown';
  let currentStart = input.start;
  let currentEventIds = before?.eventId ? [before.eventId] : [];
  let observations = before ? 1 : 0;
  const rawSegments: Array<{ state: string; start: number; end: number; eventIds: string[]; observations: number }> = [];
  const transitions: Array<{ fromState: string; toState: string; at: number; eventId: string | null }> = [];

  const closeSegment = (end: number) => {
    if (end <= currentStart) return;
    rawSegments.push({ state: currentState, start: currentStart, end, eventIds: [...currentEventIds], observations });
  };

  for (const change of inRange) {
    if (canonicalState(change.state) === canonicalState(currentState)) {
      observations += 1;
      if (change.eventId && !currentEventIds.includes(change.eventId)) currentEventIds.push(change.eventId);
      continue;
    }
    closeSegment(change.at);
    transitions.push({ fromState: currentState, toState: change.state, at: change.at, eventId: change.eventId });
    currentState = change.state;
    currentStart = change.at;
    currentEventIds = change.eventId ? [change.eventId] : [];
    observations = 1;
  }
  closeSegment(input.end);

  const segments: SessionBehaviorSegment[] = rawSegments.map((segment) => ({
    state: segment.state,
    role: stateRole(segment.state),
    start: segment.start,
    end: segment.end,
    durationMs: segment.end - segment.start,
    eventIds: segment.eventIds,
    relatedEvents: events.filter((event) => event.at >= segment.start && event.at <= segment.end)
      .slice(0, 8).map((event) => ({
        id: event.id == null ? null : String(event.id),
        name: event.eventName.slice(0, 80),
        at: event.at
      }))
  }));

  const stateDurationMap = new Map<string, { state: string; role: SessionBehaviorSegment['role']; occurrences: number; durationMs: number; longestMs: number }>();
  for (const segment of segments) {
    const entry = stateDurationMap.get(canonicalState(segment.state)) || {
      state: segment.state, role: segment.role, occurrences: 0, durationMs: 0, longestMs: 0
    };
    entry.occurrences += 1;
    entry.durationMs += segment.durationMs;
    entry.longestMs = Math.max(entry.longestMs, segment.durationMs);
    stateDurationMap.set(canonicalState(segment.state), entry);
  }
  const stateDurations = Array.from(stateDurationMap.values()).sort((left, right) => right.durationMs - left.durationMs);

  const transitionCounts = new Map<string, { fromState: string; toState: string; occurrences: number; eventIds: string[] }>();
  for (const transition of transitions) {
    const key = `${canonicalState(transition.fromState)}>${canonicalState(transition.toState)}`;
    const entry = transitionCounts.get(key) || {
      fromState: transition.fromState, toState: transition.toState, occurrences: 0, eventIds: []
    };
    entry.occurrences += 1;
    if (transition.eventId && !entry.eventIds.includes(transition.eventId)) entry.eventIds.push(transition.eventId);
    transitionCounts.set(key, entry);
  }
  const repeatedTransitions = Array.from(transitionCounts.values()).filter((transition) => transition.occurrences > 1);

  const windows = mergeWindows(input.opportunities ?? [], input.start, input.end);
  const opportunityMs = windows.reduce((total, window) => total + window.end - window.start, 0);
  const overlapByState = new Map<string, { state: string; role: SessionBehaviorSegment['role']; durationMs: number; eventIds: string[] }>();
  for (const window of windows) {
    for (const segment of segments) {
      const overlapMs = Math.max(0, Math.min(window.end, segment.end) - Math.max(window.start, segment.start));
      if (!overlapMs || segment.role === 'unknown') continue;
      const key = canonicalState(segment.state);
      const entry = overlapByState.get(key) || { state: segment.state, role: segment.role, durationMs: 0, eventIds: [] };
      entry.durationMs += overlapMs;
      for (const id of [...window.eventIds, ...segment.eventIds]) {
        if (id && !entry.eventIds.includes(id)) entry.eventIds.push(id);
      }
      overlapByState.set(key, entry);
    }
  }
  const opportunityStates = Array.from(overlapByState.values()).sort((left, right) => right.durationMs - left.durationMs);
  const nonChargingImpact = opportunityStates.filter((item) => item.role === 'connected-waiting' || item.role === 'unavailable');
  const impactedMs = nonChargingImpact.reduce((total, item) => total + item.durationMs, 0);
  const opportunityShare = opportunityMs ? impactedMs / opportunityMs : null;
  const issueImpact = nonChargingImpact.filter((item) =>
    !(input.smartChargingEnabled && ['suspendedev', 'suspendedevse'].includes(canonicalState(item.state)))
  );
  const issueImpactMs = issueImpact.reduce((total, item) => total + item.durationMs, 0);
  const issueOpportunityShare = opportunityMs ? issueImpactMs / opportunityMs : null;
  const findings: SessionBehaviorFinding[] = [];
  const opportunityFindings: SessionBehaviorFinding[] = [];
  if (opportunityMs && issueImpactMs && issueOpportunityShare != null && issueOpportunityShare >= materialOpportunityShare) {
    const states = issueImpact.map((item) => item.state);
    const finding = {
      kind: 'opportunity-overlap',
      title: 'Charging opportunity overlapped a non-charging state',
      summary: `The connector was observed in ${states.join(', ')} for ${Math.round(impactedMs / 60000)} minutes while a loaded profile specified positive power. This shows temporal overlap, not its cause.`,
      impactMs: issueImpactMs,
      opportunityMs,
      opportunityShare: issueOpportunityShare,
      states,
      evidenceIds: Array.from(new Set(nonChargingImpact.flatMap((item) => item.eventIds))),
      uncertainty: [
        'A positive-power profile is not proof that the vehicle requested or accepted energy.',
        'No interval-level energy or power reading is available to assign delivery within this period.',
        'The telemetry does not establish why the observed state persisted.'
      ]
    } satisfies SessionBehaviorFinding;
    findings.push(finding);
    opportunityFindings.push(finding);
  }
  const unknownMs = segments.filter((segment) => segment.role === 'unknown')
    .reduce((total, segment) => total + segment.durationMs, 0);
  const unknowns = [];
  if (!windows.length) unknowns.push('No positive-power charging-profile window is available for this session.');
  if (unknownMs) unknowns.push(`Connector state was not classifiable from loaded telemetry for ${Math.round(unknownMs / 60000)} minutes.`);
  unknowns.push('Interval-level power/current measurements are not available in the loaded session data.');
  if (input.sessionEnergyKwh == null) unknowns.push('Session-level energy was not available.');

  return {
    range: { start: input.start, end: input.end, durationMs: input.end - input.start },
    sequence: segments.map((segment) => segment.state),
    segments,
    transitions,
    repeatedTransitions,
    stateDurations,
    findings,
    opportunity: {
      source: windows.length ? 'positive-power profile periods' : 'unavailable',
      durationMs: opportunityMs,
      byState: opportunityStates,
      connectedNonChargingMs: impactedMs,
      connectedNonChargingShare: opportunityShare,
      findings: opportunityFindings,
    },
    sessionEnergyKwh: input.sessionEnergyKwh ?? null,
    intervalPowerAvailable: false,
    events,
    unknowns,
  };
}