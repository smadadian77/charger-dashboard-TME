import { Component, AfterViewInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { initializeDashboardWhenReady } from './dashboard-bootstrap';

declare global {
  interface Window {
    initToyotaDashboard?: () => void;
    initToyotaDashboardHeader?: () => void;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit {
  readonly isFotaRoute = window.location.pathname.startsWith('/fota');
  readonly currentPath = window.location.pathname;

  ngAfterViewInit(): void {
    const script = document.createElement('script');
    script.src = '/dashboard-engine.js';
    script.async = true;
    script.addEventListener('load', () => {
      if (this.isFotaRoute) {
        window.initToyotaDashboardHeader?.();
        return;
      }
      initializeDashboardWhenReady(
        document,
        () => window.initToyotaDashboard,
        (callback, delay) => window.setTimeout(callback, delay)
      );
    }, { once: true });
    script.addEventListener('error', () => console.error('Dashboard engine failed to load.'), { once: true });
    document.head.append(script);
  }
}
