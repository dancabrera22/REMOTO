"use client";

import type { LinkStats } from "@/lib/rtc/stats";
import { Badge } from "./ui";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink-200";
  return (
    <div className="min-w-16">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`font-mono text-sm ${color}`}>{value}</div>
    </div>
  );
}

/**
 * Painel de diagnostico. Num acesso remoto o usuario sempre quer saber "por
 * que esta lento" — e a resposta quase sempre esta em uma destas cinco
 * medidas: latencia, perda de pacotes, taxa de bits, quadros e caminho.
 */
export function StatsBar({ stats, rttMs }: { stats: LinkStats; rttMs: number }) {
  const latency = rttMs || stats.rttMs;
  const latencyTone = latency > 150 ? "bad" : latency > 80 ? "warn" : undefined;
  const lossTone = stats.lossPercent > 3 ? "bad" : stats.lossPercent > 0.5 ? "warn" : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Metric label="Latencia" value={latency ? `${latency} ms` : "—"} tone={latencyTone} />
      <Metric label="Perda" value={`${stats.lossPercent}%`} tone={lossTone} />
      <Metric label="Taxa" value={stats.kbps ? `${(stats.kbps / 1000).toFixed(1)} Mb/s` : "—"} />
      <Metric label="Quadros" value={stats.fps ? `${stats.fps} fps` : "—"} />
      <Metric
        label="Resolucao"
        value={stats.width ? `${stats.width}×${stats.height}` : "—"}
      />
      <Metric label="Codec" value={stats.codec} />
      <div className="flex items-center gap-2">
        <Badge tone={stats.path === "relay" ? "warn" : stats.path === "?" ? "neutral" : "good"}>
          {stats.path === "relay" ? "via TURN" : stats.path === "?" ? "sem dados" : "ponto-a-ponto"}
        </Badge>
        {stats.limitedBy !== "none" && <Badge tone="warn">limitado por {stats.limitedBy}</Badge>}
      </div>
    </div>
  );
}
