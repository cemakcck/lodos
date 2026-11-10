import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { useFormat } from "../lib/format";

/** "Reconnecting…" once disconnected for more than 1 s, plus "Last updated HH:MM:SS". */
export function ConnectionBanner({ connected, lastSyncAt }: { connected: boolean; lastSyncAt: Date | null }) {
  const { t } = useTranslation();
  const { clockSeconds } = useFormat();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (connected) {
      const id = setTimeout(() => setOffline(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setOffline(true), 1000);
    return () => clearTimeout(id);
  }, [connected]);

  return (
    <div className="flex items-center gap-3 font-mono text-xs" role="status" aria-live="polite">
      {offline && !connected && (
        <span className="inline-flex items-center gap-1 text-staff-amber">
          <WifiOff size={14} aria-hidden="true" />
          {t("conn.reconnecting")}
        </span>
      )}
      {lastSyncAt && <span>{t("conn.lastUpdated", { time: clockSeconds(lastSyncAt) })}</span>}
    </div>
  );
}
