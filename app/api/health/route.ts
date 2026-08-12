import { json } from "@/lib/server/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostico de implantacao. O ponto critico e `store`: se vier "memory" em
 * producao, cada invocacao serverless enxerga uma memoria diferente e a
 * sinalizacao vai falhar de forma intermitente e dificil de depurar.
 */
export async function GET() {
  const store = getStore();
  const turn = Boolean(
    process.env.TURN_URLS ||
      process.env.CLOUDFLARE_TURN_KEY_ID ||
      process.env.METERED_API_KEY ||
      process.env.TWILIO_ACCOUNT_SID,
  );

  const warnings: string[] = [];
  if (store.kind === "memory") {
    warnings.push(
      "Sinalizacao em memoria: so funciona em instancia unica. Configure UPSTASH_REDIS_REST_URL/TOKEN antes de usar em producao.",
    );
  }
  if (!turn) {
    warnings.push("Sem TURN configurado: conexoes atras de NAT simetrico ou firewall corporativo vao falhar.");
  }

  return json({
    ok: warnings.length === 0,
    store: store.kind,
    turn,
    region: process.env.VERCEL_REGION ?? "local",
    warnings,
  });
}
