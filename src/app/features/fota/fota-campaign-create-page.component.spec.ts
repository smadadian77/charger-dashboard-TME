import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { FotaApiService } from './fota-api.service';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaCampaignCreatePageComponent } from './fota-campaign-create-page.component';

describe('FotaCampaignCreatePageComponent', () => {
  let fixture: ComponentFixture<FotaCampaignCreatePageComponent>;
  let mutationCalls: number;

  beforeEach(() => {
    mutationCalls = 0;
    TestBed.configureTestingModule({
      imports: [FotaCampaignCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: FotaApiService,
          useValue: {
            getMutationCapabilities: () => of({
              ok: true,
              enabled: false,
              targetConfigured: false,
              reason: 'Mutations are disabled.'
            }),
            listPackages: () => of({
              ok: true,
              env: 'prod',
              data: {
                content: [{ vendor: 'ChargeDot', model: 'Model A', version: '1.0', isPushable: true }],
                totalElements: 1
              }
            }),
            getFilterMetadata: () => of({
              ok: true,
              env: 'prod',
              data: { countries: { data: { countries: [{ countryId: 'BE' }] } } }
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

    fixture = TestBed.createComponent(FotaCampaignCreatePageComponent);
    fixture.detectChanges();
  });

  it('syncs country control state and blocks submission when mutations are disabled', () => {
    const component = fixture.componentInstance;
    const countryControl = component.form.controls.countryId;

    expect(component.loading()).toBe(false);
    expect(countryControl.enabled).toBe(true);

    component.form.controls.panEuropean.setValue(true);
    expect(countryControl.disabled).toBe(true);

    component.form.controls.panEuropean.setValue(false);
    expect(countryControl.enabled).toBe(true);
    expect(component.versions()).toEqual([]);

    component.form.controls.vendor.setValue('ChargeDot');
    component.form.controls.model.setValue('Model A');
    expect(component.versions()).toEqual(['1.0']);
    component.form.controls.firmwareVersion.setValue('1.0');
    expect(component.childVersions()).toEqual([]);

    component.form.setValue({
      vendor: 'ChargeDot',
      model: 'Model A',
      countryId: 'BE',
      panEuropean: false,
      firmwareVersion: '1.0',
      linkedCampaign: false,
      childVersion: ''
    });
    expect(component.canCreate()).toBe(false);

    component.createCampaign();
    expect(mutationCalls).toBe(0);
  });
});