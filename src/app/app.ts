import { Component, AfterViewInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { initializeDashboardWhenReady } from './dashboard-bootstrap';
import { findSerialSuggestions, isValidChargerSerial, normalizeSerialNumber } from './serial-number-utils';
import { classifyAssistantFailure, extractRequestedSessionId, hasInvestigableSignal, resolveFocusSessions } from './investigation-assistant-utils';
import { analyzeChargingSessionBehavior } from './charging-session-behavior';

declare global {
  interface Window {
    initToyotaDashboard?: () => void;
    initToyotaDashboardHeader?: () => void;
    dashboardSerialUtils?: {
      findSerialSuggestions: typeof findSerialSuggestions;
      isValidChargerSerial: typeof isValidChargerSerial;
      normalizeSerialNumber: typeof normalizeSerialNumber;
    };
    dashboardAssistantUtils?: {
      classifyAssistantFailure: typeof classifyAssistantFailure;
      extractRequestedSessionId: typeof extractRequestedSessionId;
      hasInvestigableSignal: typeof hasInvestigableSignal;
      resolveFocusSessions: typeof resolveFocusSessions;
    };
    chargingSessionBehaviorUtils?: {
      analyzeChargingSessionBehavior: typeof analyzeChargingSessionBehavior;
    };
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
    window.dashboardSerialUtils = { findSerialSuggestions, isValidChargerSerial, normalizeSerialNumber };
    window.dashboardAssistantUtils = { classifyAssistantFailure, extractRequestedSessionId, hasInvestigableSignal, resolveFocusSessions };
    window.chargingSessionBehaviorUtils = { analyzeChargingSessionBehavior };
    const script = document.createElement('script');
    script.src = `/dashboard-engine.js?v=${Date.now()}`;
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
      document.getElementById('kubernetesServiceGrid')?.addEventListener('click', (event: MouseEvent) => {
        if (!(event.target instanceof Element) || !event.target.closest('.kubernetes-service-tile')) return;
        window.setTimeout(() => {
          const detail = document.getElementById('kubernetesServiceDetail');
          if (!detail || detail.hidden) return;
          const headerHeight = document.querySelector('.topbar')?.getBoundingClientRect().height || 0;
          const top = detail.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
          window.scrollTo({ top, behavior: 'smooth' });
        }, 0);
      });
    }, { once: true });
    script.addEventListener('error', () => console.error('Dashboard engine failed to load.'), { once: true });
    document.head.append(script);
  }
}
