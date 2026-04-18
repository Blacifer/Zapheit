import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';

export interface DataTableColumn<T = any> {
  key: string;
  header: string;
  render?: (value: any, row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

export interface DataTableProps<T = any> {
  columns: DataTableColumn<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyMessage?: string;
  keyField?: string;
  compact?: boolean;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  loading,
  emptyMessage = 'No data',
  keyField = 'id',
  compact = false,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(null);

  const sorted = useMemo(() => {
    if (!sort) return data;
    return [...data].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [data, sort]);

  const toggleSort = (key: string) => {
    setSort((prev) =>
      prev?.key === key
        ? prev.direction === 'asc'
          ? { key, direction: 'desc' }
          : null
        : { key, direction: 'asc' },
    );
  };

  const py = compact ? 'py-2' : 'py-3';

  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-zinc-800/50 rounded" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-12 text-sm">{emptyMessage}</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`text-left font-medium text-zinc-400 px-4 ${py} ${col.sortable ? 'cursor-pointer select-none hover:text-zinc-200' : ''}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    sort?.key === col.key ? (
                      sort.direction === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ArrowUpDown className="w-3.5 h-3.5 opacity-30" />
                    )
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row[keyField] ?? i}
              className={`border-b border-zinc-800/50 last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-zinc-800/40' : ''
              } transition-colors`}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-4 ${py} text-zinc-300`}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
