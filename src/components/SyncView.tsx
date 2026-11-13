import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Laptop,
  RefreshCw,
  Save,
  Upload,
} from 'lucide-react';
import {
  getLastSyncTimes,
  getSyncConfig,
  pullNow,
  pushNow,
  setSyncFolder,
  type SyncConfig,
} from '../utils/syncStore.ts';

type NoticeKind = 'success' | 'error' | 'info';

interface Notice {
  kind: NoticeKind;
  text: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return 'Never';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export const SyncView: React.FC = () => {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [lastTimes, setLastTimes] = useState(() => getLastSyncTimes());
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingFolder, setSavingFolder] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const next = await getSyncConfig();
      setConfig(next);
      setFolderInput((prev) => (prev.trim().length > 0 ? prev : (next.folder ?? '')));
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setLoadingConfig(false);
      setLastTimes(getLastSyncTimes());
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const isBusy = savingFolder || pushing || pulling;
  const hasFolder = Boolean(config?.folder);

  const statusRows = useMemo(
    () => [
      {
        label: 'Configured folder',
        value: config?.folder ?? 'Not configured',
        icon: FolderOpen,
      },
      {
        label: 'Sync file path',
        value: config?.file ?? 'No file path yet',
        icon: HardDrive,
      },
      {
        label: 'Sync file exists',
        value: config ? (config.exists ? 'Yes' : 'No') : 'Loading...',
        icon: CheckCircle2,
      },
      {
        label: 'File last modified',
        value: formatTimestamp(config?.modifiedAt ?? null),
        icon: Clock,
      },
      {
        label: 'Last push from this device',
        value: formatTimestamp(lastTimes.lastPushAt),
        icon: Upload,
      },
      {
        label: 'Last pull to this device',
        value: formatTimestamp(lastTimes.lastPullAt),
        icon: Download,
      },
    ],
    [config, lastTimes],
  );

  const handleSaveFolder = async (): Promise<void> => {
    const folder = folderInput.trim();
    if (folder.length === 0) {
      setNotice({ kind: 'error', text: 'Enter the absolute path to a shared folder.' });
      return;
    }

    setSavingFolder(true);
    setNotice(null);
    try {
      const next = await setSyncFolder(folder);
      setConfig(next);
      setFolderInput(next.folder ?? folder);
      setLastTimes(getLastSyncTimes());
      setNotice({ kind: 'success', text: 'Sync folder saved on this computer.' });
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSavingFolder(false);
    }
  };

  const handlePush = async (): Promise<void> => {
    setPushing(true);
    setNotice(null);
    try {
      const result = await pushNow();
      setLastTimes(getLastSyncTimes());
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message });

      if (result.ok) {
        try {
          const next = await getSyncConfig();
          setConfig(next);
        } catch {
          // The push already succeeded; refreshing the status card is best effort.
        }
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async (): Promise<void> => {
    setPulling(true);
    setNotice(null);
    try {
      const result = await pullNow();
      setLastTimes(getLastSyncTimes());
      setNotice({ kind: result.ok ? 'success' : 'error', text: result.message });

      if (result.ok) {
        try {
          const next = await getSyncConfig();
          setConfig(next);
        } catch {
          // The pull already succeeded; refreshing the status card is best effort.
        }
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setPulling(false);
    }
  };

  const noticeClass =
    notice?.kind === 'error'
      ? 'border-red-700 bg-red-50 text-red-950 dark:border-red-400 dark:bg-red-950/40 dark:text-red-100'
      : notice?.kind === 'success'
        ? 'border-emerald-700 bg-emerald-50 text-emerald-950 dark:border-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-100'
        : 'border-sky-700 bg-sky-50 text-sky-950 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-100';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 text-slate-950 sm:p-6 dark:text-slate-100">
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-[#0f8b8d] bg-[#0f8b8d] p-2 text-white shadow-sm">
            <Laptop className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-medium tracking-tight text-2xl sm:text-3xl">Sync across devices</h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Move your Pulse Med data through a shared folder you already control.
            </p>
          </div>
        </div>
        <span className="w-fit rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-[#0f8b8d] dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
          Manual + merge-only
        </span>
      </header>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 font-medium text-lg text-slate-950 dark:text-slate-100">
          <Info className="h-5 w-5" aria-hidden="true" />
          Use it on two computers
        </h2>
        <ol className="grid gap-3 md:grid-cols-3">
          <li className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            <span className="mb-1 block font-medium text-[#0f8b8d] dark:text-teal-300">1. Pick a shared folder</span>
            Put a folder inside OneDrive, Dropbox, Google Drive, or on a network drive. Save its
            absolute path on this computer.
          </li>
          <li className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            <span className="mb-1 block font-medium text-[#0f8b8d] dark:text-teal-300">2. Push here</span>
            Click Push to folder on the computer where you made changes. This writes{' '}
            <span className="rounded bg-slate-100 px-1 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">pulse-med-sync.json</span> into that folder.
          </li>
          <li className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm text-slate-700 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
            <span className="mb-1 block font-medium text-[#0f8b8d] dark:text-teal-300">3. Pull there</span>
            On the other computer, save the same shared folder path as it appears on that device,
            then click Pull from folder (merge).
          </li>
        </ol>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="flex items-center gap-2 font-medium text-lg text-slate-950 dark:text-slate-100">
          <FolderOpen className="h-5 w-5" aria-hidden="true" />
          Shared folder on this computer
        </h2>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="sync-folder-path">
          Absolute folder path
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="sync-folder-path"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[#0f8b8d] focus:ring-2 focus:ring-[#0f8b8d]/30 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            value={folderInput}
            onChange={(event) => setFolderInput(event.target.value)}
            placeholder={'C:\\Users\\you\\OneDrive\\PulseMed'}
            spellCheck={false}
            disabled={savingFolder}
          />
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0c7678] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleSaveFolder()}
            disabled={isBusy || folderInput.trim().length === 0}
          >
            {savingFolder ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-4 w-4" aria-hidden="true" />
            )}
            {savingFolder ? 'Saving...' : 'Save folder'}
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Example: <span className="rounded bg-slate-100 px-1 font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">C:\Users\you\OneDrive\PulseMed</span>. Use the same
          shared folder on both computers, even if the absolute path is different on each device.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-medium text-lg text-slate-950 dark:text-slate-100">
            <HardDrive className="h-5 w-5" aria-hidden="true" />
            Sync status
          </h2>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-[#0f8b8d] hover:text-[#0f8b8d] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => void refreshStatus()}
            disabled={loadingConfig || isBusy}
          >
            <RefreshCw
              className={`h-4 w-4 ${loadingConfig ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {statusRows.map((row) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className="rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-600 dark:bg-slate-950/40"
              >
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{row.label}</span>
                </div>
                <p className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">
                  {row.value}
                </p>
              </div>
            );
          })}
        </div>

        {!loadingConfig && !hasFolder ? (
          <p className="rounded-xl border border-amber-700 bg-amber-50 p-3 text-sm font-semibold text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-100">
            Save a shared folder before pushing or pulling.
          </p>
        ) : null}

        <div className="h-px bg-slate-200 dark:bg-slate-700" />

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f8b8d] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#0c7678] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handlePush()}
            disabled={isBusy || !hasFolder}
          >
            {pushing ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {pushing ? 'Pushing...' : 'Push to folder'}
          </button>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#0f8b8d] bg-white px-4 py-2.5 text-sm font-semibold text-[#0f8b8d] shadow-sm transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 dark:hover:bg-teal-950/40 dark:text-teal-300"
            onClick={() => void handlePull()}
            disabled={isBusy || !hasFolder}
          >
            {pulling ? (
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {pulling ? 'Pulling...' : 'Pull from folder (merge)'}
          </button>
        </div>
      </section>

      {notice ? (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`flex items-start gap-3 rounded-xl border p-3 text-sm font-semibold ${noticeClass}`}
        >
          {notice.kind === 'error' ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : notice.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <span className="break-words">{notice.text}</span>
        </div>
      ) : null}

      <section className="rounded-2xl border border-sky-700 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-100">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">Honest sync note</p>
            <p className="mt-1">
              This sync is manual and merge-only. Nothing is uploaded to any account or cloud API
              by Pulse Med. The app server writes the sync file into the folder you choose, and your
              folder service (OneDrive, Dropbox, Google Drive, or a network drive) carries it
              between computers. Pulling merges data and never deletes local data.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
