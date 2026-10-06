import { describe, expect, it } from 'vitest';
import { classifyAssistantFailure, hasInvestigableSignal, resolveFocusSessions } from './investigation-assistant-utils';

describe('investigation-assistant-utils', () => {
  it('stays quiet for healthy data and signals concrete abnormalities or incomplete sources', () => {
    const healthy = {
      status: { activeErrors: false, disconnects: 0, reconnects: 0 },
      sessions: { selected: [{ status: 'Completed', diagnosis: 'normal/normal' }] },
      diagnostics: [{ status: 'PASS' }],
      incidents: [],
      patterns: [],
      events: { source: 'loaded' },
      quality: { completeness: 'PASS', missingSources: [] }
    };
    expect(hasInvestigableSignal(healthy)).toBe(false);
    expect(hasInvestigableSignal({ ...healthy, sessions: { selected: [{ status: 'TimedOut' }] } })).toBe(true);
    expect(hasInvestigableSignal({ ...healthy, diagnostics: [{ status: 'ATTENTION' }] })).toBe(true);
    expect(hasInvestigableSignal({ ...healthy, events: { source: 'partial' } })).toBe(true);
  });

  it('classifies permanent configuration errors and bounded transient retries', () => {
    expect(classifyAssistantFailure('not_configured').retryable).toBe(false);
    expect(classifyAssistantFailure('provider_timeout', 0).delayMs).toBe(3_000);
    expect(classifyAssistantFailure('provider_unavailable', 1).delayMs).toBe(10_000);
    expect(classifyAssistantFailure('provider_rate_limited', 0, 120).delayMs).toBe(120_000);
    expect(classifyAssistantFailure('provider_rate_limited', 0, 50_000).delayMs).toBe(3_600_000);
  });

  it('uses the selected session when present, otherwise latest, and selects its prior session', () => {
    const sessions = [
      { transactionId: 'older', startTime: '2026-10-05T10:00:00Z' },
      { transactionId: 'latest', startTime: '2026-10-06T10:00:00Z' },
      { transactionId: 'middle', startTime: '2026-10-05T14:00:00Z' }
    ];
    expect(resolveFocusSessions(sessions).session?.transactionId).toBe('latest');
    expect(resolveFocusSessions(sessions).previous?.transactionId).toBe('middle');
    expect(resolveFocusSessions(sessions, 'older')).toMatchObject({
      source: 'selected',
      session: { transactionId: 'older' },
      previous: null
    });
    expect(resolveFocusSessions([], null)).toEqual({ source: 'none', session: null, previous: null });
  });
});