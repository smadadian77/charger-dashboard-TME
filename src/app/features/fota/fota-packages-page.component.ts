import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject, EMPTY, Subscription, combineLatest, finalize, switchMap, tap, catchError } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaPackage, FotaPackageFilters, FotaPageQuery } from './fota.models';

interface PackageQuery extends FotaPageQuery<FotaPackageFilters> {
  beta: boolean;
}

@Component({
  selector: 'app-fota-packages-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './fota-packages-page.component.html'
})
export class FotaPackagesPageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly query = new BehaviorSubject<PackageQuery>({ page: 0, size: 5, beta: false, filters: {} });
  private readonly queryState = toSignal(this.query, { initialValue: this.query.value });

  @ViewChild('packageDetails') private packageDetails?: ElementRef<HTMLDialogElement>;
  @ViewChild('readinessDialog') private readinessDialog?: ElementRef<HTMLDialogElement>;

  readonly isBeta = signal(false);
  readonly packages = signal<FotaPackage[]>([]);
  readonly totalItems = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedPackage = signal<FotaPackage | null>(null);
  readonly mutationCapabilities = signal<{ enabled: boolean; reason?: string | null } | null>(null);
  readonly pendingReadinessPackage = signal<FotaPackage | null>(null);
  readonly mutationLoading = signal(false);
  readonly mutationError = signal<string | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<string | null>(null);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.queryState().size)));
  readonly currentPage = computed(() => this.queryState().page + 1);
  readonly rangeStart = computed(() => this.totalItems() === 0 ? 0 : this.queryState().page * this.queryState().size + 1);
  readonly rangeEnd = computed(() => Math.min((this.queryState().page + 1) * this.queryState().size, this.totalItems()));

  readonly filters = new FormGroup({
    vendor: new FormControl('', { nonNullable: true }),
    model: new FormControl('', { nonNullable: true }),
    version: new FormControl('', { nonNullable: true }),
    isPushable: new FormControl('', { nonNullable: true }),
    approvalStatus: new FormControl('', { nonNullable: true })
  });

  private detailRequest?: Subscription;

  ngOnInit(): void {
    this.api.getMutationCapabilities()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((capabilities) => this.mutationCapabilities.set(capabilities));

    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((data) => {
      const beta = data['beta'] === true;
      this.isBeta.set(beta);
      this.query.next({ ...this.query.value, page: 0, beta });
    });

    combineLatest([this.environment.current$, this.query])
      .pipe(
        switchMap(([environment, query]) => {
          this.loading.set(true);
          this.error.set(null);
          return this.api.listPackages(environment, query).pipe(
            tap((response) => {
              this.packages.set(response.data.content ?? []);
              this.totalItems.set(response.data.totalElements ?? 0);
            }),
            catchError((error: unknown) => {
              this.packages.set([]);
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
    const filters: FotaPackageFilters = {};
    if (values.vendor) filters.vendor = values.vendor;
    if (values.model.trim()) filters.model = values.model.trim();
    if (values.version.trim()) filters.version = values.version.trim();
    if (!this.isBeta() && values.isPushable) filters.isPushable = values.isPushable === 'true';
    if (this.isBeta() && values.approvalStatus) filters.approvalStatus = values.approvalStatus;
    this.query.next({ ...this.query.value, page: 0, filters });
  }

  resetFilters(): void {
    this.filters.reset({ vendor: '', model: '', version: '', isPushable: '', approvalStatus: '' });
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

  openDetails(item: FotaPackage): void {
    this.detailRequest?.unsubscribe();
    this.selectedPackage.set(item);
    this.detailError.set(null);
    this.packageDetails?.nativeElement.showModal();

    if (!item.version || !item.model) {
      this.detailError.set('Package details are unavailable for this record.');
      return;
    }

    this.detailLoading.set(true);
    this.detailRequest = this.api.getPackage(
      this.environment.current(),
      item.version,
      item.model,
      item.beta ?? this.isBeta()
    ).subscribe({
      next: (response) => {
        this.selectedPackage.set(response.data);
        this.detailLoading.set(false);
      },
      error: (error: unknown) => {
        this.detailError.set(this.errorMessage(error));
        this.detailLoading.set(false);
      }
    });
  }

  closeDetails(): void {
    this.detailRequest?.unsubscribe();
    this.detailLoading.set(false);
    this.packageDetails?.nativeElement.close();
    this.selectedPackage.set(null);
  }

  requestReadinessChange(item: FotaPackage): void {
    if (!this.mutationCapabilities()?.enabled || !item.version || !item.model) return;
    this.mutationError.set(null);
    this.pendingReadinessPackage.set(item);
    this.readinessDialog?.nativeElement.showModal();
  }

  closeReadinessDialog(): void {
    if (this.mutationLoading()) return;
    this.readinessDialog?.nativeElement.close();
    this.pendingReadinessPackage.set(null);
  }

  onReadinessDialogClosed(): void {
    if (!this.mutationLoading()) this.pendingReadinessPackage.set(null);
  }

  confirmReadinessChange(): void {
    const item = this.pendingReadinessPackage();
    if (!item?.version || !item.model || !this.mutationCapabilities()?.enabled || this.mutationLoading()) return;

    this.mutationLoading.set(true);
    this.mutationError.set(null);
    const beta = item.beta ?? this.isBeta();
    const operation = beta ? 'approve-beta-firmware' : 'firmware-readiness';
    const payload = beta
      ? { version: item.version, model: item.model, beta, testReportUri: item.testReportUri ?? null }
      : { version: item.version, model: item.model, beta, enabled: !item.isPushable };
    this.api.executeConfiguredMutation(operation, payload).pipe(
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
      this.readinessDialog?.nativeElement.close();
      this.pendingReadinessPackage.set(null);
      this.query.next({ ...this.query.value });
    });
  }

  packageKey(item: FotaPackage): string {
    return `${item.vendor ?? ''}:${item.model}:${item.version}:${item.beta ?? false}`;
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
    return 'Firmware packages could not be loaded. Try again later.';
  }
}