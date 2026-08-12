# ML Afiliados Pro

Sistema web para capturar ofertas do Mercado Livre, editar os anúncios, organizar uma fila e preparar o envio pelo WhatsApp Web.

Produção: https://filiados-phi.vercel.app

## Requisitos

- Node.js 22
- Projeto Firebase com Authentication (Google) e Firestore
- Chave Gemini, opcional, para melhorar títulos com IA

## Instalação

1. Execute `npm install`.
2. Copie `.env.example` para `.env.local`.
3. Preencha as variáveis Firebase e, se desejar usar IA, `GEMINI_API_KEY`.
4. Execute `npm run dev` e abra `http://localhost:3000`.

## Verificações

- `npm run lint`: valida os tipos TypeScript.
- `npm test`: executa os testes de regressão.
- `npm run build`: gera a aplicação de produção.
- `npm run check`: executa tipos, testes e build.
- `npm start`: inicia o servidor local com as APIs e o frontend.

## Implantação

As funções em `api/` são compatíveis com Vercel. Cadastre as mesmas variáveis de ambiente no serviço de hospedagem e adicione o domínio publicado em Firebase Authentication > Authorized domains.

Na Vercel, o projeto utiliza o framework Vite, o comando `npm run build` e a saída `dist`. Cadastre `GEMINI_API_KEY` como variável Sensitive para Production, Preview e Development. Depois de alterar variáveis, gere um novo deploy.

O login Google usa `VITE_FIREBASE_AUTH_DOMAIN` (ou o domínio padrão do Firebase) e faz proxy transparente de `/__/auth/*` para o Firebase. Além de autorizar `ml-afiliados-pro.vercel.app` no Firebase Authentication, mantenha `https://filiados-phi.vercel.app/__/auth/handler` entre os URIs de redirecionamento autorizados do cliente OAuth Google.

## Configuração do Firestore

O projeto já inclui `firebase.json`, `.firebaserc`, `firestore.rules` e `firestore.indexes.json` apontando para o banco configurado no aplicativo.

1. Execute `npm run firebase:login` e entre na conta proprietária do Firebase.
2. Confirme que a conta possui acesso ao projeto `gen-lang-client-0772285066`.
3. Execute `npm run firebase:deploy` para publicar regras e índices.

## Variáveis da aplicação

Nunca envie `.env.local` ao GitHub. Configure `GEMINI_API_KEY` diretamente no serviço de hospedagem. As variáveis `VITE_FIREBASE_*` identificam o aplicativo Firebase no navegador e também devem ser cadastradas na hospedagem conforme `.env.example`.

## Limites conhecidos

Os atalhos de captura e envio dependem da interface atual do Mercado Livre e do WhatsApp Web. Como essas plataformas podem alterar o HTML sem aviso, o sistema oferece mensagens de erro e envio somente em texto quando uma imagem não puder ser anexada. Revise os produtos e a conversa antes de iniciar qualquer lote.
