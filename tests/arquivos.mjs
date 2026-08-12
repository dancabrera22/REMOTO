// Transferencia de arquivos pelo DataChannel: 12 MiB para passar do limite de
// 4 MiB de buffer e exercitar o caminho de contrapressao (`bufferedamountlow`),
// com verificacao de integridade byte a byte no destino.
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BASE, check, findChromium, readCredentials, report, until, wait } from "./helpers.mjs";

const TMP = os.tmpdir();


async function main() {
  const payload = crypto.randomBytes(12 * 1024 * 1024);
  const source = path.join(TMP, "carga.bin");
  fs.writeFileSync(source, payload);
  const digest = crypto.createHash("sha256").update(payload).digest("hex");

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const host = await (await browser.newContext()).newPage();
  const viewerCtx = await browser.newContext({ acceptDownloads: true });
  const viewer = await viewerCtx.newPage();

  await host.goto(`${BASE}/compartilhar`, { waitUntil: "networkidle" });
  const { code, pin } = await readCredentials(host);

  await viewer.goto(`${BASE}/conectar?c=${code}#${pin}`, { waitUntil: "networkidle" });
  await viewer.getByLabel("Seu nome").fill("Remetente");
  await viewer.getByRole("button", { name: "Conectar" }).click();
  await host.getByRole("button", { name: "Permitir" }).waitFor({ timeout: 25000 });
  await host.getByRole("button", { name: "Permitir" }).click();
  const connected = await until(async () =>
    (await host.locator("main").innerText()).includes("conectado") ? true : null,
  30000);
  check("sessao estabelecida", Boolean(connected));

  // O anfitriao precisa estar na aba de arquivos para ver a oferta chegar.
  await host.getByRole("button", { name: "arquivos", exact: true }).click();
  await viewer.getByRole("button", { name: "arquivos", exact: true }).click();

  const started = Date.now();
  await viewer.locator('input[type="file"]').setInputFiles(source);

  const offered = await until(async () =>
    (await host.locator("main").innerText()).includes("carga.bin") ? true : null,
  20000);
  check("oferta de arquivo chega ao destino", Boolean(offered));

  const needsConsent = await host.getByRole("button", { name: "aceitar" }).count();
  check("recebimento exige aceite explicito", needsConsent === 1);
  await host.getByRole("button", { name: "aceitar" }).click();

  const done = await until(async () => {
    const text = await host.locator("main").innerText();
    return text.includes("recebendo · concluido") ? true : null;
  }, 120000);
  check("transferencia conclui no destino", Boolean(done), `${((Date.now() - started) / 1000).toFixed(1)} s`);

  const senderDone = await until(async () =>
    (await viewer.evaluate(() => document.body.innerText)).includes("enviando · concluido") ? true : null,
  30000);
  check("remetente marca como concluido", Boolean(senderDone));

  // Baixa no destino e compara o conteudo byte a byte.
  const [download] = await Promise.all([
    host.waitForEvent("download", { timeout: 30000 }),
    host.getByRole("link", { name: "baixar", exact: true }).click(),
  ]);
  const saved = path.join(TMP, "recebido.bin");
  await download.saveAs(saved);
  const received = fs.readFileSync(saved);
  check("tamanho preservado", received.length === payload.length, `${received.length} bytes`);
  check(
    "conteudo identico (sha256)",
    crypto.createHash("sha256").update(received).digest("hex") === digest,
  );

  // Recusa: o remetente precisa saber.
  await viewer.locator('input[type="file"]').setInputFiles(source);
  await until(async () =>
    (await host.getByRole("button", { name: "recusar" }).count()) > 0 ? true : null,
  20000);
  await host.getByRole("button", { name: "recusar" }).click();
  const rejected = await until(async () =>
    (await viewer.evaluate(() => document.body.innerText)).includes("enviando · recusado") ? true : null,
  20000);
  check("recusa e informada ao remetente", Boolean(rejected));

  await browser.close();
  fs.rmSync(source, { force: true });
  fs.rmSync(saved, { force: true });
  process.exit(report() ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
