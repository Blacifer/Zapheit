/**
 * Advanced Monitoring & Alerting System
 * 
 * Provides real-time monitoring of golden signals:
 * - Latency (p50, p95, p99)
 * - Error rate
 * - Traffic throughput
 * - Saturation (resource utilization)
 */

import { EventEmitter } from 'events';
import os from 'os';
import { logger } from './logger';

// Alert severity levels
export enum AlertSeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

// Alert interface
export interface Alert {
  id: string;
  name: string;
  severity: AlertSeverity;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
  duration_seconds?: number; // How long alert was active
}

// Monitoring configuration
export interface AlertRule {
  name: string;
  metric: string;
  condition: 'above' | 'below';
  threshold: number;
  duration_seconds: number; // Alert only if condition persists for this duration
  severity: AlertSeverity;
  enabled: boolean;
}

// Active alerts tracking
interface ActiveAlert {
  rule: AlertRule;
  startTime: number;
  lastValue: number;
}

export class AdvancedMonitoring extends EventEmitter {
  private alertRules: AlertRule[] = [];
  private activeAlerts: Map<string, ActiveAlert> = new Map();
  private alertHistory: Alert[] = [];
  private MAX_ALERT_HISTORY = 1000;

  constructor() {
    super();
    this.initializeDefaultRules();
  }

  /**
   * Initialize default alert rules based on production best practices
   */
  private initializeDefaultRules() {
    this.alertRules = [
      // Latency alerts
      {
        name: 'High Latency (P99)',
        metric: 'latency_p99_ms',
        condition: 'above',
        threshold: 5000,
        duration_seconds: 120,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'Elevated Latency (P95)',
        metric: 'latency_p95_ms',
        condition: 'above',
        threshold: 2000,
        duration_seconds: 300,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },

      // Error rate alerts
      {
        name: 'High Error Rate',
        metric: 'error_rate',
        condition: 'above',
        threshold: 5,
        duration_seconds: 120,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'Elevated Error Rate',
        metric: 'error_rate',
        condition: 'above',
        threshold: 1,
        duration_seconds: 300,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },

      // Traffic alerts
      {
        name: 'Traffic Spike',
        metric: 'rpm',
        condition: 'above',
        threshold: 2000,
        duration_seconds: 60,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },
      {
        name: 'Traffic Drop',
        metric: 'rpm',
        condition: 'below',
        threshold: 10,
        duration_seconds: 300,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },

      // Resource saturation
      {
        name: 'High CPU Usage',
        metric: 'cpu_percent',
        condition: 'above',
        threshold: 85,
        duration_seconds: 300,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },
      {
        name: 'Critical CPU Usage',
        metric: 'cpu_percent',
        condition: 'above',
        threshold: 95,
        duration_seconds: 60,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'High Memory Usage',
        metric: 'memory_percent',
        condition: 'above',
        threshold: 90,
        duration_seconds: 300,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },
      {
        name: 'Elevated Memory Usage',
        metric: 'memory_percent',
        condition: 'above',
        threshold: 75,
        duration_seconds: 300,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },

      // Database connection alerts
      {
        name: 'Database Connection Exhaustion',
        metric: 'db_connections_percent',
        condition: 'above',
        threshold: 80,
        duration_seconds: 60,
        severity: AlertSeverity.CRITICAL,
        enabled: true,
      },

      // Authentication alerts
      {
        name: 'High Auth Failure Rate',
        metric: 'auth_failure_rate',
        condition: 'above',
        threshold: 10,
        duration_seconds: 120,
        severity: AlertSeverity.WARNING,
        enabled: true,
      },
    ];
  }

  /**
   * Evaluate alerts against current metrics
   * Call this periodically (every 30 seconds)
   */
  public evaluateAlerts(metrics: any): Alert[] {
    const now = Date.now();
    const firedAlerts: Alert[] = [];

    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      const value = this.getMetricValue(metrics, rule.metric);
      if (value === null) continue;

      const conditionMet =
        (rule.condition === 'above' && value > rule.threshold) ||
        (rule.condition === 'below' && value < rule.threshold);

      // Get or create active alert
      let activeAlert = this.activeAlerts.get(rule.name);

      if (conditionMet) {
        if (!activeAlert) {
          // Alert condition just started
          activeAlert = {
            rule,
            startTime: now,
            lastValue: value,
          };
          this.activeAlerts.set(rule.name, activeAlert);
        } else {
          // Update value
          activeAlert.lastValue = value;
        }

        // Check if we've exceeded the duration threshold
        const durationSeconds = (now - activeAlert.startTime) / 1000;
        if (durationSeconds >= rule.duration_seconds) {
          // Fire the alert
          const alert: Alert = {
            id: `${rule.name}-${now}`,
            name: rule.name,
            severity: rule.severity,
            metric: rule.metric,
            value,
            threshold: rule.threshold,
            message: this.generateAlertMessage(rule, value),
            timestamp: now,
            duration_seconds: Math.round(durationSeconds),
          };

          firedAlerts.push(alert);

          // Emit event for external handlers
          this.emit('alert', alert);

          // Log the alert
          if (rule.severity === AlertSeverity.CRITICAL) {
            logger.error(`🚨 CRITICAL ALERT: ${alert.message}`, {
              metric: rule.metric,
              value,
              threshold: rule.threshold,
            });
          } else if (rule.severity === AlertSeverity.WARNING) {
            logger.warn(`⚠️  WARNING: ${alert.message}`, {
              metric: rule.metric,
              value,
              threshold: rule.threshold,
            });
          }
        }
      } else {
        // Condition no longer met
        if (activeAlert) {
          const durationSeconds = (now - activeAlert.startTime) / 1000;
          logger.info(`✅ Alert resolved: ${rule.name}`, {
            activeDuration: Math.round(durationSeconds),
            lastValue: activeAlert.lastValue,
          });

          this.activeAlerts.delete(rule.name);
        }
      }
    }

    // Store in history
    for (const alert of firedAlerts) {
      this.alertHistory.push(alert);
      if (this.alertHistory.length > this.MAX_ALERT_HISTORY) {
        this.alertHistory.shift();
      }
    }

    return firedAlerts;
  }

  /**
   * Get metric value from metrics snapshot
   */
  private getMetricValue(metrics: any, metric: string): number | null {
    const parts = metric.split('_');
    let value = metrics;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return null;
      }
    }

    return typeof value === 'number' ? value : null;
  }

  /**
   * Generate human-readable alert message
   */
  private generateAlertMessage(rule: AlertRule, value: number): string {
    const operator = rule.condition === 'above' ? '>' : '<';
    return `${rule.name}: ${value} ${operator} ${rule.threshold} (${rule.metric})`;
  }

  /**
   * Get current resource metrics (CPU, Memory)
   */
  public getResourceMetrics() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercent = (usedMemory / totalMemory) * 100;

    // Get CPU metrics (simplified)
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / (uptime * 1000000) * 100;

    return {
      memory: {
        total_mb: Math.round(totalMemory / 1024 / 1024),
        used_mb: Math.round(usedMemory / 1024 / 1024),
        free_mb: Math.round(freeMemory / 1024 / 1024),
        percent: Math.round(memoryPercent * 100) / 100,
      },
      cpu: {
        percent: Math.round(cpuPercent * 100) / 100,
        user_ms: Math.round(cpuUsage.user / 1000),
        system_ms: Math.round(cpuUsage.system / 1000),
      },
      uptime_seconds: Math.round(uptime),
    };
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).map((active) => ({
      id: `${active.rule.name}-active`,
      name: active.rule.name,
      severity: active.rule.severity,
      metric: active.rule.metric,
      value: active.lastValue,
      threshold: active.rule.threshold,
      message: this.generateAlertMessage(active.rule, active.lastValue),
      timestamp: active.startTime,
      duration_seconds: Math.round((Date.now() - active.startTime) / 1000),
    }));
  }

  /**
   * Get alert history (e.g., for dashboards)
   */
  public getAlertHistory(limit = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get all alert rules
   */
  public getAlertRules(): AlertRule[] {
    return this.alertRules;
  }

  /**
   * Update alert rule
   */
  public updateAlertRule(name: string, updates: Partial<AlertRule>): void {
    const rule = this.alertRules.find((r) => r.name === name);
    if (rule) {
      Object.assign(rule, updates);
      logger.info(`Alert rule updated: ${name}`, updates);
    }
  }

  /**
   * Enable/disable alert rule
   */
  public setAlertRuleEnabled(name: string, enabled: boolean): void {
    const rule = this.alertRules.find((r) => r.name === name);
    if (rule) {
      rule.enabled = enabled;
      logger.info(`Alert rule ${enabled ? 'enabled' : 'disabled'}: ${name}`);
    }
  }

  /**
   * Clear alert history
   */
  public clearAlertHistory(): void {
    this.alertHistory = [];
  }
}

// Singleton instance
export const monitoring = new AdvancedMonitoring();

/**
 * Setup alert handlers (integrations with external systems)
 * This is called from the main app initialization
 */
export function setupAlertHandlers() {
  monitoring.on('alert', (alert: Alert) => {
    // Example integrations (would be configured via env vars)

    if (alert.severity === AlertSeverity.CRITICAL) {
      // Could integrate with PagerDuty, Slack, etc.
      logger.error(`Alert would trigger PagerDuty escalation: ${alert.name}`, {
        alert,
      });

      // Example: Send to external monitoring system
      // sendToPagerDuty(alert);
      // sendToSlack(alert);
    }

    // Could also send metrics to time-series database
    // sendToTimescaleDB(alert);
    // sendToPrometheus(alert);
  });
}
