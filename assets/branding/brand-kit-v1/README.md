# Agent Workbench - Brand kit v1.0

Identidade baseada no símbolo de robô aprovado na direção laranja e roxo.

## Usar

- Símbolo principal: `01-logos/svg/awb-symbol-orange.svg`.
- Assinatura em fundo escuro: `awb-lockup-light.svg`.
- Assinatura em fundo claro: `awb-lockup-dark.svg`.
- SVG e PDF são vetoriais. O lettering dos SVG está em contornos.
- PNG dos logos tem transparência. Os ícones de aplicação têm um fundo próprio.
- Os números no nome dos PNG indicam a dimensão em píxeis.
- Respeitar a margem livre e os tamanhos mínimos do guia.

## Cores

Laranja principal: #FF791F. Fundo roxo: #21182F.
Tokens prontos em CSS e JSON, com uma paleta GIMP adicional.
Os valores são RGB para ecrã. Para impressão, usar uma conversão com prova de cor.

## Fontes

Open Sans Regular, Semibold e Bold; Source Code Pro Regular.
Ficheiros de terceiros com as respetivas licenças originais em `04-fonts`.

## Construção

O símbolo foi reconstruído como geometria vetorial para limpar os recortes e as cores da proposta visual. A aplicação não depende destes scripts de exportação.

O script em `06-source/build-brand-kit.py` usa Python, reportlab, Pillow, fonttools e Poppler (`pdftocairo`). Para reconstruir a partir do ZIP extraído, executar `python3 06-source/build-brand-kit.py` dentro da pasta do kit, com estas ferramentas disponíveis. No repositório, executar `python3 scripts/build-brand-kit.py`. Os ficheiros deste kit podem ser usados diretamente sem executar o script.

A prancha e o exemplo de interface são demonstrações de identidade, não capturas de uma sessão real.
