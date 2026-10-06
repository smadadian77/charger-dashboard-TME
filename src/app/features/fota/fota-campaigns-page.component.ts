import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BehaviorSubject, EMPTY, combineLatest, catchError, finalize, switchMap, tap } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaCampaign } from './fota.models';

interface CampaignQuery {
  page: number;
  size: number;
  beta: boolean;
}

@Component({
  selector: 'app-fota-campaigns-page',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './fota-campaigns-page.component.html',
})
export class FotaCampaignsPageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly query = new BehaviorSubject<CampaignQuery>({ page: 0, size: 5, beta: false });
  private readonly queryState = toSignal(this.query, { initialValue: this.query.value });

  readonly isBeta = signal(false);
  readonly campaigns = signal<FotaCampaign[]>([]);
  readonly totalItems = signal(0);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selectedCampaign = signal<FotaCampaign | null>(null);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.queryState().size)));
  readonly currentPage = computed(() => this.queryState().page + 1);
  readonly rangeStart = computed(() => this.totalItems() === 0 ? 0 : this.queryState().page * this.queryState().size + 1);
  readonly rangeEnd = computed(() => Math.min((this.queryState().page + 1) * this.queryState().size, this.totalItems()));

  @ViewChild('campaignDetails') private campaignDetails?: ElementRef<HTMLDialogElement>;

  ngOnInit(): void {
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
          return this.api.listCampaigns(environment, query).pipe(
            tap((response) => {
              this.campaigns.set(response.data.content ?? []);
              this.totalItems.set(response.data.totalElements ?? 0);
            }),
            catchError((error: unknown) => {
              this.campaigns.set([]);
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

  setPageSize(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    if ([5, 10, 25, 50].includes(size)) this.query.next({ ...this.query.value, page: 0, size });
  }

  changePage(delta: number): void {
    const nextPage = Math.min(Math.max(this.query.value.page + delta, 0), this.pageCount() - 1);
    if (nextPage !== this.query.value.page) this.query.next({ ...this.query.value, page: nextPage });
  }

  targetSummary(campaign: FotaCampaign): string {
    const targets = campaign.serialNumbers ?? [];
    const serialNumbers = targets.map((target) => target.serialNumber).filter(Boolean);
    return serialNumbers.length ? serialNumbers.join(', ') : 'No target chargers';
  }

  targetStatusSummary(campaign: FotaCampaign): string {
    const counts = (campaign.serialNumbers ?? []).reduce<Record<string, number>>((result, target) => {
      const status = target.status || 'Not supplied';
      result[status] = (result[status] ?? 0) + 1;
      return result;
    }, {});
    return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(', ') || 'Not supplied';
  }

  openDetails(campaign: FotaCampaign): void {
    this.selectedCampaign.set(campaign);
    this.campaignDetails?.nativeElement.showModal();
  }

  closeDetails(): void {
    this.campaignDetails?.nativeElement.close();
    this.selectedCampaign.set(null);
  }

  formatTimestamp(value: string | null | undefined): string {
    if (!value) return 'Not supplied';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
    return 'Campaigns could not be loaded. Try again later.';
  }
}