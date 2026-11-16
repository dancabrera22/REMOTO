#!/usr/bin/env bash
#
# Gera o APK do Meu Plantao (release, arm64, assinado com a chave de debug).
#
#   scripts/build-apk.sh
#
# O resultado fica em dist/meu-plantao-<versao>.apk, com o SHA-256 ao lado.
#
# Requisitos: Node 20+, JDK 17 ou 21 e uns 6 GB livres. O Android SDK (e o NDK)
# sao baixados sozinhos para ~/.cache/meu-plantao/android-sdk na primeira vez —
# isso leva alguns minutos. Nada e instalado fora dessa pasta.
#
# Por que assim e nao `npx expo run:android`:
#  * compila a partir do ULTIMO COMMIT (git archive), numa pasta temporaria: o
#    que voce esta editando agora nao entra no APK por acidente, e a pasta
#    android/ gerada nao suja o repositorio;
#  * so a arquitetura arm64: e a de praticamente todo celular atual, e corta o
#    tempo e o tamanho do arquivo pela metade. Para x86 (emulador), use
#    ARQS=arm64-v8a,x86_64.
#
# Assinatura:
#  * sem nada configurado, o APK sai assinado com a chave de DEBUG do modelo do
#    Expo. Serve para instalar e testar, e as versoes seguintes, assinadas com a
#    mesma chave, atualizam por cima mantendo seus dados;
#  * para publicar, use a SUA chave (crie uma com scripts/cria-chave.sh) e aponte
#    para ela por variaveis de ambiente — nada de senha em arquivo do projeto:
#
#      MEU_PLANTAO_KEYSTORE=~/meu-plantao-chave/meu-plantao.jks \
#      MEU_PLANTAO_KEY_ALIAS=meu-plantao \
#      MEU_PLANTAO_KEYSTORE_PASSWORD='...' \
#      FORMATO=aab scripts/build-apk.sh
#
#    (MEU_PLANTAO_KEY_PASSWORD so precisa existir se a senha da chave for
#    diferente da senha do arquivo.) Leia o PUBLICAR.md antes: trocar a chave de
#    teste pela sua exige desinstalar o app, entao faca um backup antes.
#
# FORMATO: apk (padrao), aab (pacote para a Play Store) ou ambos. O aab exige a
# sua chave: a Play Store recusa pacote assinado com a chave de debug.
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${MEU_PLANTAO_CACHE:-$HOME/.cache/meu-plantao}"
export ANDROID_HOME="${ANDROID_HOME:-$CACHE/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ARQS="${ARQS:-arm64-v8a}"
TENTATIVAS="${TENTATIVAS:-8}"
FORMATO="${FORMATO:-apk}"

log() { printf '\n\033[1m[apk]\033[0m %s\n' "$*"; }
falha() { printf '\n\033[31m[apk] %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || falha "Node nao encontrado."
command -v java >/dev/null || falha "JDK nao encontrado (instale o 17 ou o 21)."
command -v git  >/dev/null || falha "git nao encontrado."

case "$FORMATO" in apk|aab|ambos) ;; *) falha "FORMATO deve ser apk, aab ou ambos (recebi: $FORMATO).";; esac

# Chave propria (opcional). Tudo e conferido ANTES da compilacao longa: errar uma
# senha so depois de 15 minutos de build e o tipo de coisa que da raiva.
ASSINA_COM_CHAVE_PROPRIA=0
if [ -n "${MEU_PLANTAO_KEYSTORE:-}" ]; then
  ASSINA_COM_CHAVE_PROPRIA=1
  [ -f "$MEU_PLANTAO_KEYSTORE" ] || falha "Nao achei o arquivo de chave: $MEU_PLANTAO_KEYSTORE"
  MEU_PLANTAO_KEYSTORE="$(cd "$(dirname "$MEU_PLANTAO_KEYSTORE")" && pwd)/$(basename "$MEU_PLANTAO_KEYSTORE")"
  [ -n "${MEU_PLANTAO_KEY_ALIAS:-}" ] || falha "Falta MEU_PLANTAO_KEY_ALIAS (o apelido da chave dentro do arquivo)."
  [ -n "${MEU_PLANTAO_KEYSTORE_PASSWORD:-}" ] || falha "Falta MEU_PLANTAO_KEYSTORE_PASSWORD (a senha do arquivo de chave)."
  export MEU_PLANTAO_KEYSTORE MEU_PLANTAO_KEY_ALIAS MEU_PLANTAO_KEYSTORE_PASSWORD
  export MEU_PLANTAO_KEY_PASSWORD="${MEU_PLANTAO_KEY_PASSWORD:-$MEU_PLANTAO_KEYSTORE_PASSWORD}"
  if command -v keytool >/dev/null; then
    MEU_PLANTAO_SENHA="$MEU_PLANTAO_KEYSTORE_PASSWORD" keytool -list -keystore "$MEU_PLANTAO_KEYSTORE" \
      -storepass:env MEU_PLANTAO_SENHA -alias "$MEU_PLANTAO_KEY_ALIAS" >/dev/null 2>&1 \
      || falha "Nao consegui abrir a chave (arquivo, senha ou apelido incorretos): $MEU_PLANTAO_KEYSTORE"
  fi
elif [ "$FORMATO" != "apk" ]; then
  falha "FORMATO=$FORMATO exige a sua chave (MEU_PLANTAO_KEYSTORE...): a Play Store recusa pacote assinado com a chave de debug. Veja o PUBLICAR.md."
fi

if [ -n "$(git -C "$RAIZ" status --porcelain -- src app.json package.json 2>/dev/null)" ]; then
  echo "Aviso: ha alteracoes nao commitadas. O APK sai do ULTIMO COMMIT, sem elas." >&2
fi

COMMIT="$(git -C "$RAIZ" rev-parse --short HEAD)"
TRAB="$(mktemp -d "${TMPDIR:-/tmp}/meu-plantao-apk.XXXXXX")"
trap 'rm -rf "$TRAB"' EXIT

log "Exportando o commit $COMMIT"
git -C "$RAIZ" archive HEAD | tar -x -C "$TRAB"
cd "$TRAB"

log "Instalando dependencias (exatamente as do package-lock)"
npm ci --no-audit --no-fund

# O Android so aceita atualizar por cima uma versao MAIS NOVA, e compara o
# versionCode. O numero de commits so cresce, entao cada APK novo sempre vence o
# anterior — sem ninguem lembrar de incrementar na mao.
CODIGO="$(git -C "$RAIZ" rev-list --count HEAD)"
node -e 'const fs=require("fs"),j=JSON.parse(fs.readFileSync("app.json","utf8"));
j.expo.android.versionCode=Number(process.argv[1]);fs.writeFileSync("app.json",JSON.stringify(j,null,2))' "$CODIGO"

log "Gerando o projeto Android nativo (versionCode $CODIGO)"
npx expo prebuild --platform android --no-install >/dev/null

# Assinatura com a chave propria: o modelo do Expo assina o release com a chave de
# debug ("Caution! In production, you need to generate your own keystore").
# Troca isso por uma configuracao que le o arquivo e as senhas do AMBIENTE (nada
# fica gravado em disco) e confere que a troca de fato aconteceu.
if [ "$ASSINA_COM_CHAVE_PROPRIA" = 1 ]; then
  node -e '
    const fs = require("fs");
    const f = "android/app/build.gradle";
    let g = fs.readFileSync(f, "utf8");
    const config = `signingConfigs {
        release {
            storeFile file(System.getenv("MEU_PLANTAO_KEYSTORE"))
            storePassword System.getenv("MEU_PLANTAO_KEYSTORE_PASSWORD")
            keyAlias System.getenv("MEU_PLANTAO_KEY_ALIAS")
            keyPassword System.getenv("MEU_PLANTAO_KEY_PASSWORD")
        }`;
    if (!g.includes("signingConfigs {")) throw new Error("bloco signingConfigs nao encontrado");
    g = g.replace("signingConfigs {", config);
    const i = g.indexOf("buildTypes {");
    const j = g.indexOf("release {", i);
    const k = g.indexOf("signingConfig signingConfigs.debug", j);
    if (i < 0 || j < 0 || k < 0) throw new Error("buildTypes.release nao encontrado");
    g = g.slice(0, k) + "signingConfig signingConfigs.release" + g.slice(k + "signingConfig signingConfigs.debug".length);
    fs.writeFileSync(f, g);
  ' || falha "Nao consegui configurar a assinatura no projeto Android (o modelo do Expo mudou?)."
  grep -q "signingConfig signingConfigs.release" android/app/build.gradle || falha "A troca da assinatura nao pegou."
  log "Assinatura: chave propria ($(basename "$MEU_PLANTAO_KEYSTORE"), apelido $MEU_PLANTAO_KEY_ALIAS)"
else
  log "Assinatura: chave de teste (debug) — serve para instalar, nao para publicar"
fi

# ---------------------------------------------------------------------------
# Android SDK: as versoes exigidas vem do proprio React Native instalado, entao
# o script acompanha as trocas de SDK do Expo sem precisar de manutencao.
# ---------------------------------------------------------------------------
TOML="node_modules/react-native/gradle/libs.versions.toml"
le() { sed -n "s/^$1 *= *\"\(.*\)\"/\1/p" "$TOML" | head -1; }
COMPILE="$(le compileSdk)"; BUILDTOOLS="$(le buildTools)"; NDK="$(le ndkVersion)"
[ -n "$COMPILE" ] && [ -n "$BUILDTOOLS" ] && [ -n "$NDK" ] || falha "Nao consegui ler as versoes do SDK em $TOML."
log "SDK exigido: plataforma $COMPILE, build-tools $BUILDTOOLS, NDK $NDK"

SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKM" ]; then
  log "Baixando as ferramentas de linha de comando do Android"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  NUM="$(curl -fsS https://dl.google.com/android/repository/repository2-3.xml \
        | grep -o 'commandlinetools-linux-[0-9]*_latest.zip' | sed 's/[^0-9]//g' | sort -n | tail -1)"
  [ -n "$NUM" ] || falha "Nao consegui descobrir a versao das ferramentas do Android."
  curl -fSL -o "$TRAB/cmdtools.zip" "https://dl.google.com/android/repository/commandlinetools-linux-${NUM}_latest.zip"
  unzip -q "$TRAB/cmdtools.zip" -d "$TRAB/cmd"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$TRAB/cmd/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

log "Aceitando licencas e instalando o SDK (so baixa o que falta)"
yes | "$SDKM" --licenses >/dev/null 2>&1 || true
# Desde a API 36 o pacote da plataforma ganhou sufixo (android-37.0).
"$SDKM" "platform-tools" "build-tools;$BUILDTOOLS" "ndk;$NDK" "cmake;3.22.1" >/dev/null
"$SDKM" "platforms;android-$COMPILE.0" >/dev/null 2>&1 || "$SDKM" "platforms;android-$COMPILE" >/dev/null

echo "sdk.dir=$ANDROID_HOME" > android/local.properties
# O padrao do modelo (2 GB) estoura a memoria do R8 na etapa de minificacao.
sed -i 's/^org.gradle.jvmargs=.*/org.gradle.jvmargs=-Xmx5g -XX:MaxMetaspaceSize=1g/' android/gradle.properties
sed -i 's/^org.gradle.parallel=.*/org.gradle.parallel=false/' android/gradle.properties

# ---------------------------------------------------------------------------
# Gradle, com repeticao. O Maven Central devolve 429 (muitos pedidos) a quem
# baixa dependencias em rajada, sobretudo atras de proxy compartilhado. O cache
# do Gradle guarda o que ja veio, entao cada tentativa avanca de onde parou.
# Erro de compilacao nao melhora com repeticao: esse para na hora.
# ---------------------------------------------------------------------------
cd android
LOG="$TRAB/gradle.log"
case "$FORMATO" in
  apk) TAREFAS="assembleRelease" ;;
  aab) TAREFAS="bundleRelease" ;;
  ambos) TAREFAS="assembleRelease bundleRelease" ;;
esac
for i in $(seq 1 "$TENTATIVAS"); do
  log "Compilando (tentativa $i de $TENTATIVAS, arquiteturas: $ARQS)"
  if ./gradlew $TAREFAS -PreactNativeArchitectures="$ARQS" --no-daemon --console=plain >"$LOG" 2>&1; then
    break
  fi
  if grep -qE "status code 429|Too Many Requests|Could not GET|Read timed out|Connection reset|Premature end" "$LOG"; then
    echo "Falha de rede ou limite de pedidos; tentando de novo em 25 s."
    sleep 25
  else
    tail -40 "$LOG" >&2
    falha "A compilacao falhou (nao e problema de rede). Log completo: $LOG"
  fi
  [ "$i" -eq "$TENTATIVAS" ] && { tail -40 "$LOG" >&2; falha "Esgotei as $TENTATIVAS tentativas."; }
done

cd "$RAIZ"
VERSAO="$(node -p "require('./package.json').version")"
mkdir -p dist

# Mostra com que chave o resultado foi assinado — confira se e a que voce espera.
mostra_assinatura() {
  local arq="$1" apksigner="$ANDROID_HOME/build-tools/$BUILDTOOLS/apksigner"
  if [[ "$arq" == *.apk ]] && [ -x "$apksigner" ]; then
    # O apksigner imprime o resumo em minusculas e sem ":"; reformata como o keytool (AA:BB:...), para comparar a olho.
    local resumo
    resumo="$("$apksigner" verify --print-certs "$arq" 2>&1 | sed -n 's/^.*certificate SHA-256 digest: //p' | head -1 | tr 'a-f' 'A-F' | sed 's/../&:/g; s/:$//')"
    if [ -n "$resumo" ]; then echo "  assinatura (SHA-256 da chave): $resumo"; fi
  elif command -v keytool >/dev/null; then
    keytool -printcert -jarfile "$arq" 2>/dev/null | sed -n 's/^[[:space:]]*SHA256: /  assinatura (SHA-256 da chave): /p' | head -1
  fi
}

entrega() {
  local origem="$1" ext="$2" destino="dist/meu-plantao-$VERSAO.$2"
  [ -f "$origem" ] || falha "A compilacao terminou, mas nao achei o arquivo .$ext."
  cp "$origem" "$destino"
  ( cd dist && sha256sum "meu-plantao-$VERSAO.$ext" > "meu-plantao-$VERSAO.$ext.sha256" )
  log "Pronto: $destino ($(du -h "$destino" | cut -f1)) — commit $COMMIT"
  cat "$destino.sha256"
  mostra_assinatura "$destino"
}

if [ "$FORMATO" != "aab" ]; then
  APK="$(find "$TRAB/android/app/build/outputs/apk/release" -name '*.apk' | head -1)"
  entrega "$APK" apk
fi
if [ "$FORMATO" != "apk" ]; then
  AAB="$(find "$TRAB/android/app/build/outputs/bundle/release" -name '*.aab' | head -1)"
  entrega "$AAB" aab
fi
