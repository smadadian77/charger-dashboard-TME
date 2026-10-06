import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';

describe('FotaApiService', () => {
  let service: FotaApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(FotaApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('requests packages through the local API with observed filters and paging', () => {
    service.listPackages('acc', {
      page: 0,
      size: 5,
      beta: false,
      filters: { vendor: 'ChargeDot', isPushable: false }
    }).subscribe();

    const request = http.expectOne('/api/fota/packages?env=acc&page=0&size=5&beta=false&vendor=ChargeDot&isPushable=false');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: { content: [], totalElements: 0 } });
  });

  it('requests beta wallboxes through the local API with repeated country filters', () => {
    service.listWallboxes('acc', {
      page: 0,
      size: 5,
      beta: true,
      filters: { serialNumber: 'TACW2244723S0930', countryIds: ['BE', 'DE'] }
    }).subscribe();

    const request = http.expectOne((candidate) => candidate.url === '/api/fota/wallboxes');
    expect(request.request.method).toBe('GET');
    expect(request.request.params.get('beta')).toBe('true');
    expect(request.request.params.getAll('countryIds')).toEqual(['BE', 'DE']);
    request.flush({ ok: true, env: 'acc', data: { content: [], totalElements: 0 } });
  });

  it('requests package detail through the local API by version, model, and beta status', () => {
    service.getPackage('acc', '3.3.3', 'Terra AC', false).subscribe();

    const request = http.expectOne('/api/fota/package?env=acc&version=3.3.3&model=Terra%20AC&beta=false');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: { model: 'Terra AC', version: '3.3.3', isPushable: false, beta: false } });
  });

  it('requests campaign registry pages through the local API', () => {
    service.listCampaigns('acc', { page: 0, size: 5, beta: false }).subscribe();

    const request = http.expectOne('/api/fota/campaigns?env=acc&page=0&size=5&beta=false');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: { content: [], totalElements: 0 } });
  });

  it('requests Compleo launched campaigns by country and vendor', () => {
    service.listLaunchedCampaignsByVendor('acc', 'BE', 'COMPLEO').subscribe();

    const request = http.expectOne('/api/fota/campaigns/launched-by-vendor?env=acc&countryId=BE&vendor=COMPLEO');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: { launchedCampaignsList: [] } });
  });

  it('requests filter metadata through the local API', () => {
    service.getFilterMetadata('acc').subscribe();

    const request = http.expectOne('/api/fota/metadata?env=acc');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: {} });
  });

  it('requests the upload matrix through the local FOTA read API', () => {
    service.getModelMatrix('acc').subscribe();

    const request = http.expectOne('/api/fota/model-matrix?env=acc');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, env: 'acc', data: { content: [], totalElements: 0 } });
  });

  it('reads local mutation capabilities without calling a mutation endpoint', () => {
    service.getMutationCapabilities().subscribe();

    const request = http.expectOne('/api/fota/mutation-capabilities');
    expect(request.request.method).toBe('GET');
    request.flush({ ok: true, enabled: false, targetConfigured: false, reason: 'Mutations are disabled.' });
  });

  it('notifies the shared header when an environment-scoped FOTA read is unauthorized', () => {
    const rejected = vi.fn();
    window.addEventListener('dashboard-token-rejected', rejected, { once: true });
    service.listPackages('acc', { page: 0, size: 5, beta: false }).subscribe({ error: () => undefined });

    const request = http.expectOne((candidate) => candidate.url === '/api/fota/packages');
    request.flush({ ok: false, env: 'acc', message: 'Unauthorized.' }, { status: 401, statusText: 'Unauthorized' });

    expect(rejected).toHaveBeenCalledOnce();
    expect((rejected.mock.calls[0][0] as CustomEvent<{ environment: string }>).detail.environment).toBe('acc');
    window.removeEventListener('dashboard-token-rejected', rejected);
  });

  it('syncs the shared dashboard environment and refreshes FOTA readers after login', () => {
    const environment = TestBed.inject(FotaEnvironmentService);
    const emitted: string[] = [];
    const subscription = environment.current$.subscribe((value) => emitted.push(value));

    window.dispatchEvent(new CustomEvent('dashboard-environment-change', { detail: { environment: 'acc' } }));
    window.dispatchEvent(new CustomEvent('dashboard-session-ready', { detail: { environment: 'acc' } }));

    expect(environment.current()).toBe('acc');
    expect(emitted).toContain('acc');
    const emissionCount = emitted.length;
    window.dispatchEvent(new CustomEvent('dashboard-session-ready', { detail: { environment: 'prod' } }));
    expect(emitted).toHaveLength(emissionCount);
    subscription.unsubscribe();
  });

  it('sends a configured mutation only to the local application API mock', () => {
    const payload = { firmwareId: 'mock-firmware-id', enabled: true };
    service.executeConfiguredMutation('firmware-readiness', payload).subscribe();

    const request = http.expectOne('/api/fota/mutations/firmware-readiness');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({ ok: true, status: 200, response: { accepted: true } });
  });
});