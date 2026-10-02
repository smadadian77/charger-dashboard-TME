import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeDashboardWhenReady } from './dashboard-bootstrap';

describe('App bootstrap bridge', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits for both the token control and dashboard initializer', () => {
    let tokenControlExists = false;
    let dashboardInitializer: (() => void) | undefined;
    const initializeDashboard = vi.fn();
    const scheduledRetries: Array<() => void> = [];
    const root = {
      getElementById: vi.fn(() => tokenControlExists ? {} as HTMLElement : null)
    };

    initializeDashboardWhenReady(
      root,
      () => dashboardInitializer,
      (callback) => scheduledRetries.push(callback)
    );

    expect(initializeDashboard).not.toHaveBeenCalled();
    expect(scheduledRetries).toHaveLength(1);

    tokenControlExists = true;
    dashboardInitializer = initializeDashboard;
    scheduledRetries.shift()?.();

    expect(initializeDashboard).toHaveBeenCalledOnce();
  });
});