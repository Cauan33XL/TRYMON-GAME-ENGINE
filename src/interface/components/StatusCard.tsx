/**
 * Status Card Component
 * Reusable card for displaying metrics
 */

import { LucideIcon } from 'lucide-react';

interface StatusCardProps {
  icon: LucideIcon;
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  color?: string;
  className?: string;
}

export function StatusCard({
  icon: Icon,
  title,
  value,
  subtitle,
  trend,
  color = '#00f2ff',
  className
}: StatusCardProps) {
  return (
    <div className={`status-card ${className || ''}`}>
      <div className="card-header">
        <div className="icon-wrapper" style={{ backgroundColor: `${color}20` }}>
          <Icon size={20} style={{ color }} />
        </div>
        <span className="card-title">{title}</span>
      </div>

      <div className="card-value" style={{ color }}>
        {value}
      </div>

      {subtitle && (
        <div className="card-subtitle">
          {subtitle}
          {trend && (
            <span className={`trend ${trend}`}>
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
