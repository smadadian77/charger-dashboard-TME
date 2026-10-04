import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent, map, merge, Subject } from 'rxjs';
import { FotaEnvironment } from './fota.models';

function isFotaEnvironment(value: string | null): value is FotaEnvironment {
  return value === 'prod' || value === 'acc' || value === 'prev';
}

@Injectable({ providedIn: 'root' })
export class FotaEnvironmentService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly sessionRefresh = new Subject<void>();
  private readonly currentValue = signal<FotaEnvironment>(this.readSavedEnvironment());
  readonly current = this.currentValue.asReadonly();
  readonly current$ = merge(
    toObservable(this.current),
    this.sessionRefresh.pipe(map(() => this.currentValue()))
  );

  constructor() {
    fromEvent<CustomEvent<{ environment: string }>>(window, 'dashboard-environment-change')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const environment = event.detail?.environment ?? null;
        if (isFotaEnvironment(environment)) this.setCurrent(environment);
      });
    fromEvent<CustomEvent<{ environment?: string }>>(window, 'dashboard-session-ready')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        const environment = event.detail?.environment ?? null;
        if (isFotaEnvironment(environment) && environment === this.currentValue()) {
          this.sessionRefresh.next();
        }
      });
  }

  setCurrent(environment: FotaEnvironment): void {
    this.currentValue.set(environment);
    localStorage.setItem('wallbox_env', environment);
  }

  private readSavedEnvironment(): FotaEnvironment {
    const saved = localStorage.getItem('wallbox_env');
    return isFotaEnvironment(saved) ? saved : 'prod';
  }
}