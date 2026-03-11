// Loading Skeleton Component
// Provides consistent loading states across the application

import React from 'react';

interface SkeletonProps {
  className?: string;
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  width,
  height,
}) => {
  const baseClasses = 'animate-pulse bg-slate-700';

  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={style}
    />
  );
};

// Card Skeleton
export const CardSkeleton: React.FC<{ showHeader?: boolean }> = ({ showHeader = true }) => (
  <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
    {showHeader && (
      <div className="flex items-center justify-between mb-4">
        <Skeleton width={150} height={24} />
        <Skeleton width={80} height={32} variant="circular" />
      </div>
    )}
    <Skeleton width="100%" height={100} />
    <div className="mt-4 space-y-2">
      <Skeleton width="80%" height={16} />
      <Skeleton width="60%" height={16} />
    </div>
  </div>
);

// Table Row Skeleton
export const TableRowSkeleton: React.FC<{ columns?: number }> = ({ columns = 4 }) => (
  <tr className="border-b border-slate-700/50">
    {Array.from({ length: columns }).map((_, i) => (
      <td key={i} className="py-4">
        <Skeleton width="80%" height={16} />
      </td>
    ))}
  </tr>
);

// Stats Card Skeleton
export const StatsCardSkeleton: React.FC = () => (
  <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
    <div className="flex items-center justify-between">
      <div>
        <Skeleton width={80} height={14} className="mb-2" />
        <Skeleton width={60} height={32} />
      </div>
      <Skeleton width={48} height={48} variant="circular" />
    </div>
  </div>
);

// Dashboard Stats Skeleton
export const DashboardStatsSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
    {Array.from({ length: 4 }).map((_, i) => (
      <StatsCardSkeleton key={i} />
    ))}
  </div>
);

// Agent Card Skeleton
export const AgentCardSkeleton: React.FC = () => (
  <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
    <div className="flex items-start justify-between">
      <div className="flex items-center gap-4">
        <Skeleton width={48} height={48} variant="circular" />
        <div>
          <Skeleton width={120} height={20} className="mb-2" />
          <Skeleton width={80} height={14} />
        </div>
      </div>
      <Skeleton width={60} height={24} />
    </div>
    <div className="mt-4 grid grid-cols-3 gap-4">
      <Skeleton width="100%" height={40} />
      <Skeleton width="100%" height={40} />
      <Skeleton width="100%" height={40} />
    </div>
  </div>
);

// Page Loading State
export const PageLoader: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-slate-400">{message}</p>
    </div>
  </div>
);

// Inline Spinner
export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg' }> = ({ size = 'md' }) => {
  const sizes = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className={`${sizes[size]} border-2 border-slate-600 border-t-cyan-500 rounded-full animate-spin`} />
  );
};

// Button Loading State
export const ButtonLoader: React.FC = () => (
  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
);

export default {
  Skeleton,
  CardSkeleton,
  TableRowSkeleton,
  StatsCardSkeleton,
  DashboardStatsSkeleton,
  AgentCardSkeleton,
  PageLoader,
  Spinner,
  ButtonLoader,
};
