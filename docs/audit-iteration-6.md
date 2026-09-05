# Auditoria — iteração 6

Estado persistente: `agent-state.json`. Histórico anterior preservado.

## Correções candidatas

- Normalização decimal Shopee e escala fixa dos campos inteiros PDP.
- Confirmação de envio vinculada à aba, fila, índice e produto reservado.
- Observador rejeita origem e IDs divergentes; variante selecionada tem prioridade.
- Pacote 1.0.15 reproduzível com comparação de todos os arquivos.
- Gates derivados de issues/evidências do commit; histórico com lock e gravação atômica.
- CI salva snapshot e resultados inclusive em falhas. Artefatos duram 90 dias; consolidar resultados no JSON versionado.

## Retomada

1. Ler issues, blockedItems, iterations e testRuns em `agent-state.json`.
2. Executar `npm ci` e `npm run quality:state`.
3. Iniciar rodada: `npm run quality:begin -- "Descrição"`.
4. Implementar e executar `npm run check`.
5. Após alterações da extensão: `npm run extension:package` e `npm run extension:check`.
6. Registrar evidências com commit testado; executar `npm run quality:refresh` após editar estado.
7. Obter revisão independente documentada. O comando quality:state valida integridade; sucesso do comando não significa produto aprovado.

## Evidências pendentes

Testes de comportamento usam VM e APIs controladas. Preço real Shopee, tracking de quatro marketplaces, WhatsApp real e revisão independente continuam pendentes. Terminal local falhou com erro ACL. A nota histórica 73/100 não é uma nova avaliação. Gate permanece REJECTED.
