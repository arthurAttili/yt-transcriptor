# YT Transcriptor

Extensão de Chrome que copia a transcrição de qualquer vídeo do YouTube com um único clique no ícone. Se o vídeo não tiver transcrição, um aviso aparece na tela. Também gera um resumo crítico do vídeo com um clique, via Gemini.

## Como funciona

Ao clicar no botão da extensão, um script é injetado na página do vídeo, lê as faixas de legenda direto do player (preferindo legenda manual à automática), baixa a faixa em JSON e copia o texto com timestamps para a área de transferência. Nada sai do navegador — sem servidor, sem conta, sem rastreamento.

O YouTube passou a exigir um token de origem (`pot`) no endpoint de legendas — sem ele, a resposta vem com corpo vazio. Quando isso acontece, a extensão reaproveita a URL assinada que o próprio player já gerou nesta sessão, ou força o player a gerá-la ligando e desligando as legendas por um instante (o estado do usuário é restaurado em seguida).

Formato copiado:

```
Título do vídeo

0:00 Primeira fala do vídeo
0:26 Segunda fala...
```

## Resumo com Gemini

Nas páginas de vídeo aparece um botão flutuante **✨ Resumo** (canto inferior direito). Um clique coleta a transcrição, envia ao modelo `gemini-3.7-flash` e abre um painel lateral com:

- **Resumo** — síntese fiel do conteúdo
- **Pontos principais** — bullets com timestamps
- **Análise crítica** — prós e contras do conteúdo, para desenvolvimento de senso crítico
- **Perguntas para reflexão**

O título do resumo é sempre o nome do vídeo. O painel tem botão para copiar o resumo em Markdown.

**Cadastro da chave:** clique com o botão direito no ícone da extensão → **Opções** (ou use o botão "Cadastrar chave" que o painel mostra quando falta a chave). A chave é criada grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey), é validada no salvamento e fica guardada só no navegador (`chrome.storage.local`), usada exclusivamente em chamadas diretas à API do Google.

## Instalação

1. Baixe/clone este repositório
2. Abra `chrome://extensions` no Chrome
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e aponte para a pasta do projeto
5. Fixe o ícone na barra e clique nele em qualquer vídeo do YouTube

## Estrutura

- `manifest.json` — Manifest V3 (`activeTab`, `scripting`, `storage` + hosts do YouTube e da API do Gemini)
- `background.js` — service worker: injeta o coletor de transcrição (copiar e resumir) e chama a API do Gemini
- `content.js` — botão flutuante "Resumo" e painel lateral nas páginas de vídeo
- `options.html` / `options.js` — cadastro e validação da chave da API do Gemini
- `icons/` — ícones da extensão
