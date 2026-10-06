import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, finalize, switchMap, tap } from 'rxjs';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaModelMatrixRow } from './fota.models';

@Component({
  selector: 'app-fota-model-matrix-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fota-model-matrix-page.component.html'
})
export class FotaModelMatrixPageComponent implements OnInit {
  private readonly api = inject(FotaApiService);
  private readonly environment = inject(FotaEnvironmentService);
  private readonly destroyRef = inject(DestroyRef);

  readonly rows = signal<FotaModelMatrixRow[]>([]);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filteredRows = computed(() => {
    const query = this.search().trim().toLocaleLowerCase();
    if (!query) return this.rows();
    return this.rows().filter((row) => [
      row.modelName,
      row.hardwareVersion,
      row.vendor,
      ...Object.entries(row.versionBinMap ?? {}).flat()
    ].some((value) => String(value ?? '').toLocaleLowerCase().includes(query)));
  });
  readonly mappingCount = computed(() => this.filteredRows()
    .reduce((count, row) => count + Object.keys(row.versionBinMap ?? {}).length, 0));

  ngOnInit(): void {
    this.environment.current$
      .pipe(
        switchMap((environment) => {
          this.loading.set(true);
          this.error.set(null);
          return this.api.getModelMatrix(environment).pipe(
            tap((response) => this.rows.set(response.data.content ?? [])),
            catchError((error: unknown) => {
              this.rows.set([]);
              this.error.set(this.errorMessage(error));
              return EMPTY;
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  versions(row: FotaModelMatrixRow): Array<{ version: string; filename: string }> {
    return Object.entries(row.versionBinMap ?? {}).map(([version, filename]) => ({ version, filename }));
  }

  setSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return 'No valid FOTA session is available for this environment.';
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return 'Your account does not have the required FOTA access role for this environment.';
    }
    return 'The model matrix could not be loaded. Try again later.';
  }
}