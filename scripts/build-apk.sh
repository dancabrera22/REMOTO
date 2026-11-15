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
# Assinatura: o APK sai assinado com a chave de DEBUG do modelo do Expo. Serve
# para instalar e testar — e as versoes seguintes, assinadas com a mesma chave,
# atualizam por cima mantendo seus dados. Para publicar na Play Store e preciso
# uma chave de upload propria (Etapa 7).
#
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CACHE="${MEU_PLANTAO_CACHE:-$HOME/.cache/meu-plantao}"
export ANDROID_HOME="${ANDROID_HOME:-$CACHE/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
ARQS="${ARQS:-arm64-v8a}"
TENTATIVAS="${TENTATIVAS:-8}"

log() { printf '\n\033[1m[apk]\033[0m %s\n' "$*"; }
falha() { printf '\n\033[31m[apk] %s\033[0m\n' "$*" >&2; exit 1; }

command -v node >/dev/null || falha "Node nao encontrado."
command -v java >/dev/null || falha "JDK nao encontrado (instale o 17 ou o 21)."
command -v git  >/dev/null || falha "git nao encontrado."

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

log "Gerando o projeto Android nativo"
npx expo prebuild --platform android --no-install >/dev/null

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
for i in $(seq 1 "$TENTATIVAS"); do
  log "Compilando (tentativa $i de $TENTATIVAS, arquiteturas: $ARQS)"
  if ./gradlew assembleRelease -PreactNativeArchitectures="$ARQS" --no-daemon --console=plain >"$LOG" 2>&1; then
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

APK="$(find app/build/outputs/apk/release -name '*.apk' | head -1)"
[ -f "$APK" ] || falha "A compilacao terminou, mas nao achei o APK."

cd "$RAIZ"
VERSAO="$(node -p "require('./package.json').version")"
mkdir -p dist
DESTINO="dist/meu-plantao-$VERSAO.apk"
cp "$TRAB/android/$APK" "$DESTINO"
( cd dist && sha256sum "meu-plantao-$VERSAO.apk" > "meu-plantao-$VERSAO.apk.sha256" )

log "Pronto: $DESTINO ($(du -h "$DESTINO" | cut -f1)) — commit $COMMIT"
cat "dist/meu-plantao-$VERSAO.apk.sha256"
