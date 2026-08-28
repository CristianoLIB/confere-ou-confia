# Confere ou Confia? — Design

Dinâmica interativa para a reunião técnica do Lean Institute Brasil, aplicada
logo após a Pílula de IA sobre alucinação (`script.txt`).

Data: 2026-08-27

---

## 1. Objetivo

O script ensina uma distinção e uma régua:

- **Distinção** — o Google é bibliotecário (busca), a IA generativa é redator
  (redação). São ferramentas diferentes para necessidades diferentes.
- **Régua** — "confiar é ótimo, conferir é obrigatório".

A dinâmica faz o grupo **exercitar a distinção** em situações reais de
consultoria e depois **encarar o próprio resultado coletivo**. O produto final
não é o placar: é a conversa que o placar abre.

Restrições do contexto:

- Reunião **online, via Zoom**. Cada participante em sua própria máquina e IP.
- Até **50 participantes simultâneos**.
- A tela de resultados é **compartilhada no Zoom** — está no mesmo monitor em
  que a pessoa responde.
- Resultado **não nominal**. Interessa o agregado, nunca quem errou o quê.

---

## 2. Decisões tomadas

| Decisão | Escolha | Razão |
|---|---|---|
| Eixo da resposta | Binário: **Busca** ou **Redação** | A nuance mora no enunciado; a resposta é só o veredito. Gabarito indiscutível ao vivo. |
| Banco de questões | 20 escritas, subconjunto ativo por reunião | Variedade entre participantes e reuso em outras turmas. |
| Quantas ficam ativas | Calculado pela **previsão de participantes** informada no painel | Mira ~18 respostas por questão, para que cada barra signifique algo. |
| Distribuição | **Rodízio** (menos servidas primeiro), 2 Busca + 2 Redação por pessoa | Amostras equilibradas mesmo se o público variar. |
| Ritmo | Cada um no seu ritmo | Sobre Zoom, lockstep quebra com atraso e queda de conexão. |
| Resultado | **Segurado** até você revelar | Gera expectativa e impede vazamento pela tela compartilhada. |
| Pergunta relâmpago | **A/B**: metade com 10s, metade sem cronômetro | Prova ao vivo a tese do script sobre pressa e conferência. |
| Hospedagem | VPS: Node + SQLite + Docker | Sem dependência de nuvem de terceiro no momento da apresentação. |

---

## 3. A experiência

### 3.1 Participante (celular ou aba do navegador)

1. Abre o link postado no chat do Zoom. Sem login, sem nome. (Sem QR code: a
   reunião é online e todo mundo já está num computador com o chat à mão — o QR
   seria uma dependência a mais para um caminho que ninguém usaria.) Recebe um rótulo
   automático só para se reconhecer: *Participante #17*.
2. Tela de espera enquanto a fase da rodada é `espera`.
3. Quando você libera, responde **4 situações**, uma por tela, dois botões
   grandes: **🔎 Isso é BUSCA** / **✍️ Isso é REDAÇÃO**.
4. **Nenhum feedback durante o quiz.** Ao terminar: *"Suas 4 respostas foram
   registradas. Aguarde a revelação."*
5. **Todos** recebem então a **pergunta relâmpago** — a mesma pergunta para o
   público inteiro. Só muda uma coisa: metade vê um cronômetro de 10s correndo,
   a outra metade não vê cronômetro nenhum. Ela usa outro eixo, o que dá nome à
   dinâmica: **Confio** / **Confiro**.
6. No instante em que você revela, a tela dela acende junto com o telão e
   mostra o placar pessoal.

O passo 4 é deliberado. Feedback imediato destruiria a segurada — a pessoa
passaria os últimos minutos sabendo o resultado enquanto você constrói o
suspense. Também fecha uma brecha real: o gabarito nunca chega ao navegador do
participante antes da hora.

### 3.2 Telão (o que você compartilha no Zoom)

Somente leitura, sem controles, tipografia grande e alto contraste — precisa
sobreviver à compressão de vídeo do Zoom.

| Fase | O que aparece |
|---|---|
| Espera | Link em destaque, contador *"31 conectados"* |
| Respondendo | Progresso coletivo enchendo: *"37 de 48 finalizaram"*. **Zero placar.** |
| Revelado | A sequência de debrief, avançada pelo seu clique |

### 3.3 Painel de controle (só você, em outra tela)

URL protegida por chave. Ações:

- Criar rodada informando a **previsão de participantes**; o sistema sugere o
  número de questões ativas e você pode sobrescrever.
- Abrir/fechar entradas.
- Liberar o início (`espera` → `respondendo`).
- **Revelar**.
- Avançar os passos do debrief.
- Zerar a rodada (para ensaiar antes e limpar).

Telão e painel são URLs separadas de propósito: se os botões estivessem na tela
compartilhada, o público veria os controles e o que vem a seguir.

### 3.4 A sequência do debrief

Cada passo avança no seu clique.

1. **Placar global animado** — *"de 192 decisões, vocês acertaram X%"*
2. **Acertos por categoria** — onde o grupo é forte e onde escorrega. Este é o
   passo que gera a discussão, não o total.
3. **As armadilhas** — as 2 ou 3 questões com maior taxa de erro, uma por vez,
   com enunciado, gabarito e a regra do script.
4. **O A/B do relâmpago** — *"quem teve 10 segundos acertou X%. Quem teve tempo
   acertou Y%. Vocês são as mesmas pessoas."*
5. **Fechamento** — "confiar é ótimo, conferir é obrigatório".

---

## 4. Arquitetura

Stack deliberadamente pequena. A carga é trivial (50 pessoas, 2 telas); o que
importa é não falhar no dia.

- **Backend** — Node 22 + Fastify
- **Banco** — SQLite via `better-sqlite3` (síncrono, sem pool, sem servidor)
- **Tempo real** — SSE (o push é só do servidor para o cliente; WebSocket seria
  complexidade sem ganho)
- **Frontend** — HTML/CSS/JS sem etapa de build
- **Deploy** — Docker Compose: app + Caddy (TLS automático no domínio)

Persistência em SQLite em vez de estado em memória porque um restart no meio da
dinâmica não pode zerar as respostas.

### Estrutura de arquivos

```
src/
  servidor.js          bootstrap do Fastify, rotas, SSE
  db.js                conexão, migrações, seed
  rodada.js            ciclo de vida e transições de fase
  distribuicao.js      dimensionamento, rodízio, grupos A/B
  respostas.js         registro, trava, validação do cronômetro
  agregados.js         cálculo dos números do telão
  publico/
    quiz.html  telao.html  painel.html  (+ css, js)
dados/
  questoes.json        banco versionado das 20 questões
testes/
```

`distribuicao.js`, `respostas.js` e `agregados.js` são puros o suficiente para
serem testados sem HTTP. É onde mora a lógica que pode dar errado.

---

## 5. Modelo de dados

```sql
rodada
  id, criada_em, previsao_participantes, num_questoes_ativas,
  fase TEXT CHECK (fase IN ('espera','respondendo','revelado')),
  entradas_abertas INTEGER, segundos_relampago INTEGER, passo_debrief INTEGER

questao
  id, texto, categoria, gabarito TEXT CHECK (gabarito IN ('busca','redacao')),
  explicacao, essencial INTEGER, e_relampago INTEGER

rodada_questao                      -- as questões em jogo nesta rodada
  rodada_id, questao_id
  PRIMARY KEY (rodada_id, questao_id)

participante
  id, rodada_id, token, rotulo, ordem_chegada,
  grupo_relampago TEXT CHECK (grupo_relampago IN ('cronometro','controle')),
  criado_em, finalizado_em
  UNIQUE (rodada_id, token)

atribuicao                          -- as 4 questões daquele participante
  participante_id, questao_id, posicao, entregue_em
  UNIQUE (participante_id, posicao)

resposta
  participante_id, questao_id,
  escolha TEXT CHECK (escolha IN ('busca','redacao','confio','confiro','expirou')),
  correta INTEGER, ms_para_responder, respondido_em
  UNIQUE (participante_id, questao_id)          -- a trava
```

O `UNIQUE (participante_id, questao_id)` em `resposta` é a trava anti-repetição.
Não é uma validação de aplicação que dá para contornar: é uma restrição do
banco.

---

## 6. Regras

### 6.1 Dimensionamento pela previsão

Você informa a previsão `P`. O sistema calcula:

```
decisoes = P * 4
K = arredonda(decisoes / 18)      alvo de ~18 respostas por questão
K = limita(K, 6, 14)
K = ajusta para número par        para permitir divisão 50/50 entre gabaritos
```

| Previsão | Decisões | Questões ativas | Amostra por questão |
|---|---|---|---|
| 20 | 80 | 6 | ~13 |
| 30 | 120 | 8 | ~15 |
| 45 | 180 | 10 | ~18 |
| 50 | 200 | 12 | ~17 |

O valor é **sugerido**; você pode sobrescrever no painel.

**Seleção do subconjunto ativo** — estratificada, nesta ordem:

1. Inclui todas as questões marcadas `essencial`.
2. Completa mantendo `K/2` de gabarito Busca e `K/2` de Redação.
3. Ao completar, varia as categorias antes de repetir uma já representada.

A questão marcada `e_relampago` **fica fora dessa conta**. Ela é inserida em
`rodada_questao` como qualquer outra (para que o gabarito e a explicação venham
do mesmo lugar), mas não entra no cálculo de `K`, não participa do rodízio e não
conta para o 2/2 de gabarito: é sempre entregue, a todos, na posição 5.

### 6.2 Distribuição por rodízio

Quando um participante entra, ele recebe as **4 questões menos servidas** da
rodada até aquele momento, sempre **2 de gabarito Busca e 2 de Redação**,
desempate aleatório. A ordem é embaralhada por participante.

O 2/2 evita que alguém receba quatro situações do mesmo tipo e tenha uma
experiência estranha.

A previsão só define **quantas** questões entram em jogo. Se aparecer gente
demais ou de menos, o rodízio se corrige sozinho: cada novo participante puxa
as menos servidas.

### 6.3 Grupo A/B do relâmpago

Atribuído na entrada, **alternando por ordem de chegada** (par → `cronometro`,
ímpar → `controle`). Fica ~50/50 sem depender de sorte.

Ambos os grupos recebem a mesma pergunta relâmpago; só o grupo `cronometro` vê
a contagem regressiva.

### 6.4 Validação do cronômetro

O servidor grava `entregue_em` ao servir a questão relâmpago. Ao receber a
resposta, se `agora - entregue_em > segundos_relampago + 2s` (folga de rede), a
escolha é gravada como `'expirou'`. O cliente também exibe a contagem e
autoenvia `'expirou'` ao zerar.

Estourar o tempo **não conta como erro**. Vira uma fatia própria no gráfico:
sob pressão, não decidir também é resultado.

### 6.5 Identidade e retomada

Token anônimo gerado no primeiro acesso, guardado em `localStorage` **e** em
cookie. Reabrir a página **retoma** a mesma sessão — não cria participante novo,
não zera respostas.

Limpar o navegador ou usar aba anônima cria um participante novo. Aceitável
para uma dinâmica interna: quem fizer isso recebe outras questões e não
consegue alterar as respostas já gravadas.

**Sem bloqueio por IP.**

---

## 7. API

### Participante

| Rota | Retorna |
|---|---|
| `POST /api/entrar` | `{ token, rotulo, fase, questoes: [{id, texto}] }` — **sem gabarito** |
| `POST /api/responder` | `{ ok, proxima }` — **não diz se acertou** |
| `GET /api/meu-resultado` | 409 enquanto a fase não for `revelado` |
| `GET /stream` (SSE) | só mudanças de fase |

### Painel e telão (autenticados por chave)

| Rota | Função |
|---|---|
| `POST /api/painel/rodada` | cria rodada com `previsaoParticipantes`, `numQuestoesAtivas?`, `segundosRelampago` |
| `POST /api/painel/fase` | transição de fase |
| `POST /api/painel/entradas` | abre/fecha entradas |
| `POST /api/painel/debrief` | avança o passo do debrief |
| `POST /api/painel/zerar` | limpa a rodada |
| `GET /stream/painel` (SSE) | agregados completos |

---

## 8. Tempo real

Dois canais SSE separados, e a separação é a garantia de não vazamento:

- `/stream` — participantes. Emite **apenas** a fase da rodada. Nenhum
  agregado, nenhum gabarito.
- `/stream/painel` — telão e painel, autenticado. Emite os agregados, com
  *debounce* de 500ms para não repintar a cada resposta.

Um participante que abra o DevTools não encontra o gabarito nem o placar: eles
nunca foram enviados para o canal dele.

---

## 9. Deploy

`docker-compose.yml` com dois serviços: a app Node e o Caddy fazendo proxy
reverso com TLS automático para o domínio. Volume nomeado para o arquivo
SQLite. `.env` com `ADMIN_KEY` e domínio.

Antes da reunião: subir, rodar um ensaio com 3-4 colegas, zerar a rodada.

---

## 10. Testes

Lógica testável sem HTTP, em `distribuicao.js`, `respostas.js` e `agregados.js`:

- Cálculo de questões ativas para previsões de 10 a 60.
- Seleção estratificada respeita `essencial`, mantém 50/50 de gabarito e varia
  categorias.
- Rodízio: com 50 participantes, a diferença entre a questão mais servida e a
  menos servida não passa de 1.
- Todo participante recebe exatamente 2 Busca e 2 Redação.
- Divisão A/B fica em 50/50 ±1.
- Resposta duplicada para a mesma questão é rejeitada e **não altera** a
  primeira.
- Resposta do relâmpago fora do prazo vira `'expirou'`, não erro.
- Agregados por categoria e o comparativo A/B batem com dados montados à mão.
- O relâmpago **não** entra no placar global nem no gráfico por categoria: ele
  tem eixo próprio e aparece apenas no passo 4 do debrief.

Integração:

- Fluxo completo de um participante, da entrada ao resultado revelado.
- `GET /api/meu-resultado` responde 409 antes da revelação.
- O payload de `/stream` não contém gabarito nem agregado.
- Carga: 50 participantes simultâneos entrando e respondendo.

---

## 11. Fora de escopo

Login, nomes, ranking individual, edição de questões por interface (ficam em
`dados/questoes.json` versionado), histórico entre reuniões além do "zerar",
internacionalização, cronômetro nas 4 questões normais.

---

## Apêndice A — Banco de questões

Sete categorias. As de gabarito **Busca**: dado estatístico, citação e fonte,
norma ou prazo, fato sobre terceiros. As de **Redação**: síntese de material
próprio, adaptação de linguagem, geração de ideias.

O texto abaixo é a primeira versão e deve ser revisado por você — é o conteúdo
que o público vai ler.

### Gabarito: 🔎 BUSCA

**B1 · dado estatístico · ESSENCIAL**
Você está fechando a proposta para uma montadora e quer abrir com um dado de
impacto: quanto o TPS reduziu o lead time nos primeiros anos da Toyota. A IA
devolve um percentual redondo, com o nome do livro, o autor e o ano.
*É a cena de abertura do script. Dado com citação é exatamente onde a alucinação
chega mais convincente.*

**B2 · citação e fonte**
Um cliente questionou sua afirmação sobre ganhos de produtividade em melhoria
contínua e pediu a referência. Você quer o estudo que sustenta o número.

**B3 · norma ou prazo**
O cliente perguntou qual o prazo vigente para adequação a uma NR atualizada
este ano. A resposta vai para o cronograma do projeto.

**B4 · fato sobre terceiros**
Você quer citar no material que determinada empresa brasileira implantou hoshin
kanri, e em que ano, como caso de referência do setor.

**B5 · citação e fonte · ARMADILHA · ESSENCIAL**
Você quer resumir para a equipe um artigo da Harvard Business Review sobre
gestão visual. Você tem o título e o autor, mas não tem o PDF.
*Parece "resumir". Mas ela não leu o artigo — vai redigir um resumo plausível de
algo que não viu.*

**B6 · dado que muda**
Você precisa do número atual de unidades da rede do cliente no Brasil para
dimensionar o piloto.

**B7 · citação e fonte**
Você quer a definição exata de muda, mura e muri como aparece no material
original, entre aspas, para um slide.

**B8 · citação e fonte · ARMADILHA**
Você pede à IA para comparar as abordagens de TPM de três autores de
referência. Ela devolve um quadro comparativo bem organizado, com nomes e
livros.
*Comparar é redação. Atribuir posições a autores nomeados é fato — e o formato
de quadro passa uma autoridade que o conteúdo pode não ter.*

**B9 · norma ou prazo**
O teto atual de um incentivo fiscal que o cliente quer usar no business case.

**B10 · fato sobre terceiros**
Você quer saber se o concorrente do seu cliente anunciou uma nova fábrica, e
onde, para contextualizar o diagnóstico.

### Gabarito: ✍️ REDAÇÃO

**R1 · síntese de material próprio**
O cliente mandou três atas de gemba, 40 páginas no total. Você precisa das cinco
dores recorrentes para a pauta de amanhã.

**R2 · adaptação de linguagem**
Seu diagnóstico técnico de 12 páginas precisa virar um comunicado de uma página
que o operador do turno da noite entenda.

**R3 · geração de ideias · ARMADILHA · ESSENCIAL**
Você precisa de 15 perguntas para uma entrevista de diagnóstico com líderes de
produção.
*Não há fato a verificar. É geração pura. Muita gente marca Busca por
insegurança.*

**R4 · síntese de material próprio**
Transformar suas anotações soltas do workshop de ontem em um relatório
estruturado.

**R5 · adaptação de linguagem**
Reescrever um e-mail difícil: comunicar ao patrocinador que o piloto vai
atrasar duas semanas, sem desgastar a relação.

**R6 · geração de ideias**
Gerar três versões de título para a apresentação do Lean Summit, com tons
diferentes.

**R7 · síntese de material próprio**
Você transcreveu uma entrevista de 50 minutos com o gerente de produção. Quer
os pontos de tensão que apareceram.

**R8 · adaptação de linguagem**
Traduzir para o inglês um resumo executivo que você mesmo escreveu, para a
matriz do cliente.

**R9 · geração de ideias**
Estruturar a agenda de um workshop de quatro horas de mapeamento de fluxo de
valor, com blocos e tempos.

**R10 · geração de ideias · ARMADILHA**
Você precisa de um checklist de auditoria 5S adaptado à realidade da linha do
cliente.
*Parece que existe um checklist oficial a buscar. O que você precisa é adaptação
a um contexto que só você conhece.*

### A pergunta relâmpago

Eixo próprio, e é ela que dá nome à dinâmica.

> **A IA te deu o dado que faltava — e veio com link para a fonte. Sua
> apresentação é em 20 minutos.**
>
> **Confio** · **Confiro**

Gabarito: **Confiro**. O script é explícito: *"se veio com link, abra o link"*.

Metade do público vê 10 segundos correndo. A outra metade não vê cronômetro
nenhum.

---

## Apêndice B — Riscos

**O A/B pode não mostrar diferença.** Com ~25 pessoas de cada lado, a diferença
entre os grupos pode não aparecer, ou aparecer invertida por acaso. O passo 4 do
debrief precisa funcionar nos dois casos. Se o grupo apressado for melhor ou
igual, a fala é: *"mesmo com pressão vocês seguraram — e é exatamente esse o
ponto: quando vira rotina, a pressa não decide por você."*

**Alguém contesta um gabarito ao vivo.** Cada questão carrega uma `explicacao`
ancorada numa frase do script. A tela da armadilha mostra essa explicação junto
com o gabarito. Se ainda assim a discordância for razoável, ela é a conversa —
não um problema a ser evitado.

**Público muito menor que o previsto.** Com 15 pessoas, as barras por questão
ficam pequenas. Mitigação: o painel permite sobrescrever o número de questões
ativas, e o piso é 6.

**Queda de conexão de um participante.** O token em `localStorage` retoma a
sessão de onde parou; as respostas já gravadas permanecem.

**Zoom atrasa a tela compartilhada.** O telão nunca depende de sincronia fina —
todos os avanços são no seu clique, e nada no telão é sensível a um atraso de
um ou dois segundos.
