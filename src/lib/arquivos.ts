/**
 * Arquivos: entregar um arquivo gerado pelo app (backup, planilha) e ler um que
 * a pessoa escolheu. Camada fina sobre o que cada plataforma oferece:
 *
 *  - Celular: grava em cache e abre a folha de compartilhar do Android (Drive,
 *    e-mail, WhatsApp, "salvar em..."); para ler, o seletor de documentos.
 *  - Web (desenvolvimento e testes): baixa pelo navegador e le por <input type=file>.
 *
 * Os modulos nativos so sao carregados no celular: na web eles nao existem.
 */
import { Platform } from "react-native";

export interface ArquivoLido {
  nome: string;
  texto: string;
}

const NOME_COPIA_INTERNA = "copia-antes-da-restauracao.json";
const CHAVE_WEB_COPIA = "meu-plantao:copia-antes-da-restauracao";

const naWeb = Platform.OS === "web";

/** Entrega o arquivo: celular abre "compartilhar", web faz o download. */
export async function entregaArquivo(nome: string, texto: string, mime: string): Promise<void> {
  if (naWeb) {
    const url = URL.createObjectURL(new Blob([texto], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([import("expo-file-system"), import("expo-sharing")]);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Este aparelho não tem como compartilhar arquivos.");

  const arquivo = new File(Paths.cache, nome);
  if (arquivo.exists) arquivo.delete();
  arquivo.create();
  arquivo.write(texto);
  await Sharing.shareAsync(arquivo.uri, { mimeType: mime, dialogTitle: nome });
}

/** Abre o seletor de arquivos e devolve o texto do escolhido, ou `null` se a pessoa desistiu. */
export async function escolheArquivoDeTexto(): Promise<ArquivoLido | null> {
  if (naWeb) {
    return new Promise((resolve, reject) => {
      const campo = document.createElement("input");
      campo.type = "file";
      campo.accept = ".json,.txt,application/json,text/plain";
      campo.onchange = async () => {
        const f = campo.files?.[0];
        if (!f) return resolve(null);
        try {
          resolve({ nome: f.name, texto: await f.text() });
        } catch (e) {
          reject(e);
        }
      };
      campo.oncancel = () => resolve(null);
      campo.click();
    });
  }

  const { File } = await import("expo-file-system");
  // "*/*" porque nem todo aplicativo de arquivos marca o .json com o tipo certo.
  const r = await File.pickFileAsync({ mimeTypes: ["application/json", "text/plain", "*/*"] });
  if (r.canceled) return null;
  return { nome: r.result.name, texto: await r.result.text() };
}

/* ---------------------- a copia de seguranca de antes de restaurar ---------------------- */

export async function guardaCopiaInterna(texto: string): Promise<void> {
  if (naWeb) {
    localStorage.setItem(CHAVE_WEB_COPIA, texto);
    return;
  }
  const { File, Paths } = await import("expo-file-system");
  const arquivo = new File(Paths.document, NOME_COPIA_INTERNA);
  if (arquivo.exists) arquivo.delete();
  arquivo.create();
  arquivo.write(texto);
}

export async function leCopiaInterna(): Promise<string | null> {
  if (naWeb) return localStorage.getItem(CHAVE_WEB_COPIA);
  const { File, Paths } = await import("expo-file-system");
  const arquivo = new File(Paths.document, NOME_COPIA_INTERNA);
  return arquivo.exists ? arquivo.text() : null;
}

export async function apagaCopiaInterna(): Promise<void> {
  if (naWeb) {
    localStorage.removeItem(CHAVE_WEB_COPIA);
    return;
  }
  const { File, Paths } = await import("expo-file-system");
  const arquivo = new File(Paths.document, NOME_COPIA_INTERNA);
  if (arquivo.exists) arquivo.delete();
}
