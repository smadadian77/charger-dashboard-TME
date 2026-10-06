import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaBetaWallboxesPageComponent } from './fota-beta-wallboxes-page.component';

describe('FotaBetaWallboxesPageComponent serial controls', () => {
  let fixture: ComponentFixture<FotaBetaWallboxesPageComponent>;
  let membershipRequests: string[];
  let wallboxQueries: Array<{ filters?: { serialNumber?: string } }>;

  beforeEach(() => {
    membershipRequests = [];
    wallboxQueries = [];
    TestBed.configureTestingModule({
      imports: [FotaBetaWallboxesPageComponent],
      providers: [
        {
          provide: FotaApiService,
          useValue: {
            getMutationCapabilities: () => of({ ok: true, enabled: false, targetConfigured: false }),
            getFilterMetadata: () => of({ ok: true, env: 'prod', data: {} }),
            listWallboxes: (_environment: string, query: { filters?: { serialNumber?: string } }) => {
              wallboxQueries.push(query);
              return of({ ok: true, env: 'prod', data: { content: [], totalElements: 0 } });
            },
            checkWallboxMembership: (_environment: string, serial: string) => {
              membershipRequests.push(serial);
              return of({ ok: true, env: 'prod', data: { content: [] } });
            }
          }
        },
        { provide: FotaEnvironmentService, useValue: { current$: of('prod'), current: () => 'prod' } }
      ]
    });

    fixture = TestBed.createComponent(FotaBetaWallboxesPageComponent);
    fixture.detectChanges();
  });

  it('canonicalizes the serial filter before sending it to the API', () => {
    const component = fixture.componentInstance;
    component.filters.controls.serialNumber.setValue(' tacw 2244723s-0930 ');
    component.applyFilters();

    expect(wallboxQueries.at(-1)?.filters?.serialNumber).toBe('TACW2244723S0930');
  });

  it('normalizes membership lookups and rejects malformed input before the API call', () => {
    const component = fixture.componentInstance;
    component.membershipSerial.setValue('TACW 2244723S-0930 ');
    component.checkMembership();

    expect(membershipRequests).toEqual(['TACW2244723S0930']);
    expect(component.membershipSerial.value).toBe('TACW2244723S0930');

    component.membershipSerial.setValue('not a serial');
    component.checkMembership();
    expect(membershipRequests).toHaveLength(1);
    expect(component.membershipError()).toContain('complete TACW serial');
  });
});