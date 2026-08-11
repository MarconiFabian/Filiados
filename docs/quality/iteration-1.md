# Iteration Report — 1

- Project: Afiliados Pro
- Branch: `codex/agentic-quality-iteration-1-20260811`
- Previous score: 55/100
- Current provisional score: 76/100
- Verdict: **REJECTED**
- P0: 0
- P1 open or pending validation: 4
- Critical tests: pending CI and controlled E2E

## Correções implementadas

- Corrigido o fallback Shopee que podia selecionar o valor do frete como preço do produto.
- Sincronizado o código-fonte da extensão com o pacote baixável, versão 1.0.10.
- Adicionados testes de regressão para preço, links, versão do ZIP e trava de duplicidade.
- Adicionado Quality Gate no GitHub Actions.
- Criado `agent-state.json` como histórico persistente de issues, testes, decisões, bloqueios e scores.

## Evidência do bug

No caso fornecido, o produto custava R$ 33,90, mas a extensão selecionou R$ 9,62 porque o fallback escolhia o menor preço do bloco, que era o frete. A nova regra elimina a seleção por mínimo, rejeita contextos de frete/envio/entrega/parcela e prioriza o preço visual principal.

## Pendências que impedem aprovação

- CI ainda precisa executar tipos, testes, build e audit crítico.
- E2E controlado precisa validar captura e envio no navegador real.
- Tracking dos quatro marketplaces precisa de amostras autenticadas do titular.
- CSP e rate limiting distribuído permanecem como melhorias P2.
- `App.tsx` continua monolítico e requer refatoração incremental.

O histórico estruturado está em `agent-state.json`.
