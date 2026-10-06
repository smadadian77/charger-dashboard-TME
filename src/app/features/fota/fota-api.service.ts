import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  FotaCampaign,
  FotaEnvironment,
  FotaLaunchedCampaign,
  FotaLaunchedCampaignResponse,
  FotaMetadata,
  FotaMutationCapabilities,
  FotaMutationResponse,
  FotaModelMatrixRow,
  FotaPackage,
  FotaPackageFilters,
  FotaPage,
  FotaPageQuery,
  FotaReadResponse,
  FotaWallbox,
  FotaWallboxFilters
} from './fota.models';

type QueryValue = string | number | boolean | readonly string[] | undefined;

@Injectable({ providedIn: 'root' })
export class FotaApiService {
  private readonly http = inject(HttpClient);

  getMutationCapabilities() {
    return this.http.get<FotaMutationCapabilities>('/api/fota/mutation-capabilities');
  }

  executeConfiguredMutation(operation: string, payload: unknown) {
    return this.http.post<FotaMutationResponse>(`/api/fota/mutations/${encodeURIComponent(operation)}`, payload);
  }

  listPackages(
    environment: FotaEnvironment,
    query: FotaPageQuery<FotaPackageFilters> & { beta: boolean }
  ) {
    const params = this.toParams({
      environment,
      page: query.page,
      size: query.size,
      beta: query.beta,
      ...query.filters
    });
    return this.read(environment, this.http.get<FotaReadResponse<FotaPage<FotaPackage>>>('/api/fota/packages', { params }));
  }

  getPackage(environment: FotaEnvironment, version: string, model: string, beta: boolean) {
    const params = this.toParams({ environment, version, model, beta });
    return this.read(environment, this.http.get<FotaReadResponse<FotaPackage>>('/api/fota/package', { params }));
  }

  listCampaigns(
    environment: FotaEnvironment,
    query: { page: number; size: number; beta: boolean }
  ) {
    const params = this.toParams({ environment, page: query.page, size: query.size, beta: query.beta });
    return this.read(environment, this.http.get<FotaReadResponse<FotaPage<FotaCampaign>>>('/api/fota/campaigns', { params }));
  }

  listLaunchedCampaigns(environment: FotaEnvironment, countryId: string, chargerModel: string) {
    const params = this.toParams({ environment, countryId, chargerModel });
    return this.read(environment, this.http.get<FotaReadResponse<FotaLaunchedCampaignResponse>>('/api/fota/campaigns/launched', { params }));
  }

  listLaunchedCampaignsByVendor(environment: FotaEnvironment, countryId: string, vendor: string) {
    const params = this.toParams({ environment, countryId, vendor });
    return this.read(environment, this.http.get<FotaReadResponse<FotaLaunchedCampaignResponse>>('/api/fota/campaigns/launched-by-vendor', { params }));
  }

  listWallboxes(
    environment: FotaEnvironment,
    query: FotaPageQuery<FotaWallboxFilters> & { beta?: boolean }
  ) {
    const params = this.toParams({
      environment,
      page: query.page,
      size: query.size,
      beta: query.beta,
      ...query.filters
    });
    return this.read(environment, this.http.get<FotaReadResponse<FotaPage<FotaWallbox>>>('/api/fota/wallboxes', { params }));
  }

  checkWallboxMembership(environment: FotaEnvironment, serialNumber: string) {
    const params = this.toParams({ environment, serialNumber });
    return this.read(environment, this.http.get<FotaReadResponse<FotaPage<FotaWallbox>>>('/api/fota/wallbox-membership', { params }));
  }

  getFilterMetadata(environment: FotaEnvironment) {
    const params = this.toParams({ environment });
    return this.read(environment, this.http.get<FotaReadResponse<FotaMetadata>>('/api/fota/metadata', { params }));
  }

  getModelMatrix(environment: FotaEnvironment) {
    const params = this.toParams({ environment });
    return this.read(
      environment,
      this.http.get<FotaReadResponse<FotaPage<FotaModelMatrixRow>>>('/api/fota/model-matrix', { params })
    );
  }

  private read<T>(environment: FotaEnvironment, request: Observable<T>): Observable<T> {
    return request.pipe(catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        window.dispatchEvent(new CustomEvent('dashboard-token-rejected', { detail: { environment } }));
      }
      return throwError(() => error);
    }));
  }

  private toParams(values: Record<string, QueryValue>): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || value === null || value === '') continue;
      const queryKey = key === 'environment' ? 'env' : key;
      if (Array.isArray(value)) {
        for (const item of value) params = params.append(queryKey, item);
      } else {
        params = params.set(queryKey, String(value));
      }
    }
    return params;
  }
}