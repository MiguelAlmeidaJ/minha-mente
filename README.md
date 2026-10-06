# Minha Mente — Chrome Extension V1.3

Agenda pessoal em Manifest V3 com calendário, tarefas, lembretes, recorrência e sincronização real com Google Calendar.

## Recursos

- Calendário mensal.
- Lista de compromissos.
- Tarefas com checkbox.
- Eventos recorrentes: diário, semanal e mensal.
- Lembretes com notificações do Chrome.
- Armazenamento local com `chrome.storage.local`.
- OAuth 2.0 usando `chrome.identity`.
- Sincronização com o calendário principal do Google.
- Criação, edição e exclusão de eventos no Google Calendar.
- Importação de eventos do Google para a extensão.
- Identificação visual de eventos vinculados ao Google.

## Instalar localmente

1. Clone ou baixe este repositório.
2. Abra `chrome://extensions/`.
3. Ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta do projeto.
6. Copie o **ID da extensão** exibido pelo Chrome.

## Configurar Google Calendar

1. Acesse o Google Cloud Console.
2. Crie ou selecione um projeto.
3. Ative a **Google Calendar API**.
4. Configure a tela de consentimento OAuth.
5. Crie uma credencial OAuth do tipo **Chrome Extension**.
6. Informe o ID da extensão mostrado em `chrome://extensions/`.
7. Copie o Client ID.
8. Em `manifest.json`, substitua:

```json
"client_id": "SUBSTITUA_PELO_CLIENT_ID.apps.googleusercontent.com"
```

pelo Client ID real.
9. Volte a `chrome://extensions/` e clique em **Recarregar**.
10. Abra a agenda e clique em **Conectar Google Agenda**.

## Escopo usado

A extensão solicita somente:

```text
https://www.googleapis.com/auth/calendar.events
```

Esse escopo permite visualizar e editar eventos, sem conceder permissões para compartilhar agendas ou alterar ACLs.

## Como a sincronização funciona

- Evento criado na extensão: é criado no Google Calendar quando a conta está conectada.
- Evento alterado na extensão: é atualizado no Google.
- Evento excluído na extensão: é excluído no Google.
- **Sincronizar agora**: envia eventos locais ainda não vinculados e importa eventos do Google.
- Eventos importados recebem referência `googleEventId` para evitar duplicação.
- Séries recorrentes criadas pela extensão são mantidas como recorrência no Google.

## Observação

Não coloque Client Secret na extensão. Extensões Chrome usam OAuth público e o `chrome.identity` gerencia o token.
