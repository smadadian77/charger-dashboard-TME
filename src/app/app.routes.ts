import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: 'fota',
		loadChildren: () => import('./features/fota/fota.routes').then((module) => module.FOTA_ROUTES)
	}
];
