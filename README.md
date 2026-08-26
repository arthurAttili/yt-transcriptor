# YT Transcriptor

Extensão de Chrome que copia a transcrição de qualquer vídeo do YouTube com um único clique no ícone. Se o vídeo não tiver transcrição, um aviso aparece na tela.

## Como funciona

Ao clicar no botão da extensão, um script é injetado na página do vídeo, lê as faixas de legenda direto do player (preferindo legenda manual à automática), baixa a faixa em JSON e copia o texto com timestamps para a área de transferência. Nada sai do navegador — sem servidor, sem conta, sem rastreamento.

Formato copiado:

```
Título do vídeo

0:00 Primeira fala do vídeo
0:26 Segunda fala...
```

## Instalação

1. Baixe/clone este repositório
2. Abra `chrome://extensions` no Chrome
3. Ative o **Modo do desenvolvedor** (canto superior direito)
4. Clique em **Carregar sem compactação** e aponte para a pasta do projeto
5. Fixe o ícone na barra e clique nele em qualquer vídeo do YouTube

## Estrutura

- `manifest.json` — Manifest V3, permissões mínimas (`activeTab` + `scripting`)
- `background.js` — service worker: recebe o clique e injeta o coletor na página
- `icons/` — ícones da extensão
