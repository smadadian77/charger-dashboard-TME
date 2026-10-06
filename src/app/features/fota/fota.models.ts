export type FotaEnvironment = 'prod' | 'acc' | 'prev';

export interface FotaReadResponse<T> {
  ok: boolean;
  env: FotaEnvironment;
  data: T;
  payload?: unknown;
  message?: string;
}

export interface FotaPage<T> {
  content: T[];
  totalElements: number;
  totalPages?: number;
  number?: number;
  size?: number;
}

export interface FotaPackage {
  vendor?: string;
  model: string;
  version: string;
  isPushable: boolean;
  releaseNotesUrl?: string | null;
  s3Uri?: string | null;
  firmwareUri?: string | null;
  testReportUri?: string | null;
  approvalStatus?: string | null;
  archived?: boolean;
  beta?: boolean;
}

export interface FotaCampaign {
  campaignId: string;
  chargerModel: string;
  firmwareVersion: string;
  serialNumbers?: Array<{ serialNumber: string; status?: string | null }> | null;
  createdOn?: string | null;
  updatedOn?: string | null;
  parent?: string | null;
  children?: unknown[] | null;
  overallCampaignStatus?: string | null;
  beta?: boolean;
}

export interface FotaLaunchedCampaign {
  campaignId: string;
  firmwareVersion: string;
  overallCampaignStatus?: string;
  isPushable?: boolean;
  parent?: string | null;
  children?: unknown[] | null;
}

export interface FotaLaunchedCampaignResponse {
  launchedCampaignsList: FotaLaunchedCampaign[];
}

export interface FotaWallbox {
  serialNumber: string;
  model?: string | null;
  version?: string | null;
  connectors?: Array<{ status?: string | null }> | null;
  countryId?: string | null;
  pendingCampaignList?: unknown[] | null;
  beta?: boolean;
}

export interface FotaPackageFilters {
  vendor?: string;
  model?: string;
  version?: string;
  isPushable?: boolean;
  approvalStatus?: string;
  unassignedCampaign?: boolean;
}

export interface FotaWallboxFilters {
  serialNumber?: string;
  model?: string;
  version?: string;
  status?: string;
  countryIds?: string[];
}

export interface FotaPageQuery<TFilters> {
  page: number;
  size: number;
  filters?: TFilters;
}

export interface FotaMetadata {
  models?: { data?: { models?: string[] } };
  versions?: { data?: { firmwaresVersion?: string[] } };
  statuses?: { data?: { connectorsStatus?: string[] } };
  countries?: { data?: { countries?: Array<{ countryId?: string }> } };
}

export interface FotaMutationCapabilities {
  ok: boolean;
  enabled: boolean;
  targetConfigured: boolean;
  reason?: string | null;
}

export interface FotaMutationResponse {
  ok: boolean;
  status?: number;
  response?: unknown;
  message?: string;
}

export interface FotaModelMatrixRow {
  modelName: string;
  hardwareVersion: string;
  vendor?: string | null;
  versionBinMap: Record<string, string>;
}