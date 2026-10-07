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
  contactInfoOpen = false;
  profilePopoverTop = 0;
  profilePopoverLeft = 0;
  profilePopoverWidth = 0;
  readonly mockUser = {
    name: 'Sagiad Madadian',
    contactInfo: [
      { label: 'Work location', value: 'Toyota European Headquarters' },
      { label: 'Work phone', value: 'Not set' },
      { label: 'Company', value: 'TOYOTA MOTOR EUROPE NV/SA' },
      { label: 'Job title', value: 'SUPPLIER' },
      { label: 'Department', value: 'EV & ALLIANCE PROJECTS' },
      { label: 'Business address', value: 'Not set' },
      { label: 'Alias', value: 'SMA8038' },
      { label: 'Cost center', value: 'Not set' }
    ]
  };

  closeContactInfoOnOutside(event: MouseEvent): void {
    if (event.target instanceof Element && !event.target.closest('.profile-menu-anchor')) {
      this.contactInfoOpen = false;
    }
  }

  toggleContactInfo(event: MouseEvent): void {
    if (this.contactInfoOpen) {
      this.contactInfoOpen = false;
      return;
    }

    const trigger = event.currentTarget as HTMLElement;
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 20, window.innerWidth <= 640 ? 420 : 540);
    this.profilePopoverTop = bounds.bottom + 8;
    this.profilePopoverLeft = Math.max(10, Math.min(bounds.right - width, window.innerWidth - width - 10));
    this.profilePopoverWidth = width;
    this.contactInfoOpen = true;
  }

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
