# Confere ou Confia?

Dinâmica da reunião técnica do LIB, aplicada depois da Pílula de IA sobre
alucinação. Design em `docs/superpowers/specs/2026-08-27-confere-ou-confia-design.md`,
protótipo navegável em `design/confere-ou-confia.html`.

## Rodar local

```bash
npm install
ADMIN_KEY=teste npm start
```

Abrir `http://localhost:3000/painel.html?k=teste`, criar a rodada, e depois
`http://localhost:3000/quiz.html` numa aba anônima.

## Subir no VPS (Portainer + Swarm + Traefik)

A imagem é construída pelo GitHub Actions a cada push em `main` e publicada em
`ghcr.io/cristianolib/confere-ou-confia:latest`. A stack está em `stack.yml`.

**Primeira vez**, no Portainer: Stacks → Add stack → **Repository** →
URL do repositório, referência `refs/heads/main`, compose path `stack.yml`.
Em **Environment variables** (embaixo do editor, não no YAML), criar
`ADMIN_KEY` com uma chave longa. Deploy.

**Atualizar** depois de um push em `main`: esperar o Actions terminar, então
no Portainer abrir a stack → **Update the stack** → marcar **Re-pull image and
redeploy** → Update.

**Nunca** subir para mais de uma réplica: o SQLite é local e os canais SSE
vivem na memória do processo.

DNS: `rtquiz.libtools.online` → IP do VPS (registro A, igual aos outros
subdomínios da `libtools.online`).

## As três telas

| Tela | URL | Quem vê |
|---|---|---|
| Quiz | `https://rtquiz.libtools.online/rt` | vai no chat do Zoom; o endereço curto se ajusta no painel |
| Telão | `https://rtquiz.libtools.online/telao.html?k=CHAVE` | você compartilha esta |
| Painel | `https://rtquiz.libtools.online/painel.html?k=CHAVE` | só você, segunda tela |

## Roteiro do dia

1. Antes de entrar na reunião: abrir o painel, criar a rodada com a previsão
   de participantes, conferir quantas questões entraram em jogo.
2. Compartilhar **o telão** no Zoom. Nunca o painel.
3. Colar o link do quiz no chat. Ver o contador de conectados subir.
4. **Liberar o início.** O telão passa a mostrar só o progresso.
5. Quando os finalizados estabilizarem, **Revelar**.
6. Percorrer o debrief com "Avançar", conversando em cada tela.

## Ensaio

Rodar com 3 ou 4 colegas alguns dias antes, e depois **Zerar rodada** no
painel. Zerar apaga participantes e respostas, mantém as questões em jogo e
volta a fase para espera. Para ensaiar sem esperar a trava, criar a rodada
com trava de 0 segundos.

## Testes

```bash
npm test
```
