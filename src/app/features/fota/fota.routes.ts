import { Routes } from '@angular/router';

export const FOTA_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./fota-shell.component').then((module) => module.FotaShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'campaigns' },
      {
        path: 'matrix',
        loadComponent: () => import('./fota-model-matrix-page.component').then((module) => module.FotaModelMatrixPageComponent)
      },
      {
        path: 'packages',
        data: { beta: false },
        loadComponent: () => import('./fota-packages-page.component').then((module) => module.FotaPackagesPageComponent)
      },
      {
        path: 'campaigns',
        data: { beta: false },
        loadComponent: () => import('./fota-campaigns-page.component').then((module) => module.FotaCampaignsPageComponent)
      },
      {
        path: 'campaigns/create',
        loadComponent: () => import('./fota-campaign-create-page.component').then((module) => module.FotaCampaignCreatePageComponent)
      },
      {
        path: 'beta/packages',
        data: { beta: true },
        loadComponent: () => import('./fota-packages-page.component').then((module) => module.FotaPackagesPageComponent)
      },
      {
        path: 'beta/campaigns',
        data: { beta: true },
        loadComponent: () => import('./fota-campaigns-page.component').then((module) => module.FotaCampaignsPageComponent)
      },
      {
        path: 'beta/campaigns/create',
        loadComponent: () => import('./fota-beta-campaign-create-page.component').then((module) => module.FotaBetaCampaignCreatePageComponent)
      },
      {
        path: 'beta/wallboxes',
        loadComponent: () => import('./fota-beta-wallboxes-page.component').then((module) => module.FotaBetaWallboxesPageComponent)
      },
      { path: '**', redirectTo: 'packages' }
    ]
  }
];