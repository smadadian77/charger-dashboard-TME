import { describe, expect, it } from 'vitest';
import { analyzeChargingSessionBehavior } from './charging-session-behavior';

const minute = 60_000;

describe('charging-session-behavior', () => {
  it('reconstructs ordered transitions and state durations without inventing a cause', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 40 * minute,
      stateChanges: [
        { state: 'Preparing', at: 0, eventId: 'e1' },
        { state: 'Charging', at: 5 * minute, eventId: 'e2' },
        { state: 'Finishing', at: 35 * minute, eventId: 'e3' },
      ],
      sessionEnergyKwh: 3.4,
    });

    expect(result?.sequence).toEqual(['Preparing', 'Charging', 'Finishing']);
    expect(result?.stateDurations.map(({ state, durationMs }) => [state, durationMs])).toEqual([
      ['Charging', 30 * minute],
      ['Preparing', 5 * minute],
      ['Finishing', 5 * minute],
    ]);
    expect(result?.transitions.map(({ fromState, toState }) => [fromState, toState])).toEqual([
      ['Preparing', 'Charging'],
      ['Charging', 'Finishing'],
    ]);
    expect(result?.opportunity.findings).toEqual([]);
    expect(result?.unknowns).toContain('Interval-level power/current measurements are not available in the loaded session data.');
  });

  it('measures a material suspendedEV overlap with positive-power periods without inferring the cause', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 120 * minute,
      stateChanges: [
        { state: 'Preparing', at: 0, eventId: 'connect' },
        { state: 'SuspendedEV', at: 10 * minute, eventId: 'suspend' },
        { state: 'Charging', at: 70 * minute, eventId: 'resume' },
      ],
      opportunities: [{ start: 0, end: 120 * minute, power: 7_200, eventId: 'profile' }],
      events: [{ id: 'resume', eventName: 'STATUS_NOTIFICATION', at: 70 * minute }],
      sessionEnergyKwh: 4.1,
    });

    expect(result?.opportunity.connectedNonChargingMs).toBe(70 * minute);
    expect(result?.opportunity.connectedNonChargingShare).toBeCloseTo(70 / 120);
    expect(result?.opportunity.findings[0]).toMatchObject({
      kind: 'opportunity-overlap',
      states: ['SuspendedEV', 'Preparing'],
      impactMs: 70 * minute,
      opportunityMs: 120 * minute,
    });
    expect(result?.opportunity.findings[0].uncertainty).toContain(
      'The telemetry does not establish why the observed state persisted.'
    );
    expect(result?.segments[1].relatedEvents[0]).toMatchObject({ id: 'resume', name: 'STATUS_NOTIFICATION' });
  });

  it('handles suspendedEVSE and combines multiple schedule windows without double counting', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 120 * minute,
      stateChanges: [
        { state: 'Preparing', at: 0 },
        { state: 'SuspendedEVSE', at: 10 * minute },
        { state: 'Charging', at: 60 * minute },
      ],
      opportunities: [
        { start: 0, end: 60 * minute, power: 11 },
        { start: 30 * minute, end: 90 * minute, power: 7 },
      ],
    });

    expect(result?.opportunity.durationMs).toBe(90 * minute);
    expect(result?.opportunity.connectedNonChargingMs).toBe(60 * minute);
    expect(result?.opportunity.findings[0].states).toEqual(['SuspendedEVSE', 'Preparing']);
  });

  it('does not flag charger-imposed smart suspension but still evaluates other states', () => {
    const suspendedEvseOnly = analyzeChargingSessionBehavior({
      start: 0,
      end: 360 * minute,
      stateChanges: [{ state: 'SuspendedEVSE', at: 0 }],
      opportunities: [{ start: 0, end: 360 * minute, power: 7 }],
      smartChargingEnabled: true,
    });

    expect(suspendedEvseOnly?.opportunity.connectedNonChargingMs).toBe(360 * minute);
    expect(suspendedEvseOnly?.stateDurations[0]).toMatchObject({ state: 'SuspendedEVSE', durationMs: 360 * minute });
    expect(suspendedEvseOnly?.opportunity.findings).toEqual([]);

    const includesSuspendedEv = analyzeChargingSessionBehavior({
      start: 0,
      end: 360 * minute,
      stateChanges: [
        { state: 'SuspendedEVSE', at: 0 },
        { state: 'SuspendedEV', at: 300 * minute },
      ],
      opportunities: [{ start: 0, end: 360 * minute, power: 7 }],
      smartChargingEnabled: true,
    });

    expect(includesSuspendedEv?.opportunity.findings).toEqual([]);

    const includesFault = analyzeChargingSessionBehavior({
      start: 0,
      end: 360 * minute,
      stateChanges: [
        { state: 'Charging', at: 0 },
        { state: 'Faulted', at: 300 * minute },
      ],
      opportunities: [{ start: 0, end: 360 * minute, power: 7 }],
      smartChargingEnabled: true,
    });

    expect(includesFault?.opportunity.findings[0]).toMatchObject({
      kind: 'opportunity-overlap',
      states: ['Faulted'],
      impactMs: 60 * minute,
    });
  });

  it('does not elevate a short transient state to a material opportunity-loss finding', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 180 * minute,
      stateChanges: [
        { state: 'Charging', at: 0 },
        { state: 'SuspendedEV', at: 30 * minute },
        { state: 'Charging', at: 31 * minute },
      ],
      opportunities: [{ start: 0, end: 180 * minute, power: 7 }],
    });

    expect(result?.opportunity.connectedNonChargingMs).toBe(minute);
    expect(result?.opportunity.connectedNonChargingShare).toBeCloseTo(1 / 180);
    expect(result?.opportunity.findings).toEqual([]);
  });

  it('reports repeated state transitions while retaining their timestamps and event IDs', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 40 * minute,
      stateChanges: [
        { state: 'Charging', at: 0, eventId: 'a' },
        { state: 'SuspendedEV', at: 10 * minute, eventId: 'b' },
        { state: 'Charging', at: 15 * minute, eventId: 'c' },
        { state: 'SuspendedEV', at: 20 * minute, eventId: 'd' },
        { state: 'Charging', at: 25 * minute, eventId: 'e' },
      ],
    });

    expect(result?.repeatedTransitions).toContainEqual({
      fromState: 'Charging', toState: 'SuspendedEV', occurrences: 2, eventIds: ['b', 'd']
    });
    expect(result?.findings).toEqual([]);
    expect(result?.stateDurations.find(({ state }) => state === 'SuspendedEV'))
      .toMatchObject({ occurrences: 2, durationMs: 10 * minute });
  });

  it('preserves unknown connector states in the sequence and duration summary', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 30 * minute,
      stateChanges: [
        { state: 'VehicleWaitingForGrid', at: 0, eventId: 'x' },
        { state: 'Charging', at: 20 * minute, eventId: 'y' },
      ],
    });

    expect(result?.sequence).toEqual(['VehicleWaitingForGrid', 'Charging']);
    expect(result?.stateDurations[0]).toMatchObject({ state: 'VehicleWaitingForGrid', role: 'unknown' });
    expect(result?.unknowns.some((item) => item.includes('not classifiable'))).toBe(true);
  });

  it('keeps fault/disconnection state distinct and does not claim profile opportunity when none exists', () => {
    const result = analyzeChargingSessionBehavior({
      start: 0,
      end: 30 * minute,
      stateChanges: [
        { state: 'Charging', at: 0 },
        { state: 'Faulted', at: 10 * minute, eventId: 'fault' },
        { state: 'Disconnected', at: 20 * minute, eventId: 'disconnect' },
      ],
      events: [{ id: 'fault', eventName: 'FAULT', at: 10 * minute }],
    });

    expect(result?.sequence).toEqual(['Charging', 'Faulted', 'Disconnected']);
    expect(result?.stateDurations.every((state) => state.role !== 'unknown')).toBe(true);
    expect(result?.opportunity.source).toBe('unavailable');
    expect(result?.opportunity.findings).toEqual([]);
    expect(result?.unknowns).toContain('No positive-power charging-profile window is available for this session.');
  });

  it('handles missing timestamps, very short and very long sessions conservatively', () => {
    expect(analyzeChargingSessionBehavior({ start: 5, end: 5, stateChanges: [] })).toBeNull();
    const short = analyzeChargingSessionBehavior({
      start: 0,
      end: 1_000,
      stateChanges: [{ state: 'Charging', at: 0 }],
      opportunities: [{ start: 0, end: 1_000, power: 1 }],
    });
    const long = analyzeChargingSessionBehavior({
      start: 0,
      end: 30 * 24 * 60 * minute,
      stateChanges: [{ state: 'Charging', at: 0 }],
    });
    expect(short?.segments[0].durationMs).toBe(1_000);
    expect(long?.segments[0].durationMs).toBe(30 * 24 * 60 * minute);
  });
});