# Análise técnica — ML Afiliados Pro 1.1

## Erros críticos corrigidos

1. A chave Gemini era incorporada ao JavaScript do navegador. A chamada de IA agora passa pelo servidor.
2. Os endpoints de captura e imagem aceitavam URLs arbitrárias, permitindo requisições para destinos indevidos. Agora há validação de protocolo e domínio.
3. O proxy aceitava respostas que não eram imagens e não limitava tamanho, redirecionamentos ou tempo de resposta.
4. `npm start` tentava executar TypeScript diretamente com Node. O comando agora utiliza o carregador TSX compatível.
5. O Service Worker mantinha páginas antigas no cache. A navegação agora prioriza a rede e remove versões antigas.
6. O listener de carregamento do Service Worker não era removido quando o componente era desmontado.
7. A captura individual não apresentava validação clara de URL ou confirmação de inclusão na fila.
8. A tela apresentava versões conflitantes da automação (V9, V11 e V21). O cabeçalho agora descreve o fluxo em duas etapas, e cada atalho mantém apenas a sua versão.
9. Os elementos arrastáveis eram `div`; agora são botões semânticos, com foco visível e descrição para tecnologias assistivas.
10. O bloco de envio não indicava quantos produtos estavam selecionados. Agora mostra o estado da fila e o total preparado.
11. O bundle principal tinha aproximadamente 931 kB. As dependências grandes foram separadas em pacotes menores.
12. O README original não documentava Firebase, implantação, testes nem limites das automações.

## Validações executadas

- TypeScript: aprovado com `npm run lint`.
- Build Vite de produção: aprovado com `npm run build`.
- Página inicial: HTTP 200.
- Bloqueio de URL local no capturador: HTTP 400.
- Bloqueio de domínio não autorizado no proxy de imagem: HTTP 400.
- Resposta controlada da IA sem chave configurada: HTTP 503.
- Inicialização do servidor: aprovada em `http://localhost:3000`.

## Configuração necessária pelo proprietário

- Habilitar login Google no Firebase Authentication.
- Adicionar o domínio publicado à lista de domínios autorizados do Firebase.
- Publicar `firestore.rules` no projeto Firebase.
- Preencher as variáveis `VITE_FIREBASE_*` no ambiente de hospedagem.
- Preencher `GEMINI_API_KEY` para ativar a melhoria de títulos.

## Limite externo

Os atalhos de favoritos dependem do HTML do Mercado Livre e do WhatsApp Web. Alterações feitas por essas plataformas podem exigir atualização dos seletores. Nenhum sistema baseado em bookmarklet pode garantir compatibilidade permanente com páginas de terceiros sem manutenção.
