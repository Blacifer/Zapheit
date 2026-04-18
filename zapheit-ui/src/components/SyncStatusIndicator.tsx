import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { CacheMetadata, getAllMetadata } from '../lib/cache';
import { useEffect, useState } from 'react';

/**
 * Sync Status Indicator
 * Shows cache sync status for backend-first architecture
 */
export function SyncStatusIndicator() {
  const [metadata, setMetadata] = useState<CacheMetadata[]>([]);
  const [staleCount, setStaleCount] = useState(0);
  const [syncingCount, setSyncingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    const updateMetadata = () => {
      const allMetadata = getAllMetadata();
      setMetadata(allMetadata);
      setStaleCount(allMetadata.filter((m) => m.isStale).length);
      setSyncingCount(allMetadata.filter((m) => m.isSyncing).length);
      setConflictCount(allMetadata.filter((m) => m.hasConflict).length);
    };

    updateMetadata();
    const interval = setInterval(updateMetadata, 2000); // Check every 2s

    return () => clearInterval(interval);
  }, []);

  if (!metadata.length) return null;

  const hasIssues = staleCount > 0 || conflictCount > 0;
  const isLoading = syncingCount > 0;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${
          hasIssues
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            : isLoading
            ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
            : 'bg-green-500/10 border-green-500/20 text-green-400'
        } backdrop-blur-sm shadow-lg transition-all`}
      >
        {hasIssues ? (
          <AlertCircle className="w-4 h-4" />
        ) : isLoading ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle className="w-4 h-4" />
        )}
        
        <div className="text-xs">
          {hasIssues ? (
            <div>
              <span className="font-medium">Sync Issues</span>
              {staleCount > 0 && <span className="ml-2">• {staleCount} stale</span>}
              {conflictCount > 0 && <span className="ml-2">• {conflictCount} conflicts</span>}
            </div>
          ) : isLoading ? (
            <span className="font-medium">Syncing with server...</span>
          ) : (
            <span className="font-medium">All data synced</span>
          )}
        </div>
        
        {metadata.some((m) => m.lastSync) && (
          <Clock className="w-3 h-3 ml-2 opacity-60" />
        )}
      </div>

      {/* Detailed status on hover (optional) */}
      {process.env.NODE_ENV === 'development' && metadata.length > 0 && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
          <p className="text-xs text-slate-400 font-medium mb-2">Cache Status (Dev)</p>
          {metadata.slice(0, 5).map((m) => (
            <div key={m.key} className="text-xs text-slate-300 mb-1 flex items-center justify-between">
              <span className="truncate flex-1">{m.key.replace('synthetic_hr_', '')}</span>
              <span className="ml-2">
                {m.isSyncing && '⟳'}
                {m.isStale && '⚠'}
                {m.hasConflict && '⚡'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
