import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject, EMPTY, combineLatest, catchError, finalize, switchMap, tap } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaEnvironment, FotaMetadata, FotaPageQuery, FotaWallbox, FotaWallboxFilters } from './fota.models';
import { isValidChargerSerial, normalizeSerialNumber } from '../../serial-number-utils';

interface WallboxQuery extends FotaPageQuery<FotaWallboxFilters> {
  beta: boolean;
}

@Component({
  selector: 'app-fota-beta-wallboxes-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './fota-beta-wallboxes-page.component.html'
})
export class FotaBetaWallboxesPageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly destroyRef = inject(DestroyRef);
  readonly query = new BehaviorSubject<WallboxQuery>({ page: 0, size: 5, beta: true, filters: {} });
  private readonly queryState = toSignal(this.query, { initialValue: this.query.value });

  readonly wallboxes = signal<FotaWallbox[]>([]);
  readonly totalItems = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedWallbox = signal<FotaWallbox | null>(null);
  readonly metadata = signal<FotaMetadata | null>(null);
  readonly metadataError = signal<string | null>(null);
  readonly mutationCapabilities = signal<{ enabled: boolean; reason?: string | null } | null>(null);
  readonly pendingMutation = signal<{ serialNumber: string; add: boolean } | null>(null);
  readonly mutationLoading = signal(false);
  readonly mutationError = signal<string | null>(null);
  readonly mutationSuccess = signal<string | null>(null);
  readonly membershipSerial = new FormControl('', { nonNullable: true });
  readonly membershipForm = new FormGroup({ serialNumber: this.membershipSerial });
  readonly membershipLoading = signal(false);
  readonly membershipResult = signal<string | null>(null);
  readonly membershipError = signal<string | null>(null);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.queryState().size)));
  readonly currentPage = computed(() => this.queryState().page + 1);
  readonly rangeStart = computed(() => this.totalItems() === 0 ? 0 : this.queryState().page * this.queryState().size + 1);
  readonly rangeEnd = computed(() => Math.min((this.queryState().page + 1) * this.queryState().size, this.totalItems()));

  readonly filters = new FormGroup({
    serialNumber: new FormControl('', { nonNullable: true }),
    model: new FormControl('', { nonNullable: true }),
    version: new FormControl('', { nonNullable: true }),
    status: new FormControl('', { nonNullable: true }),
    countryIds: new FormControl<string[]>([], { nonNullable: true })
  });

  @ViewChild('betaPoolMutationDialog') private betaPoolMutationDialog?: ElementRef<HTMLDialogElement>;
  @ViewChild('wallboxDetails') private wallboxDetails?: ElementRef<HTMLDialogElement>;

  readonly modelOptions = computed(() => this.metadata()?.models?.data?.models ?? []);
  readonly versionOptions = computed(() => this.metadata()?.versions?.data?.firmwaresVersion ?? []);
  readonly statusOptions = computed(() => this.metadata()?.statuses?.data?.connectorsStatus ?? []);
  readonly countryOptions = computed(() => (this.metadata()?.countries?.data?.countries ?? [])
    .map((country) => country.countryId)
    .filter((countryId): countryId is string => Boolean(countryId)));

  ngOnInit(): void {
    this.api.getMutationCapabilities()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((capabilities) => this.mutationCapabilities.set(capabilities));

    this.environment.current$
      .pipe(
        switchMap((environment) => {
          this.metadataError.set(null);
          return this.api.getFilterMetadata(environment).pipe(
            tap((response) => this.metadata.set(response.data)),
            catchError((error: unknown) => {
              this.metadataError.set(this.errorMessage(error));
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();

    combineLatest([this.environment.current$, this.query])
      .pipe(
        switchMap(([environment, query]) => {
          this.loading.set(true);
          this.error.set(null);
          return this.api.listWallboxes(environment, query).pipe(
            tap((response) => {
              this.wallboxes.set(response.data.content ?? []);
              this.totalItems.set(response.data.totalElements ?? 0);
            }),
            catchError((error: unknown) => {
              this.wallboxes.set([]);
              this.totalItems.set(0);
              this.error.set(this.errorMessage(error));
              return EMPTY;
            }),
            finalize(() => this.loading.set(false)),
            takeUntilDestroyed(this.destroyRef)
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  applyFilters(): void {
    const values = this.filters.getRawValue();
    const filters: FotaWallboxFilters = {};
    const serialNumber = normalizeSerialNumber(values.serialNumber);
    if (serialNumber) filters.serialNumber = serialNumber;
    if (values.model) filters.model = values.model;
    if (values.version) filters.version = values.version;
    if (values.status) filters.status = values.status;
    if (values.countryIds.length) filters.countryIds = values.countryIds;
    this.query.next({ ...this.query.value, page: 0, filters });
  }

  resetFilters(): void {
    this.filters.reset({ serialNumber: '', model: '', version: '', status: '', countryIds: [] });
    this.query.next({ ...this.query.value, page: 0, filters: {} });
  }

  setPageSize(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if ([5, 10, 25, 50].includes(size)) this.query.next({ ...this.query.value, page: 0, size });
  }

  changePage(delta: number): void {
    const nextPage = Math.min(Math.max(this.query.value.page + delta, 0), this.pageCount() - 1);
    if (nextPage !== this.query.value.page) this.query.next({ ...this.query.value, page: nextPage });
  }

  checkMembership(): void {
    const serial = normalizeSerialNumber(this.membershipForm.controls.serialNumber.value);
    if (!isValidChargerSerial(serial)) {
      this.membershipError.set('Enter a complete TACW serial number with 10 to 12 letters or numbers after the prefix.');
      this.membershipResult.set(null);
      return;
    }

    this.membershipSerial.setValue(serial);
    this.membershipLoading.set(true);
    this.membershipError.set(null);
    this.membershipResult.set(null);
    this.api.checkWallboxMembership(this.environment.current(), serial)
      .pipe(
        tap((response) => {
          const item = response.data.content?.[0];
          this.membershipResult.set(item ? item.beta ? 'This wallbox is in the beta pool.' : 'This wallbox is not in the beta pool.' : 'No matching wallbox was found.');
        }),
        catchError((error: unknown) => {
          this.membershipError.set(this.errorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.membershipLoading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  requestPoolMutation(item: FotaWallbox): void {
    if (!this.mutationCapabilities()?.enabled) return;
    this.mutationError.set(null);
    this.pendingMutation.set({ serialNumber: item.serialNumber, add: !item.beta });
    this.betaPoolMutationDialog?.nativeElement.showModal();
  }

  closePoolMutationDialog(): void {
    if (this.mutationLoading()) return;
    this.betaPoolMutationDialog?.nativeElement.close();
    this.pendingMutation.set(null);
  }

  onPoolMutationDialogClosed(): void {
    if (!this.mutationLoading()) this.pendingMutation.set(null);
  }

  confirmPoolMutation(): void {
    const operation = this.pendingMutation();
    if (!operation || !this.mutationCapabilities()?.enabled || this.mutationLoading()) return;

    this.mutationLoading.set(true);
    this.mutationError.set(null);
    this.api.executeConfiguredMutation(operation.add ? 'beta-wallbox-add' : 'beta-wallbox-remove', {
      serialNumber: operation.serialNumber
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
      this.betaPoolMutationDialog?.nativeElement.close();
      this.pendingMutation.set(null);
      this.mutationSuccess.set('The local mock accepted the beta-pool request. Refresh the list to verify its result.');
    });
  }

  get fotaEnvironment(): FotaEnvironment {
    return this.environment.current();
  }

  displayCountry(countryId: string | null | undefined): string {
    if (!countryId) return 'N/A';
    if (countryId === 'NI') return 'Northern Ireland';
    if (countryId === 'GB') return 'Great Britain';
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryId) || countryId;
    } catch {
      return countryId;
    }
  }

  connectorSummary(item: FotaWallbox): string {
    return (item.connectors ?? []).map((connector, index) =>
      `Connector ${connector.id ?? index + 1}: ${connector.status || 'N/A'}`
    ).join('; ') || 'Not supplied';
  }

  openDetails(item: FotaWallbox): void {
    this.selectedWallbox.set(item);
    this.wallboxDetails?.nativeElement.showModal();
  }

  closeDetails(): void {
    this.wallboxDetails?.nativeElement.close();
    this.selectedWallbox.set(null);
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
    return 'Beta wallboxes could not be loaded. Try again later.';
  }
}