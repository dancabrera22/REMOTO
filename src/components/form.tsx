import { useState, type ReactNode } from "react";
import { Pressable, TextInput, View, type TextInputProps } from "react-native";
import { centavosDeDigitos, formatValor, type Centavos } from "@/lib/money";
import { coresLocais, nomeDaCor, useTheme } from "@/theme";
import { Icone, Txt } from "./ui";

/* --------------------------------- campo --------------------------------- */

/** Rotulo + controle + mensagem de erro, aviso ou dica. */
export function Campo({
  rotulo,
  opcional,
  erro,
  aviso,
  dica,
  children,
}: {
  rotulo: string;
  opcional?: boolean;
  erro?: string;
  aviso?: string;
  dica?: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: t.spacing.sm }}>
        <Txt variant="label" style={{ fontWeight: "600" }}>
          {rotulo}
        </Txt>
        {opcional && (
          <Txt variant="caption" tom="faint">
            opcional
          </Txt>
        )}
      </View>
      {children}
      {erro ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Icone name="alert-circle" size={14} color={t.colors.danger} />
          <Txt variant="caption" tom="danger" style={{ flex: 1 }}>
            {erro}
          </Txt>
        </View>
      ) : aviso ? (
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Icone name="information-outline" size={14} color={t.colors.warning} />
          <Txt variant="caption" tom="warning" style={{ flex: 1 }}>
            {aviso}
          </Txt>
        </View>
      ) : dica ? (
        <Txt variant="caption" tom="faint">
          {dica}
        </Txt>
      ) : null}
    </View>
  );
}

export function CampoTexto({
  erro,
  style,
  ...props
}: TextInputProps & { erro?: boolean }) {
  const t = useTheme();
  const [foco, setFoco] = useState(false);

  return (
    <TextInput
      placeholderTextColor={t.colors.textFaint}
      {...props}
      onFocus={(e) => {
        setFoco(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFoco(false);
        props.onBlur?.(e);
      }}
      style={[
        {
          backgroundColor: t.colors.surface,
          borderWidth: foco ? 2 : 1,
          borderColor: erro ? t.colors.danger : foco ? t.colors.primary : t.colors.borderStrong,
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing.lg,
          paddingVertical: foco ? 11 : 12,
          color: t.colors.text,
          fontSize: 16,
          // Remove o contorno do navegador na web; a borda de foco acima o substitui.
          outlineStyle: "none",
        } as never,
        props.multiline ? { minHeight: 84, textAlignVertical: "top" } : null,
        style,
      ]}
    />
  );
}

/**
 * Valor em reais, digitado como numa maquininha: os digitos entram pela
 * direita ("1", "12", "123" -> 0,01 / 0,12 / 1,23). Nao ha virgula para digitar
 * nem para errar.
 */
export function CampoDinheiro({
  valor,
  onChange,
  erro,
  sufixo,
}: {
  valor: Centavos;
  onChange: (centavos: Centavos) => void;
  erro?: boolean;
  sufixo?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
      <Txt variant="bodyStrong" tom="muted">
        R$
      </Txt>
      <CampoTexto
        value={valor ? formatValor(valor) : ""}
        placeholder="0,00"
        keyboardType="number-pad"
        inputMode="numeric"
        onChangeText={(texto) => onChange(centavosDeDigitos(texto))}
        erro={erro}
        style={{ flex: 1 }}
        accessibilityLabel="Valor em reais"
      />
      {sufixo && (
        <Txt variant="label" tom="muted">
          {sufixo}
        </Txt>
      )}
    </View>
  );
}

/** Numero curto (dia do mes, quantidade de dias): so aceita digitos. */
export function CampoNumero({
  valor,
  onChange,
  sufixo,
  placeholder,
  erro,
  maxLength = 3,
  largura = 88,
  rotuloAcessivel,
}: {
  valor: string;
  onChange: (texto: string) => void;
  sufixo?: string;
  placeholder?: string;
  erro?: boolean;
  maxLength?: number;
  largura?: number;
  rotuloAcessivel?: string;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
      <CampoTexto
        value={valor}
        placeholder={placeholder}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={maxLength}
        onChangeText={(texto) => onChange(texto.replace(/\D/g, ""))}
        erro={erro}
        style={{ width: largura, textAlign: "center" }}
        accessibilityLabel={rotuloAcessivel}
      />
      {sufixo && (
        <Txt variant="label" tom="muted">
          {sufixo}
        </Txt>
      )}
    </View>
  );
}

/* ------------------------------- segmentado ------------------------------- */

export function Segmentado<T extends string | number>({
  opcoes,
  valor,
  onChange,
}: {
  opcoes: readonly { valor: T; rotulo: string }[];
  valor: T;
  onChange: (valor: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      role="radiogroup"
      style={{
        flexDirection: "row",
        backgroundColor: t.colors.surfaceAlt,
        borderRadius: t.radius.md,
        padding: 3,
        gap: 3,
      }}
    >
      {opcoes.map((opcao) => {
        const ativo = opcao.valor === valor;
        return (
          <Pressable
            key={String(opcao.valor)}
            onPress={() => onChange(opcao.valor)}
            role="radio"
            aria-checked={ativo}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 10,
              paddingHorizontal: 4,
              borderRadius: t.radius.sm + 1,
              backgroundColor: ativo ? t.colors.surface : "transparent",
              borderWidth: ativo ? 1 : 0,
              borderColor: t.colors.borderStrong,
            }}
          >
            <Txt
              variant="label"
              tom={ativo ? "primary" : "muted"}
              centro
              style={ativo ? { fontWeight: "700" } : undefined}
            >
              {opcao.rotulo}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------ seletor de cor ------------------------------ */

const TAMANHO_AMOSTRA = 44;

/**
 * Grade de cores do local. A selecionada ganha um aro e um "visto" — nao so
 * uma mudanca de cor, para quem nao distingue matizes continuar sabendo qual
 * esta marcada. Cada amostra tem o nome da cor para leitores de tela.
 */
export function SeletorCor({
  valor,
  onChange,
  usadasPor,
}: {
  valor: string;
  onChange: (hex: string) => void;
  /** hex (minusculo) -> nome do local que ja usa a cor. */
  usadasPor?: Record<string, string>;
}) {
  const t = useTheme();
  return (
    <View
      role="radiogroup"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.md }}
    >
      {coresLocais.map((cor) => {
        const ativa = cor.hex.toLowerCase() === valor.toLowerCase();
        const usadaPor = usadasPor?.[cor.hex.toLowerCase()];
        return (
          <Pressable
            key={cor.hex}
            onPress={() => onChange(cor.hex)}
            role="radio"
            aria-checked={ativa}
            aria-label={usadaPor ? `${cor.nome}, usada por ${usadaPor}` : cor.nome}
            style={{
              width: TAMANHO_AMOSTRA,
              height: TAMANHO_AMOSTRA,
              borderRadius: TAMANHO_AMOSTRA / 2,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: ativa ? 3 : 0,
              borderColor: t.colors.text,
            }}
          >
            <View
              style={{
                width: ativa ? TAMANHO_AMOSTRA - 10 : TAMANHO_AMOSTRA,
                height: ativa ? TAMANHO_AMOSTRA - 10 : TAMANHO_AMOSTRA,
                borderRadius: TAMANHO_AMOSTRA,
                backgroundColor: cor.hex,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {ativa && <Icone name="check" size={20} color="#FFFFFF" />}
              {!ativa && usadaPor && (
                // Marca discreta: a cor existe, mas ja pertence a outro local.
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: "#FFFFFF",
                    opacity: 0.85,
                  }}
                />
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function nomeDaCorEscolhida(hex: string): string {
  return nomeDaCor(hex);
}
