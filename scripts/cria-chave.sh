#!/usr/bin/env bash
#
# Cria a SUA chave de assinatura do Meu Plantao (para publicar na Play Store ou
# distribuir o APK por conta propria).
#
#   scripts/cria-chave.sh [caminho-do-arquivo]
#
# Padrao: ~/meu-plantao-chave/meu-plantao.jks — FORA do projeto, de proposito:
# esse arquivo nunca pode ir para o GitHub.
#
# Sem nenhuma variavel, o keytool pergunta as senhas (digitadas sem aparecer).
# Para rodar sem perguntas: MEU_PLANTAO_KEYSTORE_PASSWORD='...' scripts/cria-chave.sh
#
# ATENCAO — leia antes de criar:
#  * Quem tem esse arquivo + a senha consegue publicar atualizacoes do seu app.
#    Quem PERDE o arquivo ou a senha nao consegue mais atualizar o app (so
#    publicando outro, do zero) — a menos que use a assinatura da Play Store, em
#    que a Google guarda a chave definitiva e esta aqui e so a "chave de envio",
#    que da para trocar. Veja o PUBLICAR.md.
#  * Guarde o arquivo e a senha em pelo menos DOIS lugares (por exemplo, um
#    gerenciador de senhas e um pendrive/nuvem privada).
#
set -euo pipefail

falha() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
command -v keytool >/dev/null || falha "keytool nao encontrado: instale o JDK (17 ou 21)."

ARQUIVO="${1:-$HOME/meu-plantao-chave/meu-plantao.jks}"
APELIDO="${MEU_PLANTAO_KEY_ALIAS:-meu-plantao}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ ! -e "$ARQUIVO" ] || falha "Ja existe um arquivo em $ARQUIVO. Nao vou sobrescrever uma chave: se for mesmo para recomecar, apague-o voce mesmo (e saiba que o app publicado com a chave antiga nao podera mais ser atualizado)."
case "$(cd "$(dirname "$ARQUIVO")" 2>/dev/null && pwd || echo)" in
  "$RAIZ"|"$RAIZ"/*) falha "Escolha um lugar FORA do projeto ($RAIZ): a chave nao pode ir para o GitHub." ;;
esac

mkdir -p "$(dirname "$ARQUIVO")"
chmod 700 "$(dirname "$ARQUIVO")" 2>/dev/null || true

ARGS=(-genkeypair -v -keystore "$ARQUIVO" -alias "$APELIDO" -keyalg RSA -keysize 4096 -validity 10950
      -dname "CN=Meu Plantao, O=Meu Plantao, C=BR")
if [ -n "${MEU_PLANTAO_KEYSTORE_PASSWORD:-}" ]; then
  [ "${#MEU_PLANTAO_KEYSTORE_PASSWORD}" -ge 6 ] || falha "A senha precisa ter pelo menos 6 caracteres."
  ARGS+=(-storepass:env MEU_PLANTAO_KEYSTORE_PASSWORD -keypass:env MEU_PLANTAO_KEYSTORE_PASSWORD)
else
  echo "Vou pedir a senha do arquivo de chave (e repetir). Use algo longo e guarde-a bem."
fi

keytool "${ARGS[@]}" >/dev/null
chmod 600 "$ARQUIVO"

echo
echo "Chave criada: $ARQUIVO  (apelido: $APELIDO, validade: 30 anos)"
echo
if [ -n "${MEU_PLANTAO_KEYSTORE_PASSWORD:-}" ]; then
  keytool -list -v -keystore "$ARQUIVO" -storepass:env MEU_PLANTAO_KEYSTORE_PASSWORD -alias "$APELIDO" 2>/dev/null | sed -n 's/^[[:space:]]*SHA256: /Impressao digital (SHA-256): /p'
else
  keytool -list -v -keystore "$ARQUIVO" -alias "$APELIDO" | sed -n 's/^[[:space:]]*SHA256: /Impressao digital (SHA-256): /p'
fi
cat <<MSG

Proximos passos:
  1. Faca DUAS copias do arquivo e guarde a senha junto (gerenciador de senhas).
  2. Gere o app assinado com ela:

       MEU_PLANTAO_KEYSTORE="$ARQUIVO" \\
       MEU_PLANTAO_KEY_ALIAS="$APELIDO" \\
       MEU_PLANTAO_KEYSTORE_PASSWORD='sua-senha' \\
       FORMATO=ambos scripts/build-apk.sh

  3. Antes de instalar por cima do app que voce ja usa, leia o PUBLICAR.md:
     a chave e outra, entao o Android pede para desinstalar (faca um backup antes).
MSG
