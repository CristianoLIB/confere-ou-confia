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

## Subir no VPS

```bash
cp .env.example .env   # editar DOMINIO e ADMIN_KEY
docker compose up -d --build
```

## As três telas

| Tela | URL | Quem vê |
|---|---|---|
| Quiz | `https://SEU_DOMINIO/quiz.html` | vai no chat do Zoom |
| Telão | `https://SEU_DOMINIO/telao.html?k=CHAVE` | você compartilha esta |
| Painel | `https://SEU_DOMINIO/painel.html?k=CHAVE` | só você, segunda tela |

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
