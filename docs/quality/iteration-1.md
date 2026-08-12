# Iteration Report — 1

- Project: Afiliados Pro
- Branch: `codex/agentic-quality-iteration-1-20260811`
- Código avaliado: `8ab919a2800d466c49b9c04e1e356a05db9f9004`
- Score inicial: 55–57/100
- Score independente atual: **73/100**
- Variação sobre o menor baseline: **+18**
- Veredito do Agente Juiz: **REJECTED**
- P0 abertas: 0
- Vulnerabilidades críticas: 0
- Testes críticos: 6/8 (**75% — FAIL**)
- Fluxos críticos: 0/3 (**0% — FAIL**)
- Regressões críticas: 0

## Evidências automatizadas

O GitHub Actions Quality Gate, execução **31545907589**, foi aprovado no código avaliado:

- TypeScript: PASS
- Testes automatizados: **12/12 PASS**
- Build de produção: PASS
- `npm audit` crítico: PASS
- Status Vercel do preview: PASS

A execução anterior **31545828682** reprovou com 11/12 testes. A falha foi registrada e corrigida; build e audit, que haviam sido ignorados, passaram na execução seguinte.

## Correções implementadas

- Shopee: removida a escolha por menor valor que confundia frete de R$ 9,62 com produto de R$ 33,90.
- Shopee: candidatos em contexto de frete, envio, entrega e parcelas são rejeitados; preço ambíguo não é inventado.
- Extensão 1.0.10: fonte e ZIP distribuído sincronizados e testados.
- WhatsApp: fingerprint v3 usa identidade canônica do produto, não texto/imagem como chave principal.
- WhatsApp: envio só recebe COMMIT depois da confirmação visual de uma nova mensagem; timeout vira `uncertain` e não é repetido automaticamente.
- WhatsApp: TTL de in-flight reduzido para 10 minutos; fila ativa, revisão e limpeza de histórico têm proteção contra concorrência.
- Firestore: IDs determinísticos reduzem produtos duplicados; batches são divididos em blocos de 450.
- Firestore: regras agora validam campos, tipos, limites, marketplace e updates de usuário.
- Segurança/deploy: CSP sem `unsafe-eval`, build com `npm ci`, domínio Firebase corrigido.
- Qualidade: suíte de regressão, GitHub Actions e estado persistente adicionados.

## Issues ainda abertas

- **AFF-TRACK-001 (P1):** faltam evidências reais de destino, identificador de afiliado e tracking em Mercado Livre, Amazon, AliExpress e Shopee.
- **RES-001 (P2):** rate limit continua local à instância e não é global em Vercel serverless.
- **ARCH-002 (P2):** `src/App.tsx` continua monolítico.
- Métricas de carga, resiliência, acessibilidade e desempenho ainda não foram executadas.

## Gates que impedem aprovação

1. E2E real: aplicativo → revisão → extensão → WhatsApp.
2. Shopee real: comprovar R$ 33,90 como preço do produto e rejeitar frete R$ 9,62.
3. Marketplace: comprovar URL final, affiliate ID e tracking nos quatro marketplaces.
4. Lote real controlado: comprovar exatamente um envio por produto, ordem preservada e comportamento após parar/retomar.

## Decisão

O PR permanece aberto e **não deve ser mesclado/publicado como versão aprovada** enquanto o Agente Juiz mantiver FAIL. Testes automatizados provam as proteções implementadas, mas não autorizam afirmar “sucesso absoluto” no WhatsApp ou nos programas de afiliados.

A fonte estruturada e persistente desta auditoria está em `agent-state.json`.
