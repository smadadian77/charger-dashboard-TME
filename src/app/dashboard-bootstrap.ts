type DashboardDocument = Pick<Document, 'getElementById'>;

type RetryScheduler = (callback: () => void, delay: number) => unknown;

export function initializeDashboardWhenReady(
  root: DashboardDocument,
  getInitializer: () => (() => void) | undefined,
  scheduleRetry: RetryScheduler
): void {
  const tryInitialize = (attempts = 0): void => {
    const initializeDashboard = getInitializer();
    if (root.getElementById('globalTokenRefresh') && typeof initializeDashboard === 'function') {
      initializeDashboard();
    } else if (attempts < 50) {
      scheduleRetry(() => tryInitialize(attempts + 1), 50);
    }
  };

  tryInitialize();
}