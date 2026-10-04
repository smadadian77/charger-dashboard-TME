import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, Subscription, catchError, finalize, forkJoin, startWith, switchMap, tap } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaLaunchedCampaign, FotaMetadata, FotaPackage } from './fota.models';

@Component({
  selector: 'app-fota-campaign-create-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './fota-campaign-create-page.component.html'
})
export class FotaCampaignCreatePageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('createCampaignDialog') private createCampaignDialog?: ElementRef<HTMLDialogElement>;

  readonly form = new FormGroup({
    vendor: new FormControl('', { nonNullable: true }),
    model: new FormControl('', { nonNullable: true }),
    countryId: new FormControl('', { nonNullable: true }),
    panEuropean: new FormControl(false, { nonNullable: true }),
    firmwareVersion: new FormControl('', { nonNullable: true }),
    linkedCampaign: new FormControl(false, { nonNullable: true }),
    childVersion: new FormControl('', { nonNullable: true })
  });
  private readonly selectedModel = toSignal(
    this.form.controls.model.valueChanges.pipe(startWith(this.form.controls.model.value)),
    { initialValue: this.form.controls.model.value }
  );
  private readonly selectedVendor = toSignal(
    this.form.controls.vendor.valueChanges.pipe(startWith(this.form.controls.vendor.value)),
    { initialValue: this.form.controls.vendor.value }
  );
  private readonly selectedFirmwareVersion = toSignal(
    this.form.controls.firmwareVersion.valueChanges.pipe(startWith(this.form.controls.firmwareVersion.value)),
    { initialValue: this.form.controls.firmwareVersion.value }
  );
  readonly packages = signal<FotaPackage[]>([]);
  readonly metadata = signal<FotaMetadata | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly mutationCapabilities = signal<{ enabled: boolean; reason?: string | null } | null>(null);
  readonly mutationLoading = signal(false);
  readonly mutationError = signal<string | null>(null);
  readonly mutationSuccess = signal<string | null>(null);
  readonly launchedCampaigns = signal<FotaLaunchedCampaign[]>([]);
  readonly launchedLoading = signal(false);
  readonly launchedError = signal<string | null>(null);

  readonly countries = computed(() => (this.metadata()?.countries?.data?.countries ?? [])
    .map((country) => country.countryId)
    .filter((countryId): countryId is string => Boolean(countryId)));
  readonly vendors = computed(() => [...new Set(this.packages().map((item) => item.vendor || 'ChargeDot'))].sort());
  readonly models = computed(() => [...new Set(this.packages()
    .filter((item) => (item.vendor || 'ChargeDot') === this.selectedVendor())
    .map((item) => item.model)
    .filter(Boolean))].sort());
  readonly versions = computed(() => this.packages()
    .filter((item) => (item.vendor || 'ChargeDot') === this.selectedVendor())
    .filter((item) => this.selectedVendor() === 'COMPLEO' || item.model === this.selectedModel())
    .filter((item) => item.isPushable)
    .map((item) => item.version)
    .filter((version, index, values) => Boolean(version) && values.indexOf(version) === index)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
  readonly childVersions = computed(() => this.versions().filter((version) => version !== this.selectedFirmwareVersion()));

  private launchedRequest?: Subscription;

  ngOnInit(): void {
    this.form.controls.panEuropean.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((panEuropean) => {
        const countryControl = this.form.controls.countryId;
        if (panEuropean && countryControl.enabled) countryControl.disable({ emitEvent: false });
        if (!panEuropean && countryControl.disabled) countryControl.enable({ emitEvent: false });
      });

    this.api.getMutationCapabilities()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((capabilities) => this.mutationCapabilities.set(capabilities));

    this.environment.current$
      .pipe(
        switchMap((environment) => {
          this.loading.set(true);
          this.loadError.set(null);
          return forkJoin({
            packages: this.api.listPackages(environment, {
              page: 0,
              size: 100,
              beta: false,
              filters: { isPushable: true }
            }),
            metadata: this.api.getFilterMetadata(environment)
          }).pipe(
            tap(({ packages, metadata }) => {
              this.packages.set(packages.data.content ?? []);
              this.metadata.set(metadata.data);
            }),
            catchError((error: unknown) => {
              this.packages.set([]);
              this.metadata.set(null);
              this.loadError.set(this.errorMessage(error));
              return EMPTY;
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  onModelChange(): void {
    this.form.controls.firmwareVersion.setValue('');
    this.form.controls.childVersion.setValue('');
    this.clearLaunchedCampaigns();
  }

  onVendorChange(): void {
    this.form.controls.model.setValue('');
    this.form.controls.firmwareVersion.setValue('');
    this.form.controls.childVersion.setValue('');
    this.clearLaunchedCampaigns();
  }

  onCountryChange(): void {
    this.clearLaunchedCampaigns();
  }

  private clearLaunchedCampaigns(): void {
    this.launchedRequest?.unsubscribe();
    this.launchedRequest = undefined;
    this.launchedLoading.set(false);
    this.launchedCampaigns.set([]);
    this.launchedError.set(null);
  }

  canCreate(): boolean {
    const value = this.form.getRawValue();
    const vendorSupported = value.vendor === 'ChargeDot' || value.vendor === 'COMPLEO';
    const modelSelected = value.vendor === 'COMPLEO' || Boolean(value.model);
    return Boolean(
      this.mutationCapabilities()?.enabled &&
      !this.loading() &&
      vendorSupported &&
      modelSelected &&
      value.firmwareVersion &&
      (value.panEuropean || value.countryId) &&
      (!value.linkedCampaign || value.childVersion) &&
      !this.mutationLoading()
    );
  }

  loadLaunchedCampaigns(): void {
    const { vendor, model, countryId, panEuropean } = this.form.getRawValue();
    if (!vendor || !countryId || panEuropean || (vendor !== 'COMPLEO' && !model)) return;
    this.launchedRequest?.unsubscribe();
    this.launchedLoading.set(true);
    this.launchedError.set(null);
    const request = vendor === 'COMPLEO'
      ? this.api.listLaunchedCampaignsByVendor(this.environment.current(), countryId, vendor)
      : this.api.listLaunchedCampaigns(this.environment.current(), countryId, model);
    this.launchedRequest = request.pipe(
      tap((response) => this.launchedCampaigns.set(response.data.launchedCampaignsList ?? [])),
      catchError((error: unknown) => {
        this.launchedCampaigns.set([]);
        this.launchedError.set(this.errorMessage(error));
        return EMPTY;
      }),
      finalize(() => this.launchedLoading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  requestCreate(): void {
    if (!this.canCreate()) return;
    this.mutationError.set(null);
    this.createCampaignDialog?.nativeElement.showModal();
  }

  closeCreateDialog(): void {
    if (this.mutationLoading()) return;
    this.createCampaignDialog?.nativeElement.close();
  }

  createCampaign(): void {
    if (!this.canCreate()) return;
    const value = this.form.getRawValue();
    const compleoCampaign = value.vendor === 'COMPLEO';
    const campaign = {
      model: compleoCampaign ? null : value.model,
      ...(compleoCampaign ? { vendor: value.vendor } : {}),
      countryId: value.panEuropean ? null : value.countryId,
      ...(value.linkedCampaign ? { childrenVersions: [value.childVersion] } : {})
    };

    this.mutationLoading.set(true);
    this.mutationError.set(null);
    this.mutationSuccess.set(null);
    this.api.executeConfiguredMutation('create-campaign', {
      firmwareVersion: value.firmwareVersion,
      campaign
    }).pipe(
      catchError((error: unknown) => {
        this.mutationError.set(this.errorMessage(error));
        return EMPTY;
      }),
      finalize(() => this.mutationLoading.set(false)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((response) => {
      if (!response.ok) {
        this.mutationError.set(response.message || 'The local FOTA test operation failed.');
        return;
      }
      this.createCampaignDialog?.nativeElement.close();
      this.mutationSuccess.set('The local mock accepted the campaign request. Check the registry to verify its result.');
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'No valid saved session is available for this environment.';
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Your account does not have the required FOTA access role for this environment.';
    }
    if (error instanceof HttpErrorResponse && error.status === 501) {
      return 'FOTA is not configured for this environment.';
    }
    return 'Campaign data could not be loaded. Try again later.';
  }
}