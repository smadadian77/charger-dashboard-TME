import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FotaEnvironmentService } from './fota-environment.service';
import { FotaEnvironment } from './fota.models';

@Component({
  selector: 'app-fota-shell',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './fota-shell.component.html',
  styleUrl: './fota-shell.component.css'
})
export class FotaShellComponent {
  readonly environmentService = inject(FotaEnvironmentService);

  onEnvironmentChange(event: Event): void {
    const environment = (event.target as HTMLSelectElement).value;
    if (environment === 'prod' || environment === 'acc' || environment === 'prev') {
      this.environmentService.setCurrent(environment as FotaEnvironment);
    }
  }
}