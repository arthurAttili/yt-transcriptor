# YT Transcriptor

Extensão de Chrome que copia a transcrição de qualquer vídeo do YouTube com um clique no ícone. Também gera resumo crítico do vídeo pelo Gemini. E compara dois vídeos entre si.

## Como funciona

Ao clicar no ícone da extensão, um script é injetado na página do vídeo, lê as faixas de legenda direto do player (preferindo legenda manual à automática), baixa a faixa em JSON e copia o texto com timestamps para a área de transferência. O popup que abre junto confirma a cópia e dá acesso ao resumo, à comparação e às instruções. Nada sai do navegador — sem servidor, sem conta, sem rastreamento.

O YouTube passou a exigir um token de origem (`pot`) no endpoint de legendas — sem ele, a resposta vem com corpo vazio. Quando isso acontece, a extensão reaproveita a URL assinada que o próprio player já gerou nesta sessão, ou força o player a gerá-la ligando e desligando as legendas por um instante (o estado do usuário é restaurado em seguida).

Formato copiado:

```
Título do vídeo

0:00 Primeira fala do vídeo
0:26 Segunda fala...
```

## Resumo com Gemini

O botão **.txt** entra na interface nativa do YouTube em dois lugares: na barra de ações do vídeo (junto de like/compartilhar) e nos controles do player (junto de legendas/engrenagem — disponível também em tela cheia). Um clique coleta a transcrição, envia ao modelo `gemini-3.7-flash` e abre um painel lateral com:

- **Resumo** — síntese fiel do conteúdo
- **Pontos principais** — bullets com timestamps
- **Análise crítica** — prós e contras do conteúdo, para desenvolvimento de senso crítico
- **Perguntas para reflexão**

O título do resumo é sempre o nome do vídeo. O painel tem botão para copiar o resumo em Markdown.

### Instruções personalizadas

Em **Instruções do resumo**, no popup do ícone, dá para reescrever o que o modelo deve fazer. O campo já vem preenchido com a instrução padrão (formato, tom e regras acima); **Restaurar padrão** desfaz qualquer alteração. A instrução vale para o resumo simples e para a comparação.

### Comparar dois vídeos

**Comparar com outro vídeo**, no popup, pede a URL de um segundo vídeo e devolve uma análise conjunta: tese de cada um, onde concordam, onde divergem, o que é exclusivo de cada lado e uma leitura crítica dos dois.

A transcrição só sai com o player carregado, então o segundo vídeo é aberto numa aba em segundo plano apenas para a leitura e fechado em seguida.

**Cadastro da chave:** no popup do ícone, em **Chave da API do Gemini** (ou pelo botão "Cadastrar chave" que o painel mostra quando falta a chave). A chave é criada grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey), é validada no salvamento e fica guardada só no navegador (`chrome.storage.local`), usada exclusivamente em chamadas diretas à API do Google.

## Instalação

1. Baixe/clone este repositório
2. Abra `chrome://extensions` no Chrome
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e aponte para a pasta do projeto
5. Fixe o ícone na barra e clique nele em qualquer vídeo do YouTube

## Estrutura

- `manifest.json` — Manifest V3 (`activeTab`, `scripting`, `storage` + hosts do YouTube e da API do Gemini)
- `background.js` — service worker: injeta o coletor de transcrição, abre a aba do segundo vídeo na comparação e chama a API do Gemini
- `content.js` — botões ".txt" integrados à interface do YouTube e painel lateral
- `popup.html` / `popup.js` — popup do ícone: cópia da transcrição, resumo, comparação e instruções do Gemini
- `options.html` / `options.js` — cadastro e validação da chave da API do Gemini
- `icons/` — ícones da extensão
