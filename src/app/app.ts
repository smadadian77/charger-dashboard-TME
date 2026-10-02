import { Component, AfterViewInit } from '@angular/core';
import { initializeDashboardWhenReady } from './dashboard-bootstrap';

declare global {
  interface Window {
    initToyotaDashboard?: () => void;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements AfterViewInit {
  ngAfterViewInit(): void {
    initializeDashboardWhenReady(
      document,
      () => window.initToyotaDashboard,
      (callback, delay) => window.setTimeout(callback, delay)
    );
  }
}
