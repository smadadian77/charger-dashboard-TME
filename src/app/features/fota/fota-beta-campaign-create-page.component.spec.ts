import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaBetaCampaignCreatePageComponent } from './fota-beta-campaign-create-page.component';

describe('FotaBetaCampaignCreatePageComponent', () => {
  let fixture: ComponentFixture<FotaBetaCampaignCreatePageComponent>;
  let mutationCalls: number;

  beforeEach(() => {
    mutationCalls = 0;
    TestBed.configureTestingModule({
      imports: [FotaBetaCampaignCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: FotaApiService,
          useValue: {
            getMutationCapabilities: () => of({ ok: true, enabled: false, targetConfigured: false }),
            listPackages: () => of({
              ok: true,
              env: 'prod',
              data: { content: [{ vendor: 'ChargeDot', model: 'Model A', version: '1.0', beta: true, isPushable: true, approvalStatus: 'NOT_TESTED' }], totalElements: 1 }
            }),
            listWallboxes: () => of({
              ok: true,
              env: 'prod',
              data: { content: [{ serialNumber: 'TACW2243722S1650', model: 'Model A', beta: true }], totalElements: 1 }
            }),
            executeConfiguredMutation: () => {
              mutationCalls += 1;
              return of({ ok: true });
            }
          }
        },
        {
          provide: FotaEnvironmentService,
          useValue: { current$: of('prod'), current: () => 'prod' }
        }
      ]
    });

    fixture = TestBed.createComponent(FotaBetaCampaignCreatePageComponent);
    fixture.detectChanges();
  });

  it('loads beta targets but never submits while the local mutation gate is disabled', () => {
    const component = fixture.componentInstance;
    const serialNumber = 'TACW2243722S1650';

    component.form.controls.model.setValue('Model A');
    expect(component.eligibleWallboxes().map((wallbox) => wallbox.serialNumber)).toEqual([serialNumber]);
    expect(component.approvalStatus('1.0')).toBe('NOT_TESTED');
    expect(component.approvalStatus('missing')).toBe('Not supplied');
    component.selectEligibleWallboxes();
    expect(component.form.controls.betaWallboxesList.value).toEqual([serialNumber]);
    component.form.controls.firmwareVersion.setValue('1.0');
    component.clearWallboxSelection();
    expect(component.form.controls.betaWallboxesList.value).toEqual([]);
    component.form.controls.betaWallboxesList.setValue([serialNumber]);

    expect(component.canCreate()).toBe(false);
    component.createCampaign();
    expect(mutationCalls).toBe(0);
  });
});