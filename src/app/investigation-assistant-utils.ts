export interface AssistantSessionReference {
  id?: string | number | null;
  transactionId?: string | number | null;
  startTime?: string | null;
}

export interface AssistantFocus<TSession> {
  source: 'selected' | 'latest' | 'none';
  session: TSession | null;
  previous: TSession | null;
}

interface AssistantSignalPacket {
  status?: {
    activeErrors?: boolean;
    disconnects?: number;
    reconnects?: number;
  };
  sessions?: {
    selected?: Array<{
      status?: string;
      diagnosis?: string;
      verdict?: string;
      startDiagnosis?: string;
      endDiagnosis?: string;
    }>;
  };
  diagnostics?: Array<{ status?: string }>;
  incidents?: unknown[];
  patterns?: unknown[];
  events?: { source?: string };
  quality?: { completeness?: string; missingSources?: string[] };
}

export interface AssistantFailure {
  message: string;
  retryable: boolean;
  delayMs: number;
}

export function hasInvestigableSignal(packet: AssistantSignalPacket): boolean {
  if (packet.status?.activeErrors === true) return true;
  if (Number(packet.status?.disconnects) > 0 || Number(packet.status?.reconnects) > 0) return true;
  if (packet.diagnostics?.some((item) => ['FAIL', 'ATTENTION'].includes(String(item.status).toUpperCase()))) return true;
  if (packet.incidents?.length || packet.patterns?.length) return true;
  if (packet.events?.source === 'partial') return true;
  if (packet.quality?.completeness === 'ATTENTION' || Boolean(packet.quality?.missingSources?.length)) return true;
  return Boolean(packet.sessions?.selected?.some((session) =>
    /timed.?out|cancelled|failed|error|aborted|rejected/i.test(session.status || '') ||
    /failed|interrupted|mismatch|continued after/i.test([
      session.diagnosis,
      session.startDiagnosis,
      session.endDiagnosis,
      session.verdict
    ].filter(Boolean).join(' '))
  ));
}

export function classifyAssistantFailure(
  code: string | null | undefined,
  attempt = 0,
  retryAfterSeconds = 0
): AssistantFailure {
  const backoffMs = attempt === 0 ? 3_000 : 10_000;
  const retryDelay = Math.max(backoffMs, Math.min(3_600, Math.max(0, Number(retryAfterSeconds) || 0)) * 1_000);
  switch (code) {
    case 'not_configured':
      return { message: 'AI investigation is not configured for this dashboard.', retryable: false, delayMs: 0 };
    case 'provider_auth':
      return { message: 'AI service authentication failed. Check the dashboard configuration.', retryable: false, delayMs: 0 };
    case 'provider_rate_limited':
    case 'local_rate_limited':
      return { message: 'The AI request limit was reached.', retryable: true, delayMs: retryDelay };
    case 'provider_timeout':
      return { message: 'The AI service timed out.', retryable: true, delayMs: retryDelay };
    case 'provider_unavailable':
    case 'network_error':
      return { message: 'The AI service is temporarily unavailable.', retryable: true, delayMs: retryDelay };
    case 'invalid_response':
      return { message: 'The AI service returned an unreadable response.', retryable: true, delayMs: retryDelay };
    default:
      return { message: 'The AI investigation could not be completed.', retryable: true, delayMs: retryDelay };
  }
}

export function resolveFocusSessions<TSession extends AssistantSessionReference>(
  sessions: readonly TSession[],
  selectedSessionId?: string | null
): AssistantFocus<TSession> {
  const ordered = sessions.map((session, index) => ({
    session,
    index,
    start: session.startTime ? Date.parse(session.startTime) : Number.NaN
  })).sort((left, right) => {
    const leftStart = Number.isFinite(left.start) ? left.start : Number.NEGATIVE_INFINITY;
    const rightStart = Number.isFinite(right.start) ? right.start : Number.NEGATIVE_INFINITY;
    return rightStart - leftStart || left.index - right.index;
  });
  const selectedIndex = selectedSessionId
    ? ordered.findIndex(({ session }) => String(session.transactionId ?? session.id ?? '') === selectedSessionId)
    : -1;
  const focusIndex = selectedIndex >= 0 ? selectedIndex : ordered.length ? 0 : -1;
  if (focusIndex < 0) return { source: 'none', session: null, previous: null };

  return {
    source: selectedIndex >= 0 ? 'selected' : 'latest',
    session: ordered[focusIndex].session,
    previous: ordered[focusIndex + 1]?.session ?? null
  };
}