import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EMPTY, catchError, finalize, forkJoin, startWith, switchMap, tap } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaMetadata, FotaPackage, FotaWallbox } from './fota.models';

@Component({
  selector: 'app-fota-beta-campaign-create-page',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './fota-beta-campaign-create-page.component.html'
})
export class FotaBetaCampaignCreatePageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('createBetaCampaignDialog') private createBetaCampaignDialog?: ElementRef<HTMLDialogElement>;

  readonly form = new FormGroup({
    model: new FormControl('', { nonNullable: true }),
    firmwareVersion: new FormControl('', { nonNullable: true }),
    linkedCampaign: new FormControl(false, { nonNullable: true }),
    childVersion: new FormControl('', { nonNullable: true }),
    betaWallboxesList: new FormControl<string[]>([], { nonNullable: true }),
    directPush: new FormControl(false, { nonNullable: true })
  });
  private readonly selectedModel = toSignal(
    this.form.controls.model.valueChanges.pipe(startWith(this.form.controls.model.value)),
    { initialValue: this.form.controls.model.value }
  );
  private readonly selectedFirmwareVersion = toSignal(
    this.form.controls.firmwareVersion.valueChanges.pipe(startWith(this.form.controls.firmwareVersion.value)),
    { initialValue: this.form.controls.firmwareVersion.value }
  );

  readonly packages = signal<FotaPackage[]>([]);
  readonly wallboxes = signal<FotaWallbox[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly mutationCapabilities = signal<{ enabled: boolean; reason?: string | null } | null>(null);
  readonly mutationLoading = signal(false);
  readonly mutationError = signal<string | null>(null);
  readonly mutationSuccess = signal<string | null>(null);
  readonly models = computed(() => [...new Set(this.packages().map((item) => item.model).filter(Boolean))].sort());
  readonly versions = computed(() => this.packages()
    .filter((item) => item.model === this.selectedModel() && (item.beta ?? true))
    .map((item) => item.version)
    .filter((version, index, values) => Boolean(version) && values.indexOf(version) === index)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })));
  readonly childVersions = computed(() => this.versions().filter((version) => version !== this.selectedFirmwareVersion()));
  readonly eligibleWallboxes = computed(() => this.wallboxes()
    .filter((item) => item.beta && item.model === this.selectedModel())
    .sort((a, b) => a.serialNumber.localeCompare(b.serialNumber)));

  ngOnInit(): void {
    this.api.getMutationCapabilities()
      .pipe(catchError(() => EMPTY), takeUntilDestroyed(this.destroyRef))
      .subscribe((capabilities) => this.mutationCapabilities.set(capabilities));

    this.environment.current$
      .pipe(
        switchMap((environment) => {
          this.loading.set(true);
          this.loadError.set(null);
          return forkJoin({
            packages: this.api.listPackages(environment, { page: 0, size: 100, beta: true }),
            wallboxes: this.api.listWallboxes(environment, { page: 0, size: 100, beta: true })
          }).pipe(
            tap(({ packages, wallboxes }) => {
              this.packages.set(packages.data.content ?? []);
              this.wallboxes.set(wallboxes.data.content ?? []);
              this.form.controls.model.setValue('');
              this.form.controls.firmwareVersion.setValue('');
              this.form.controls.childVersion.setValue('');
              this.form.controls.betaWallboxesList.setValue([]);
            }),
            catchError((error: unknown) => {
              this.packages.set([]);
              this.wallboxes.set([]);
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
    this.form.controls.betaWallboxesList.setValue([]);
  }

  toggleWallbox(serialNumber: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const selected = new Set(this.form.controls.betaWallboxesList.value);
    if (checked) selected.add(serialNumber);
    else selected.delete(serialNumber);
    this.form.controls.betaWallboxesList.setValue([...selected]);
  }

  isWallboxSelected(serialNumber: string): boolean {
    return this.form.controls.betaWallboxesList.value.includes(serialNumber);
  }

  approvalStatus(version: string): string {
    return this.packages().find((item) =>
      item.model === this.selectedModel() && item.version === version && item.beta
    )?.approvalStatus || 'Not supplied';
  }

  selectEligibleWallboxes(): void {
    this.form.controls.betaWallboxesList.setValue(this.eligibleWallboxes().map((item) => item.serialNumber));
  }

  clearWallboxSelection(): void {
    this.form.controls.betaWallboxesList.setValue([]);
  }

  canCreate(): boolean {
    const value = this.form.getRawValue();
    return Boolean(
      this.mutationCapabilities()?.enabled &&
      !this.loading() &&
      value.model &&
      value.firmwareVersion &&
      value.betaWallboxesList.length > 0 &&
      (!value.linkedCampaign || value.childVersion) &&
      !this.mutationLoading()
    );
  }

  requestCreate(): void {
    if (!this.canCreate()) return;
    this.mutationError.set(null);
    this.createBetaCampaignDialog?.nativeElement.showModal();
  }

  closeCreateDialog(): void {
    if (this.mutationLoading()) return;
    this.createBetaCampaignDialog?.nativeElement.close();
  }

  createCampaign(): void {
    if (!this.canCreate()) return;
    const value = this.form.getRawValue();
    const campaign = {
      model: value.model,
      betaWallboxesList: value.betaWallboxesList,
      directPush: value.directPush,
      ...(value.linkedCampaign ? { childrenVersions: [value.childVersion] } : {})
    };

    this.mutationLoading.set(true);
    this.mutationError.set(null);
    this.mutationSuccess.set(null);
    this.api.executeConfiguredMutation('create-beta-campaign', {
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
      this.createBetaCampaignDialog?.nativeElement.close();
      this.mutationSuccess.set('The local mock accepted the beta campaign request. Check the registry to verify its result.');
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'No valid saved session is available for this environment.';
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Your account does not have the required FOTA tester role for this environment.';
    }
    if (error instanceof HttpErrorResponse && error.status === 501) {
      return 'FOTA is not configured for this environment.';
    }
    return 'Beta campaign data could not be loaded. Try again later.';
  }
}