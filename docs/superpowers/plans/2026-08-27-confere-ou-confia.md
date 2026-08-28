# Confere ou Confia? — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o quiz web de 50 participantes simultâneos para a dinâmica "Confere ou Confia?" da reunião técnica do LIB, com telão de resultados em tempo real projetado no Zoom.

**Architecture:** Servidor Fastify único servindo três telas estáticas (quiz, telão, painel), com SQLite para persistência e dois canais SSE separados — o do participante emite apenas a fase da rodada, o do painel emite os agregados. A separação dos canais é o que garante que o gabarito nunca chegue ao navegador de quem está respondendo.

**Tech Stack:** Node 22 (ESM), Fastify 5, better-sqlite3, SSE, HTML/CSS/JS sem build, `node:test`, Docker Compose + Caddy.

**Spec:** `docs/superpowers/specs/2026-08-27-confere-ou-confia-design.md`

## Global Constraints

- Node >= 22, módulos ESM (`"type": "module"`). Sem TypeScript, sem etapa de build.
- Todo texto de interface em **português do Brasil**.
- **Nenhum gabarito, explicação ou agregado pode chegar ao canal do participante enquanto a fase não for `revelado`.** Vale para respostas de API e para o payload SSE.
- A trava anti-repetição é uma **restrição de banco** (`PRIMARY KEY (participante_id, questao_id)` em `resposta`), nunca uma validação só de aplicação.
- Sem bloqueio ou identificação por IP em nenhum ponto.
- Fases da rodada, exatamente estas três: `espera`, `respondendo`, `revelado`.
- Gabaritos possíveis: `busca`, `redacao` (as 20 questões) e `confiro` (a relâmpago).
- Escolhas possíveis: `busca`, `redacao`, `confio`, `confiro`, `expirou`.
- Tema **único escuro** nas três telas. Paleta fixa abaixo, já validada — não substituir cores sem revalidar.
- Testes com `node:test` + `node:assert/strict`, executados por `npm test`.

### Paleta (fixa, validada)

Superfície escura `#1a1a19`. Validada com o script do skill dataviz em `--mode dark --pairs all`: separação CVD ΔE 26.8 e visão normal ΔE 31.8 entre acerto e erro.

```css
--plano:      #0d0d0d;   /* fundo da página */
--superficie: #1a1a19;   /* cartões e superfície de gráfico */
--tinta:      #ffffff;   /* texto primário */
--tinta-2:    #c3c2b7;   /* texto secundário */
--tinta-3:    #898781;   /* rótulos de eixo, texto discreto */
--grade:      #2c2c2a;   /* linhas de grade */
--acerto:     #3987e5;   /* azul */
--erro:       #d95926;   /* laranja */
--expirou:    #898781;   /* cinza neutro */
```

**Por que não verde e vermelho.** É a escolha intuitiva para acerto/erro e falha o gate de daltonismo: ΔE 4.1 em deuteranopia, bem abaixo do piso de 8. Com 50 pessoas na sala, haveria muito provavelmente alguém incapaz de ler o gráfico. Azul e laranja carregam a mesma informação e passam com folga.

`--expirou` é cinza de propósito: "não respondeu a tempo" deve ler como ausência, não como uma terceira identidade. O validador marca o piso de croma nele — é a exceção deliberada de um neutro, e todos os gates de separação e contraste passam.

**Regras de marca** (do skill dataviz, valem para todo gráfico deste projeto):
- Barras horizontais empilhadas, cantos de 4px só na ponta do dado, ancoradas na linha de base.
- Vão de 2px na cor da superfície entre segmentos empilhados e entre barras vizinhas.
- Legenda sempre presente (são 3 séries) **e** rótulos diretos nos segmentos com largura suficiente. A identidade nunca depende só da cor — importa porque o telão é projetado via Zoom e ninguém do público tem mouse para passar por cima.
- Sem camada de hover no telão (não há ponteiro do lado do espectador); os rótulos diretos compensam. O painel, esse sim, pode ter hover.
- Eixos e grade recessivos. Números grandes em `system-ui`, sem fonte de display.

---

## Estrutura de arquivos

```
package.json              deps e scripts
dados/questoes.json       banco versionado das 21 questões (20 + relâmpago)
src/
  db.js                   abertura, migração e semeadura do SQLite
  distribuicao.js         dimensionamento, seleção estratificada, rodízio, grupo A/B  [puro]
  respostas.js            registro, trava, validação do cronômetro
  agregados.js            cálculo dos números do telão
  rodada.js               ciclo de vida, entrada de participante, transições de fase
  sse.js                  canal de eventos reutilizável
  servidor.js             Fastify: rotas e montagem
  publico/
    comum.css             paleta e primitivos compartilhados
    quiz.html   quiz.js
    telao.html  telao.js  telao.css
    painel.html painel.js
testes/
  distribuicao.test.js  respostas.test.js  agregados.test.js
  rodada.test.js  integracao.test.js  carga.test.js
Dockerfile  docker-compose.yml  Caddyfile  .env.example
```

`distribuicao.js` é puro (sem banco) porque concentra a lógica com mais chance de erro sutil — precisa ser testável com dados montados à mão. `respostas.js` e `agregados.js` recebem a conexão como argumento, nunca a criam.

---

### Task 1: Fundação — projeto, esquema e banco de questões

**Files:**
- Create: `package.json`, `.gitignore` (já existe, revisar), `dados/questoes.json`, `src/db.js`
- Test: `testes/db.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `abrirBanco(caminho?) -> Database` — abre, migra e semeia. `semear(db, questoes)`. Tabelas `questao`, `rodada`, `rodada_questao`, `participante`, `atribuicao`, `resposta`.

- [ ] **Step 1: Inicializar o projeto e instalar dependências**

```bash
npm init -y
npm pkg set type=module engines.node=">=22"
npm pkg set scripts.start="node src/servidor.js" scripts.test="node --test testes/"
npm install fastify @fastify/static @fastify/cookie better-sqlite3
```

- [ ] **Step 2: Escrever `dados/questoes.json`**

Vinte questões mais a relâmpago. O campo `essencial` marca as que sempre entram na rodada.

```json
[
  { "id": "B1", "gabarito": "busca", "categoria": "dado estatistico", "essencial": true, "e_relampago": false,
    "texto": "Você está fechando a proposta para uma montadora e quer abrir com um dado de impacto: quanto o TPS reduziu o lead time nos primeiros anos da Toyota. A IA devolve um percentual redondo, com o nome do livro, o autor e o ano.",
    "explicacao": "Dado com citação é onde a alucinação chega mais convincente. É a cena de abertura do script: o estudo pode simplesmente não existir." },
  { "id": "B2", "gabarito": "busca", "categoria": "citacao e fonte", "essencial": false, "e_relampago": false,
    "texto": "Um cliente questionou sua afirmação sobre ganhos de produtividade em melhoria contínua e pediu a referência. Você quer o estudo que sustenta o número.",
    "explicacao": "Pedir a fonte é literalmente pedir uma fonte primária. Vá à publicação original." },
  { "id": "B3", "gabarito": "busca", "categoria": "norma ou prazo", "essencial": false, "e_relampago": false,
    "texto": "O cliente perguntou qual o prazo vigente para adequação a uma NR atualizada este ano. A resposta vai para o cronograma do projeto.",
    "explicacao": "Prazo legal muda com o tempo e vai para a mão do cliente. Site oficial." },
  { "id": "B4", "gabarito": "busca", "categoria": "fato sobre terceiros", "essencial": false, "e_relampago": false,
    "texto": "Você quer citar no material que determinada empresa brasileira implantou hoshin kanri, e em que ano, como caso de referência do setor.",
    "explicacao": "Afirmação sobre um terceiro, com ano. Fácil de compor de um jeito plausível." },
  { "id": "B5", "gabarito": "busca", "categoria": "citacao e fonte", "essencial": true, "e_relampago": false,
    "texto": "Você quer resumir para a equipe um artigo da Harvard Business Review sobre gestão visual. Você tem o título e o autor, mas não tem o PDF.",
    "explicacao": "Armadilha: parece resumir. Mas ela não leu o artigo — vai redigir um resumo plausível de algo que não viu. Consiga o texto primeiro; aí sim resumir é redação." },
  { "id": "B6", "gabarito": "busca", "categoria": "dado que muda", "essencial": false, "e_relampago": false,
    "texto": "Você precisa do número atual de unidades da rede do cliente no Brasil para dimensionar o piloto.",
    "explicacao": "Dado que muda o tempo todo. Qualquer número que ela devolva está desatualizado por construção." },
  { "id": "B7", "gabarito": "busca", "categoria": "citacao e fonte", "essencial": false, "e_relampago": false,
    "texto": "Você quer a definição exata de muda, mura e muri como aparece no material original, entre aspas, para um slide.",
    "explicacao": "Citação entre aspas é transcrição, não paráfrase. Só a fonte original serve." },
  { "id": "B8", "gabarito": "busca", "categoria": "citacao e fonte", "essencial": false, "e_relampago": false,
    "texto": "Você pede à IA para comparar as abordagens de TPM de três autores de referência. Ela devolve um quadro comparativo bem organizado, com nomes e livros.",
    "explicacao": "Armadilha: comparar é redação, mas atribuir posições a autores nomeados é fato. O formato de quadro passa uma autoridade que o conteúdo pode não ter." },
  { "id": "B9", "gabarito": "busca", "categoria": "norma ou prazo", "essencial": false, "e_relampago": false,
    "texto": "O teto atual de um incentivo fiscal que o cliente quer usar no business case.",
    "explicacao": "Número oficial que muda por decreto. Fonte oficial, sempre." },
  { "id": "B10", "gabarito": "busca", "categoria": "fato sobre terceiros", "essencial": false, "e_relampago": false,
    "texto": "Você quer saber se o concorrente do seu cliente anunciou uma nova fábrica, e onde, para contextualizar o diagnóstico.",
    "explicacao": "Notícia recente sobre terceiro. Se a IA não pesquisou na web, ela está prevendo palavras, não informando." },

  { "id": "R1", "gabarito": "redacao", "categoria": "sintese de material proprio", "essencial": false, "e_relampago": false,
    "texto": "O cliente mandou três atas de gemba, 40 páginas no total. Você precisa das cinco dores recorrentes para a pauta de amanhã.",
    "explicacao": "O conteúdo é seu. Ela não precisa inventar nada, só reorganizar o que você deu. Risco baixo, ganho alto." },
  { "id": "R2", "gabarito": "redacao", "categoria": "adaptacao de linguagem", "essencial": false, "e_relampago": false,
    "texto": "Seu diagnóstico técnico de 12 páginas precisa virar um comunicado de uma página que o operador do turno da noite entenda.",
    "explicacao": "Adaptação de linguagem sobre material próprio. É exatamente onde ela economiza horas." },
  { "id": "R3", "gabarito": "redacao", "categoria": "geracao de ideias", "essencial": true, "e_relampago": false,
    "texto": "Você precisa de 15 perguntas para uma entrevista de diagnóstico com líderes de produção.",
    "explicacao": "Armadilha ao contrário: não há fato a verificar. É geração pura. Muita gente marca busca por insegurança." },
  { "id": "R4", "gabarito": "redacao", "categoria": "sintese de material proprio", "essencial": false, "e_relampago": false,
    "texto": "Transformar suas anotações soltas do workshop de ontem em um relatório estruturado.",
    "explicacao": "Material próprio, estruturação. Confira se ela não acrescentou nada que você não escreveu." },
  { "id": "R5", "gabarito": "redacao", "categoria": "adaptacao de linguagem", "essencial": false, "e_relampago": false,
    "texto": "Reescrever um e-mail difícil: comunicar ao patrocinador que o piloto vai atrasar duas semanas, sem desgastar a relação.",
    "explicacao": "O e-mail difícil de escrever é o caso clássico do script. Nenhum fato externo em jogo." },
  { "id": "R6", "gabarito": "redacao", "categoria": "geracao de ideias", "essencial": false, "e_relampago": false,
    "texto": "Gerar três versões de título para a apresentação do Lean Summit, com tons diferentes.",
    "explicacao": "Primeira versão, alternativas, tom. Nada a verificar." },
  { "id": "R7", "gabarito": "redacao", "categoria": "sintese de material proprio", "essencial": false, "e_relampago": false,
    "texto": "Você transcreveu uma entrevista de 50 minutos com o gerente de produção. Quer os pontos de tensão que apareceram.",
    "explicacao": "A transcrição é sua. Ela trabalha em cima do que você entregou." },
  { "id": "R8", "gabarito": "redacao", "categoria": "adaptacao de linguagem", "essencial": false, "e_relampago": false,
    "texto": "Traduzir para o inglês um resumo executivo que você mesmo escreveu, para a matriz do cliente.",
    "explicacao": "Tradução de material próprio. Redação no sentido mais direto." },
  { "id": "R9", "gabarito": "redacao", "categoria": "geracao de ideias", "essencial": false, "e_relampago": false,
    "texto": "Estruturar a agenda de um workshop de quatro horas de mapeamento de fluxo de valor, com blocos e tempos.",
    "explicacao": "Estruturação a partir da sua expertise. Não existe uma agenda oficial a ser localizada." },
  { "id": "R10", "gabarito": "redacao", "categoria": "geracao de ideias", "essencial": false, "e_relampago": false,
    "texto": "Você precisa de um checklist de auditoria 5S adaptado à realidade da linha do cliente.",
    "explicacao": "Armadilha: parece existir um checklist oficial a buscar. O que você precisa é adaptação a um contexto que só você conhece." },

  { "id": "REL", "gabarito": "confiro", "categoria": "relampago", "essencial": false, "e_relampago": true,
    "texto": "A IA te deu o dado que faltava — e veio com link para a fonte. Sua apresentação é em 20 minutos.",
    "explicacao": "O script é explícito: se veio com link, abra o link. Trinta segundos separam as duas histórias possíveis." }
]
```

- [ ] **Step 3: Escrever o teste do banco**

```js
// testes/db.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'

test('cria o esquema e semeia as 21 questões', () => {
  const db = abrirBanco(':memory:')
  const total = db.prepare('SELECT COUNT(*) c FROM questao').get().c
  assert.equal(total, 21)
})

test('o banco tem 10 questões de busca e 10 de redação, fora a relâmpago', () => {
  const db = abrirBanco(':memory:')
  const linhas = db.prepare(
    'SELECT gabarito, COUNT(*) c FROM questao WHERE e_relampago = 0 GROUP BY gabarito'
  ).all()
  const porGabarito = Object.fromEntries(linhas.map(l => [l.gabarito, l.c]))
  assert.deepEqual(porGabarito, { busca: 10, redacao: 10 })
})

test('existe exatamente uma questão relâmpago, com gabarito confiro', () => {
  const db = abrirBanco(':memory:')
  const rel = db.prepare('SELECT * FROM questao WHERE e_relampago = 1').all()
  assert.equal(rel.length, 1)
  assert.equal(rel[0].gabarito, 'confiro')
})

test('as essenciais cabem na menor rodada possível (3 por gabarito)', () => {
  const db = abrirBanco(':memory:')
  const linhas = db.prepare(
    'SELECT gabarito, COUNT(*) c FROM questao WHERE essencial = 1 GROUP BY gabarito'
  ).all()
  for (const l of linhas) assert.ok(l.c <= 3, `${l.gabarito} tem ${l.c} essenciais, o piso comporta 3`)
})

test('semear duas vezes não duplica questões', () => {
  const db = abrirBanco(':memory:')
  const antes = db.prepare('SELECT COUNT(*) c FROM questao').get().c
  db.exec('SELECT 1')
  const depois = abrirBanco(':memory:').prepare('SELECT COUNT(*) c FROM questao').get().c
  assert.equal(antes, depois)
})

test('a trava impede duas respostas para a mesma questão do mesmo participante', () => {
  const db = abrirBanco(':memory:')
  db.prepare(`INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas)
              VALUES ('2026-08-27', 10, 6)`).run()
  db.prepare(`INSERT INTO participante (rodada_id, token, rotulo, ordem_chegada, grupo_relampago, criado_em)
              VALUES (1, 'tok', 'Participante #1', 1, 'controle', '2026-08-27')`).run()
  const inserir = db.prepare(`INSERT INTO resposta
    (participante_id, questao_id, escolha, correta, ms_para_responder, respondido_em)
    VALUES (1, 'B1', ?, ?, 100, '2026-08-27')`)
  inserir.run('busca', 1)
  assert.throws(() => inserir.run('redacao', 0), /UNIQUE|constraint/i)
})
```

- [ ] **Step 4: Rodar os testes para confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 5: Implementar `src/db.js`**

```js
// src/db.js
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CAMINHO_QUESTOES = path.join(RAIZ, 'dados', 'questoes.json')

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS questao (
  id           TEXT PRIMARY KEY,
  texto        TEXT NOT NULL,
  categoria    TEXT NOT NULL,
  gabarito     TEXT NOT NULL CHECK (gabarito IN ('busca','redacao','confiro')),
  explicacao   TEXT NOT NULL,
  essencial    INTEGER NOT NULL DEFAULT 0,
  e_relampago  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rodada (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  criada_em              TEXT NOT NULL,
  previsao_participantes INTEGER NOT NULL,
  num_questoes_ativas    INTEGER NOT NULL,
  fase                   TEXT NOT NULL DEFAULT 'espera'
                         CHECK (fase IN ('espera','respondendo','revelado')),
  entradas_abertas       INTEGER NOT NULL DEFAULT 1,
  segundos_relampago     INTEGER NOT NULL DEFAULT 10,
  passo_debrief          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rodada_questao (
  rodada_id  INTEGER NOT NULL REFERENCES rodada(id) ON DELETE CASCADE,
  questao_id TEXT    NOT NULL REFERENCES questao(id),
  PRIMARY KEY (rodada_id, questao_id)
);

CREATE TABLE IF NOT EXISTS participante (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rodada_id       INTEGER NOT NULL REFERENCES rodada(id) ON DELETE CASCADE,
  token           TEXT NOT NULL,
  rotulo          TEXT NOT NULL,
  ordem_chegada   INTEGER NOT NULL,
  grupo_relampago TEXT NOT NULL CHECK (grupo_relampago IN ('cronometro','controle')),
  criado_em       TEXT NOT NULL,
  finalizado_em   TEXT,
  UNIQUE (rodada_id, token)
);

CREATE TABLE IF NOT EXISTS atribuicao (
  participante_id INTEGER NOT NULL REFERENCES participante(id) ON DELETE CASCADE,
  questao_id      TEXT    NOT NULL REFERENCES questao(id),
  posicao         INTEGER NOT NULL,
  entregue_em     TEXT,
  PRIMARY KEY (participante_id, posicao),
  UNIQUE (participante_id, questao_id)
);

CREATE TABLE IF NOT EXISTS resposta (
  participante_id   INTEGER NOT NULL REFERENCES participante(id) ON DELETE CASCADE,
  questao_id        TEXT    NOT NULL REFERENCES questao(id),
  escolha           TEXT    NOT NULL
                    CHECK (escolha IN ('busca','redacao','confio','confiro','expirou')),
  correta           INTEGER NOT NULL,
  ms_para_responder INTEGER,
  respondido_em     TEXT NOT NULL,
  PRIMARY KEY (participante_id, questao_id)
);

CREATE INDEX IF NOT EXISTS idx_participante_rodada ON participante(rodada_id);
CREATE INDEX IF NOT EXISTS idx_resposta_questao   ON resposta(questao_id);
`

export function semear (db, questoes) {
  const inserir = db.prepare(`
    INSERT INTO questao (id, texto, categoria, gabarito, explicacao, essencial, e_relampago)
    VALUES (@id, @texto, @categoria, @gabarito, @explicacao, @essencial, @e_relampago)
    ON CONFLICT(id) DO UPDATE SET
      texto = excluded.texto, categoria = excluded.categoria,
      gabarito = excluded.gabarito, explicacao = excluded.explicacao,
      essencial = excluded.essencial, e_relampago = excluded.e_relampago
  `)
  const emLote = db.transaction(lista => {
    for (const q of lista) {
      inserir.run({ ...q, essencial: q.essencial ? 1 : 0, e_relampago: q.e_relampago ? 1 : 0 })
    }
  })
  emLote(questoes)
}

export function abrirBanco (caminho = process.env.DB_PATH || path.join(RAIZ, 'dados', 'confere.sqlite')) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true })
  const db = new Database(caminho)
  if (caminho !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(ESQUEMA)
  semear(db, JSON.parse(fs.readFileSync(CAMINHO_QUESTOES, 'utf8')))
  return db
}
```

- [ ] **Step 6: Rodar os testes para confirmar que passam**

Run: `npm test`
Expected: PASS — 6 testes

- [ ] **Step 7: Commit**

```bash
rtk git add package.json package-lock.json .gitignore dados/questoes.json src/db.js testes/db.test.js
rtk git commit -m "feat: esquema do banco e banco de 21 questões"
```

---

### Task 2: Dimensionamento e seleção estratificada

**Files:**
- Create: `src/distribuicao.js`
- Test: `testes/distribuicao.test.js`

**Interfaces:**
- Consumes: nada (módulo puro, recebe as questões como array de objetos com `{ id, gabarito, categoria, essencial, e_relampago }`).
- Produces:
  - `calcularQuestoesAtivas(previsaoParticipantes: number) -> number` — sempre par, entre 6 e 14.
  - `selecionarQuestoesAtivas(questoes: Questao[], k: number, aleatorio?: () => number) -> Questao[]` — exatamente `k`, metade de cada gabarito.
  - `embaralhar(lista, aleatorio?) -> novaLista`

- [ ] **Step 1: Escrever os testes que falham**

```js
// testes/distribuicao.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularQuestoesAtivas, selecionarQuestoesAtivas } from '../src/distribuicao.js'
import { abrirBanco } from '../src/db.js'

const banco = () => abrirBanco(':memory:').prepare('SELECT * FROM questao').all()

test('dimensionamento bate com a tabela da spec', () => {
  assert.equal(calcularQuestoesAtivas(20), 6)
  assert.equal(calcularQuestoesAtivas(30), 8)
  assert.equal(calcularQuestoesAtivas(45), 10)
  assert.equal(calcularQuestoesAtivas(50), 12)
})

test('dimensionamento respeita o piso de 6 e o teto de 14', () => {
  assert.equal(calcularQuestoesAtivas(1), 6)
  assert.equal(calcularQuestoesAtivas(5), 6)
  assert.equal(calcularQuestoesAtivas(200), 14)
})

test('dimensionamento sempre devolve número par', () => {
  for (let p = 1; p <= 120; p++) {
    assert.equal(calcularQuestoesAtivas(p) % 2, 0, `previsão ${p} devolveu ímpar`)
  }
})

test('a seleção devolve k questões, metade de cada gabarito', () => {
  for (const k of [6, 8, 10, 12, 14]) {
    const sel = selecionarQuestoesAtivas(banco(), k)
    assert.equal(sel.length, k)
    assert.equal(sel.filter(q => q.gabarito === 'busca').length, k / 2)
    assert.equal(sel.filter(q => q.gabarito === 'redacao').length, k / 2)
  }
})

test('a seleção nunca inclui a questão relâmpago', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(!selecionarQuestoesAtivas(banco(), 6).some(q => q.e_relampago))
  }
})

test('a seleção sempre inclui todas as essenciais', () => {
  const essenciais = banco().filter(q => q.essencial && !q.e_relampago).map(q => q.id)
  for (let i = 0; i < 50; i++) {
    const ids = selecionarQuestoesAtivas(banco(), 6).map(q => q.id)
    for (const e of essenciais) assert.ok(ids.includes(e), `faltou a essencial ${e}`)
  }
})

test('a seleção varia categorias antes de repetir uma já representada', () => {
  // O lado busca tem 4 categorias distintas; com k/2 = 5 nenhuma categoria
  // deve aparecer 3 vezes enquanto houver categoria não representada.
  for (let i = 0; i < 50; i++) {
    const lado = selecionarQuestoesAtivas(banco(), 10).filter(q => q.gabarito === 'busca')
    const cats = new Set(lado.map(q => q.categoria))
    assert.equal(cats.size, 4, 'as 4 categorias de busca deveriam estar representadas')
  }
})

test('a seleção rejeita k ímpar', () => {
  assert.throws(() => selecionarQuestoesAtivas(banco(), 7), /par/)
})

test('a seleção rejeita banco insuficiente', () => {
  const poucas = banco().filter(q => q.gabarito === 'busca').slice(0, 2)
  assert.throws(() => selecionarQuestoesAtivas(poucas, 6), /insuficiente/)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test -- --test-name-pattern=dimensionamento`
Expected: FAIL — `Cannot find module '../src/distribuicao.js'`

- [ ] **Step 3: Implementar `src/distribuicao.js`**

```js
// src/distribuicao.js
const ALVO_RESPOSTAS_POR_QUESTAO = 18
const MINIMO_ATIVAS = 6
const MAXIMO_ATIVAS = 14
const QUESTOES_POR_PARTICIPANTE = 4

export function embaralhar (lista, aleatorio = Math.random) {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

export function calcularQuestoesAtivas (previsaoParticipantes) {
  const decisoes = previsaoParticipantes * QUESTOES_POR_PARTICIPANTE
  let k = Math.round(decisoes / ALVO_RESPOSTAS_POR_QUESTAO)
  if (k % 2 !== 0) k += 1
  return Math.min(MAXIMO_ATIVAS, Math.max(MINIMO_ATIVAS, k))
}

function completarLado (disponiveis, metade, aleatorio) {
  const essenciais = disponiveis.filter(q => q.essencial)
  if (essenciais.length > metade) {
    throw new Error(`há ${essenciais.length} essenciais para ${metade} vagas`)
  }
  const lado = [...essenciais]
  const resto = embaralhar(disponiveis.filter(q => !q.essencial), aleatorio)
  const categorias = new Set(lado.map(q => q.categoria))

  // Primeiro passe: cobre categorias ainda não representadas.
  for (const q of resto) {
    if (lado.length === metade) break
    if (!categorias.has(q.categoria)) { lado.push(q); categorias.add(q.categoria) }
  }
  // Segundo passe: completa com o que sobrou.
  const jaEscolhidas = new Set(lado.map(q => q.id))
  for (const q of resto) {
    if (lado.length === metade) break
    if (!jaEscolhidas.has(q.id)) { lado.push(q); jaEscolhidas.add(q.id) }
  }
  if (lado.length < metade) {
    throw new Error(`banco insuficiente: ${lado.length} de ${metade} vagas preenchidas`)
  }
  return lado
}

export function selecionarQuestoesAtivas (questoes, k, aleatorio = Math.random) {
  if (k % 2 !== 0) throw new Error('o número de questões ativas deve ser par')
  const metade = k / 2
  const elegiveis = questoes.filter(q => !q.e_relampago)
  const escolhidas = []
  for (const gabarito of ['busca', 'redacao']) {
    escolhidas.push(...completarLado(elegiveis.filter(q => q.gabarito === gabarito), metade, aleatorio))
  }
  return escolhidas
}
```

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS — os 9 testes de distribuição e os 6 do banco

- [ ] **Step 5: Commit**

```bash
rtk git add src/distribuicao.js testes/distribuicao.test.js
rtk git commit -m "feat: dimensionamento pela previsão e seleção estratificada"
```

---

### Task 3: Rodízio de questões e grupo A/B

**Files:**
- Modify: `src/distribuicao.js`
- Test: `testes/distribuicao.test.js`

**Interfaces:**
- Consumes: `embaralhar` da Task 2.
- Produces:
  - `sortearAtribuicao(questoesAtivas: Questao[], contagens: Record<string, number>, aleatorio?) -> Questao[]` — 4 questões, 2 de cada gabarito, já embaralhadas.
  - `grupoPorOrdemChegada(ordemChegada: number) -> 'cronometro' | 'controle'` — a ordem começa em 1.

- [ ] **Step 1: Escrever os testes que falham**

```js
// acrescentar a testes/distribuicao.test.js
import { sortearAtribuicao, grupoPorOrdemChegada } from '../src/distribuicao.js'

test('cada participante recebe 4 questões, 2 de cada gabarito', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 10)
  for (let i = 0; i < 50; i++) {
    const a = sortearAtribuicao(ativas, {})
    assert.equal(a.length, 4)
    assert.equal(a.filter(q => q.gabarito === 'busca').length, 2)
    assert.equal(a.filter(q => q.gabarito === 'redacao').length, 2)
  }
})

test('o participante nunca recebe a mesma questão duas vezes', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6)
  for (let i = 0; i < 100; i++) {
    const ids = sortearAtribuicao(ativas, {}).map(q => q.id)
    assert.equal(new Set(ids).size, 4)
  }
})

test('com 50 participantes o rodízio mantém a diferença de uso em no máximo 1', () => {
  for (const k of [6, 10, 14]) {
    const ativas = selecionarQuestoesAtivas(banco(), k)
    const contagens = Object.fromEntries(ativas.map(q => [q.id, 0]))
    for (let p = 0; p < 50; p++) {
      for (const q of sortearAtribuicao(ativas, contagens)) contagens[q.id]++
    }
    // O equilíbrio vale dentro de cada gabarito: os lados têm demandas iguais.
    for (const gabarito of ['busca', 'redacao']) {
      const usos = ativas.filter(q => q.gabarito === gabarito).map(q => contagens[q.id])
      assert.ok(Math.max(...usos) - Math.min(...usos) <= 1,
        `k=${k} ${gabarito}: usos ${usos.join(',')}`)
    }
  }
})

test('a ordem das 4 questões varia entre participantes', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6)
  const ordens = new Set()
  for (let i = 0; i < 60; i++) ordens.add(sortearAtribuicao(ativas, {}).map(q => q.id).join('-'))
  assert.ok(ordens.size > 1, 'a ordem deveria variar entre participantes')
})

test('sortearAtribuicao rejeita rodada com menos de 2 questões de um gabarito', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6).filter(q => q.gabarito === 'busca')
  assert.throws(() => sortearAtribuicao(ativas, {}), /insuficientes/)
})

test('o grupo A/B alterna por ordem de chegada e fecha 50/50 em 50 pessoas', () => {
  assert.equal(grupoPorOrdemChegada(1), 'controle')
  assert.equal(grupoPorOrdemChegada(2), 'cronometro')
  const grupos = Array.from({ length: 50 }, (_, i) => grupoPorOrdemChegada(i + 1))
  const comCronometro = grupos.filter(g => g === 'cronometro').length
  assert.equal(comCronometro, 25)
})

test('o grupo A/B fica em 50/50 com folga de 1 em público ímpar', () => {
  const grupos = Array.from({ length: 47 }, (_, i) => grupoPorOrdemChegada(i + 1))
  const comCronometro = grupos.filter(g => g === 'cronometro').length
  assert.ok(Math.abs(comCronometro - (47 - comCronometro)) <= 1)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `sortearAtribuicao is not a function`

- [ ] **Step 3: Implementar no `src/distribuicao.js`**

```js
// acrescentar a src/distribuicao.js
const POR_GABARITO_NA_ATRIBUICAO = 2

export function sortearAtribuicao (questoesAtivas, contagens, aleatorio = Math.random) {
  const escolhidas = []
  for (const gabarito of ['busca', 'redacao']) {
    const candidatas = questoesAtivas.filter(q => q.gabarito === gabarito)
    if (candidatas.length < POR_GABARITO_NA_ATRIBUICAO) {
      throw new Error(`questões ativas insuficientes de ${gabarito}: ${candidatas.length}`)
    }
    // Embaralha antes de ordenar: como o sort de V8 é estável, o embaralhamento
    // vira o critério de desempate entre questões com a mesma contagem de uso.
    const porMenosUsada = embaralhar(candidatas, aleatorio)
      .sort((a, b) => (contagens[a.id] ?? 0) - (contagens[b.id] ?? 0))
    escolhidas.push(...porMenosUsada.slice(0, POR_GABARITO_NA_ATRIBUICAO))
  }
  return embaralhar(escolhidas, aleatorio)
}

export function grupoPorOrdemChegada (ordemChegada) {
  return ordemChegada % 2 === 0 ? 'cronometro' : 'controle'
}
```

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/distribuicao.js testes/distribuicao.test.js
rtk git commit -m "feat: rodízio equilibrado de questões e divisão A/B do relâmpago"
```

---

### Task 4: Ciclo de vida da rodada e entrada de participante

**Files:**
- Create: `src/rodada.js`
- Test: `testes/rodada.test.js`

**Interfaces:**
- Consumes: `abrirBanco` (Task 1); `calcularQuestoesAtivas`, `selecionarQuestoesAtivas`, `sortearAtribuicao`, `grupoPorOrdemChegada` (Tasks 2-3).
- Produces:
  - `criarRodada(db, { previsaoParticipantes, numQuestoesAtivas?, segundosRelampago?, aleatorio? }) -> rodada`
  - `rodadaAtual(db) -> rodada | undefined`
  - `entrarParticipante(db, rodadaId, token, aleatorio?) -> { participante, novo: boolean }`
  - `questoesDoParticipante(db, participanteId) -> [{ id, texto, posicao, eRelampago, comCronometro }]` — **nunca** devolve `gabarito` nem `explicacao`
  - `marcarEntregue(db, participanteId, questaoId, agora?)`
  - `definirFase(db, rodadaId, fase)`, `definirEntradas(db, rodadaId, abertas)`, `definirPassoDebrief(db, rodadaId, passo)`
  - `zerarRodada(db, rodadaId)`

- [ ] **Step 1: Escrever os testes que falham**

```js
// testes/rodada.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import {
  criarRodada, rodadaAtual, entrarParticipante, questoesDoParticipante,
  marcarEntregue, definirFase, definirEntradas, zerarRodada
} from '../src/rodada.js'

function cenario (previsao = 45) {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: previsao })
  definirFase(db, rodada.id, 'respondendo')
  return { db, rodada }
}

test('criar rodada dimensiona pela previsão e registra as questões em jogo', () => {
  const { db, rodada } = cenario(45)
  assert.equal(rodada.num_questoes_ativas, 10)
  const emJogo = db.prepare('SELECT COUNT(*) c FROM rodada_questao WHERE rodada_id = ?').get(rodada.id).c
  assert.equal(emJogo, 11, 'as 10 ativas mais a relâmpago')
})

test('criar rodada aceita sobrescrever o número de questões ativas', () => {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 45, numQuestoesAtivas: 6 })
  assert.equal(rodada.num_questoes_ativas, 6)
})

test('rodadaAtual devolve a rodada mais recente', () => {
  const db = abrirBanco(':memory:')
  criarRodada(db, { previsaoParticipantes: 20 })
  const segunda = criarRodada(db, { previsaoParticipantes: 40 })
  assert.equal(rodadaAtual(db).id, segunda.id)
})

test('entrar cria o participante com 4 questões mais a relâmpago na posição 5', () => {
  const { db, rodada } = cenario()
  const { participante, novo } = entrarParticipante(db, rodada.id, 'tok-a')
  assert.equal(novo, true)
  assert.equal(participante.rotulo, 'Participante #1')
  const qs = questoesDoParticipante(db, participante.id)
  assert.equal(qs.length, 5)
  assert.deepEqual(qs.map(q => q.posicao), [1, 2, 3, 4, 5])
  assert.equal(qs.filter(q => q.eRelampago).length, 1)
  assert.equal(qs[4].eRelampago, true)
})

test('as 4 primeiras questões nunca incluem a relâmpago', () => {
  const { db, rodada } = cenario()
  for (let i = 0; i < 20; i++) {
    const { participante } = entrarParticipante(db, rodada.id, `tok-${i}`)
    const quatro = questoesDoParticipante(db, participante.id).slice(0, 4)
    assert.ok(!quatro.some(q => q.eRelampago))
  }
})

test('entrar com o mesmo token retoma a sessão sem duplicar nem re-sortear', () => {
  const { db, rodada } = cenario()
  const primeira = entrarParticipante(db, rodada.id, 'tok-a')
  const idsAntes = questoesDoParticipante(db, primeira.participante.id).map(q => q.id)

  const segunda = entrarParticipante(db, rodada.id, 'tok-a')
  assert.equal(segunda.novo, false)
  assert.equal(segunda.participante.id, primeira.participante.id)
  assert.deepEqual(questoesDoParticipante(db, segunda.participante.id).map(q => q.id), idsAntes)

  const total = db.prepare('SELECT COUNT(*) c FROM participante WHERE rodada_id = ?').get(rodada.id).c
  assert.equal(total, 1)
})

test('as questões entregues ao participante não carregam gabarito nem explicação', () => {
  const { db, rodada } = cenario()
  const { participante } = entrarParticipante(db, rodada.id, 'tok-a')
  const qs = questoesDoParticipante(db, participante.id)
  const serializado = JSON.stringify(qs)
  for (const q of qs) {
    assert.equal('gabarito' in q, false)
    assert.equal('explicacao' in q, false)
  }
  const explicacoes = db.prepare('SELECT explicacao FROM questao').all().map(r => r.explicacao)
  for (const e of explicacoes) assert.ok(!serializado.includes(e))
})

test('o grupo do relâmpago alterna e só o grupo cronometro recebe a marca', () => {
  const { db, rodada } = cenario()
  const a = entrarParticipante(db, rodada.id, 'tok-1').participante
  const b = entrarParticipante(db, rodada.id, 'tok-2').participante
  assert.equal(a.grupo_relampago, 'controle')
  assert.equal(b.grupo_relampago, 'cronometro')
  assert.equal(questoesDoParticipante(db, a.id)[4].comCronometro, false)
  assert.equal(questoesDoParticipante(db, b.id)[4].comCronometro, true)
})

test('com as entradas fechadas ninguém novo entra, mas quem já entrou retoma', () => {
  const { db, rodada } = cenario()
  const existente = entrarParticipante(db, rodada.id, 'tok-a').participante
  definirEntradas(db, rodada.id, false)
  assert.throws(() => entrarParticipante(db, rodada.id, 'tok-novo'), /entradas fechadas/)
  assert.equal(entrarParticipante(db, rodada.id, 'tok-a').participante.id, existente.id)
})

test('50 entradas mantêm o rodízio equilibrado dentro de cada gabarito', () => {
  const { db, rodada } = cenario(45)
  for (let i = 0; i < 50; i++) entrarParticipante(db, rodada.id, `tok-${i}`)
  const usos = db.prepare(`
    SELECT q.gabarito, a.questao_id, COUNT(*) c
    FROM atribuicao a JOIN questao q ON q.id = a.questao_id
    WHERE q.e_relampago = 0 GROUP BY a.questao_id
  `).all()
  for (const gabarito of ['busca', 'redacao']) {
    const c = usos.filter(u => u.gabarito === gabarito).map(u => u.c)
    assert.ok(Math.max(...c) - Math.min(...c) <= 1, `${gabarito}: ${c.join(',')}`)
  }
})

test('marcarEntregue carimba uma vez só e não reinicia o cronômetro', () => {
  const { db, rodada } = cenario()
  const { participante } = entrarParticipante(db, rodada.id, 'tok-a')
  const rel = questoesDoParticipante(db, participante.id)[4]
  marcarEntregue(db, participante.id, rel.id, new Date('2026-08-27T10:00:00Z'))
  marcarEntregue(db, participante.id, rel.id, new Date('2026-08-27T10:05:00Z'))
  const linha = db.prepare('SELECT entregue_em FROM atribuicao WHERE participante_id = ? AND questao_id = ?')
    .get(participante.id, rel.id)
  assert.equal(linha.entregue_em, '2026-08-27T10:00:00.000Z')
})

test('definirFase recusa fase desconhecida', () => {
  const { db, rodada } = cenario()
  assert.throws(() => definirFase(db, rodada.id, 'encerrado'), /fase inválida/)
})

test('zerar apaga participantes e respostas e volta a fase para espera', () => {
  const { db, rodada } = cenario()
  entrarParticipante(db, rodada.id, 'tok-a')
  zerarRodada(db, rodada.id)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participante').get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 0)
  const depois = rodadaAtual(db)
  assert.equal(depois.fase, 'espera')
  assert.equal(depois.entradas_abertas, 1)
  assert.equal(depois.passo_debrief, 0)
  assert.equal(
    db.prepare('SELECT COUNT(*) c FROM rodada_questao WHERE rodada_id = ?').get(rodada.id).c,
    11, 'as questões em jogo continuam as mesmas'
  )
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/rodada.js'`

- [ ] **Step 3: Implementar `src/rodada.js`**

```js
// src/rodada.js
import {
  calcularQuestoesAtivas, selecionarQuestoesAtivas,
  sortearAtribuicao, grupoPorOrdemChegada
} from './distribuicao.js'

const FASES = ['espera', 'respondendo', 'revelado']
const QUESTOES_POR_PARTICIPANTE = 4

export function criarRodada (db, {
  previsaoParticipantes,
  numQuestoesAtivas,
  segundosRelampago = 10,
  aleatorio = Math.random
}) {
  const k = numQuestoesAtivas ?? calcularQuestoesAtivas(previsaoParticipantes)
  const questoes = db.prepare('SELECT * FROM questao').all()
  const ativas = selecionarQuestoesAtivas(questoes, k, aleatorio)
  const relampago = questoes.find(q => q.e_relampago)
  if (!relampago) throw new Error('o banco de questões não tem uma questão relâmpago')

  return db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas, segundos_relampago)
      VALUES (?, ?, ?, ?)
    `).run(new Date().toISOString(), previsaoParticipantes, k, segundosRelampago)
    const inserir = db.prepare('INSERT INTO rodada_questao (rodada_id, questao_id) VALUES (?, ?)')
    for (const q of [...ativas, relampago]) inserir.run(info.lastInsertRowid, q.id)
    return db.prepare('SELECT * FROM rodada WHERE id = ?').get(info.lastInsertRowid)
  })()
}

export function rodadaAtual (db) {
  return db.prepare('SELECT * FROM rodada ORDER BY id DESC LIMIT 1').get()
}

function questoesEmJogo (db, rodadaId) {
  return db.prepare(`
    SELECT q.* FROM rodada_questao rq JOIN questao q ON q.id = rq.questao_id
    WHERE rq.rodada_id = ?
  `).all(rodadaId)
}

export function entrarParticipante (db, rodadaId, token, aleatorio = Math.random) {
  return db.transaction(() => {
    const existente = db.prepare('SELECT * FROM participante WHERE rodada_id = ? AND token = ?')
      .get(rodadaId, token)
    if (existente) return { participante: existente, novo: false }

    const rodada = db.prepare('SELECT * FROM rodada WHERE id = ?').get(rodadaId)
    if (!rodada) throw new Error('rodada inexistente')
    if (!rodada.entradas_abertas) throw new Error('entradas fechadas')

    const emJogo = questoesEmJogo(db, rodadaId)
    const ativas = emJogo.filter(q => !q.e_relampago)
    const relampago = emJogo.find(q => q.e_relampago)

    const ordem = db.prepare('SELECT COUNT(*) c FROM participante WHERE rodada_id = ?')
      .get(rodadaId).c + 1

    const info = db.prepare(`
      INSERT INTO participante (rodada_id, token, rotulo, ordem_chegada, grupo_relampago, criado_em)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rodadaId, token, `Participante #${ordem}`, ordem,
      grupoPorOrdemChegada(ordem), new Date().toISOString())
    const participanteId = info.lastInsertRowid

    const contagens = Object.fromEntries(
      db.prepare(`
        SELECT a.questao_id id, COUNT(*) c FROM atribuicao a
        JOIN participante p ON p.id = a.participante_id
        WHERE p.rodada_id = ? GROUP BY a.questao_id
      `).all(rodadaId).map(l => [l.id, l.c])
    )

    const sorteadas = sortearAtribuicao(ativas, contagens, aleatorio)
    const inserir = db.prepare(
      'INSERT INTO atribuicao (participante_id, questao_id, posicao) VALUES (?, ?, ?)'
    )
    sorteadas.forEach((q, i) => inserir.run(participanteId, q.id, i + 1))
    inserir.run(participanteId, relampago.id, QUESTOES_POR_PARTICIPANTE + 1)

    return {
      participante: db.prepare('SELECT * FROM participante WHERE id = ?').get(participanteId),
      novo: true
    }
  })()
}

export function questoesDoParticipante (db, participanteId) {
  return db.prepare(`
    SELECT q.id, q.texto, a.posicao, q.e_relampago, p.grupo_relampago
    FROM atribuicao a
    JOIN questao q ON q.id = a.questao_id
    JOIN participante p ON p.id = a.participante_id
    WHERE a.participante_id = ?
    ORDER BY a.posicao
  `).all(participanteId).map(l => ({
    id: l.id,
    texto: l.texto,
    posicao: l.posicao,
    eRelampago: Boolean(l.e_relampago),
    comCronometro: Boolean(l.e_relampago) && l.grupo_relampago === 'cronometro'
  }))
}

export function marcarEntregue (db, participanteId, questaoId, agora = new Date()) {
  db.prepare(`
    UPDATE atribuicao SET entregue_em = ?
    WHERE participante_id = ? AND questao_id = ? AND entregue_em IS NULL
  `).run(agora.toISOString(), participanteId, questaoId)
}

export function definirFase (db, rodadaId, fase) {
  if (!FASES.includes(fase)) throw new Error(`fase inválida: ${fase}`)
  db.prepare('UPDATE rodada SET fase = ? WHERE id = ?').run(fase, rodadaId)
}

export function definirEntradas (db, rodadaId, abertas) {
  db.prepare('UPDATE rodada SET entradas_abertas = ? WHERE id = ?').run(abertas ? 1 : 0, rodadaId)
}

export function definirPassoDebrief (db, rodadaId, passo) {
  db.prepare('UPDATE rodada SET passo_debrief = ? WHERE id = ?').run(Math.max(0, passo), rodadaId)
}

export function zerarRodada (db, rodadaId) {
  db.transaction(() => {
    db.prepare('DELETE FROM participante WHERE rodada_id = ?').run(rodadaId)
    db.prepare(`
      UPDATE rodada SET fase = 'espera', entradas_abertas = 1, passo_debrief = 0 WHERE id = ?
    `).run(rodadaId)
  })()
}
```

`zerarRodada` só apaga `participante`; `atribuicao` e `resposta` somem junto pelo `ON DELETE CASCADE` (o `PRAGMA foreign_keys = ON` da Task 1 é o que faz isso valer).

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/rodada.js testes/rodada.test.js
rtk git commit -m "feat: ciclo de vida da rodada e entrada com retomada por token"
```

---

### Task 5: Registro de respostas, a trava e o cronômetro

**Files:**
- Create: `src/respostas.js`
- Test: `testes/respostas.test.js`

**Interfaces:**
- Consumes: `abrirBanco` (Task 1); `criarRodada`, `entrarParticipante`, `questoesDoParticipante`, `marcarEntregue`, `definirFase` (Task 4).
- Produces:
  - `registrarResposta(db, { participanteId, questaoId, escolha, msParaResponder?, agora? }) -> { registrado: boolean, motivo?: string, escolhaGravada?: string }` — motivos: `nao_atribuida`, `fase_invalida`, `escolha_invalida`, `ja_respondida`.
  - `marcarFinalizadoSeCompleto(db, participanteId, agora?) -> boolean`
  - `resultadoPessoal(db, participanteId) -> { acertos, total, itens: [{ texto, escolha, gabarito, explicacao, correta }] }`

- [ ] **Step 1: Escrever os testes que falham**

```js
// testes/respostas.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarRodada, entrarParticipante, questoesDoParticipante, marcarEntregue, definirFase } from '../src/rodada.js'
import { registrarResposta, marcarFinalizadoSeCompleto, resultadoPessoal } from '../src/respostas.js'

function cenario (grupoDesejado = 'controle') {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 45, segundosRelampago: 10 })
  definirFase(db, rodada.id, 'respondendo')
  // ordem ímpar = controle, par = cronometro
  const token = grupoDesejado === 'controle' ? 'tok-1' : 'tok-2'
  if (grupoDesejado === 'cronometro') entrarParticipante(db, rodada.id, 'tok-1')
  const { participante } = entrarParticipante(db, rodada.id, token)
  const questoes = questoesDoParticipante(db, participante.id)
  const gabaritoDe = id => db.prepare('SELECT gabarito FROM questao WHERE id = ?').get(id).gabarito
  return { db, rodada, participante, questoes, gabaritoDe }
}

test('a primeira resposta é gravada e marcada como correta quando bate o gabarito', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id), msParaResponder: 4200
  })
  assert.equal(r.registrado, true)
  const linha = db.prepare('SELECT * FROM resposta WHERE participante_id = ? AND questao_id = ?')
    .get(participante.id, q.id)
  assert.equal(linha.correta, 1)
  assert.equal(linha.ms_para_responder, 4200)
})

test('A TRAVA: a segunda resposta é rejeitada e não altera a primeira', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  const certa = gabaritoDe(q.id)
  const errada = certa === 'busca' ? 'redacao' : 'busca'

  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: certa }).registrado, true)
  const segunda = registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: errada })
  assert.equal(segunda.registrado, false)
  assert.equal(segunda.motivo, 'ja_respondida')

  const linha = db.prepare('SELECT * FROM resposta WHERE participante_id = ? AND questao_id = ?')
    .get(participante.id, q.id)
  assert.equal(linha.escolha, certa)
  assert.equal(linha.correta, 1)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 1)
})

test('a trava aguenta dez tentativas seguidas sem mudar o placar', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id) })
  for (let i = 0; i < 10; i++) {
    registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: 'busca' })
    registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: 'redacao' })
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 1)
  assert.equal(db.prepare('SELECT correta FROM resposta').get().correta, 1)
})

test('rejeita questão que não foi atribuída ao participante', () => {
  const { db, participante } = cenario()
  const atribuidas = new Set(questoesDoParticipante(db, participante.id).map(q => q.id))
  const outra = db.prepare('SELECT id FROM questao').all().map(r => r.id).find(id => !atribuidas.has(id))
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: outra, escolha: 'busca' })
  assert.equal(r.registrado, false)
  assert.equal(r.motivo, 'nao_atribuida')
})

test('rejeita resposta fora da fase respondendo', () => {
  const { db, rodada, participante, questoes } = cenario()
  definirFase(db, rodada.id, 'revelado')
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: questoes[0].id, escolha: 'busca' })
  assert.equal(r.registrado, false)
  assert.equal(r.motivo, 'fase_invalida')
})

test('rejeita escolha do eixo errado', () => {
  const { db, participante, questoes } = cenario()
  const normal = questoes[0]
  const relampago = questoes[4]
  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: normal.id, escolha: 'confio' }).motivo, 'escolha_invalida')
  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: relampago.id, escolha: 'busca' }).motivo, 'escolha_invalida')
})

test('o relâmpago fora do prazo vira expirou, não erro', () => {
  const { db, participante, questoes } = cenario('cronometro')
  const rel = questoes[4]
  const inicio = new Date('2026-08-27T10:00:00Z')
  marcarEntregue(db, participante.id, rel.id, inicio)
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: rel.id, escolha: 'confiro',
    agora: new Date(inicio.getTime() + 13_000) // 10s + folga de 2s, estourou
  })
  assert.equal(r.registrado, true)
  assert.equal(r.escolhaGravada, 'expirou')
  const linha = db.prepare('SELECT * FROM resposta WHERE questao_id = ?').get(rel.id)
  assert.equal(linha.escolha, 'expirou')
  assert.equal(linha.correta, 0)
})

test('o relâmpago dentro do prazo, contando a folga de rede, é aceito normalmente', () => {
  const { db, participante, questoes } = cenario('cronometro')
  const rel = questoes[4]
  const inicio = new Date('2026-08-27T10:00:00Z')
  marcarEntregue(db, participante.id, rel.id, inicio)
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: rel.id, escolha: 'confiro',
    agora: new Date(inicio.getTime() + 11_500)
  })
  assert.equal(r.escolhaGravada, 'confiro')
  assert.equal(db.prepare('SELECT correta FROM resposta WHERE questao_id = ?').get(rel.id).correta, 1)
})

test('o grupo controle não sofre expiração, por mais que demore', () => {
  const { db, participante, questoes } = cenario('controle')
  const rel = questoes[4]
  const inicio = new Date('2026-08-27T10:00:00Z')
  marcarEntregue(db, participante.id, rel.id, inicio)
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: rel.id, escolha: 'confiro',
    agora: new Date(inicio.getTime() + 120_000)
  })
  assert.equal(r.escolhaGravada, 'confiro')
})

test('o participante só é marcado como finalizado depois das 5 respostas', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  for (const q of questoes.slice(0, 4)) {
    registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id) })
  }
  assert.equal(db.prepare('SELECT finalizado_em FROM participante WHERE id = ?').get(participante.id).finalizado_em, null)
  registrarResposta(db, { participanteId: participante.id, questaoId: questoes[4].id, escolha: 'confiro' })
  assert.notEqual(db.prepare('SELECT finalizado_em FROM participante WHERE id = ?').get(participante.id).finalizado_em, null)
})

test('resultadoPessoal traz gabarito e explicação de cada questão respondida', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  for (const q of questoes.slice(0, 4)) {
    registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id) })
  }
  registrarResposta(db, { participanteId: participante.id, questaoId: questoes[4].id, escolha: 'confio' })
  const r = resultadoPessoal(db, participante.id)
  assert.equal(r.total, 4, 'o placar pessoal conta só as 4, não a relâmpago')
  assert.equal(r.acertos, 4)
  assert.equal(r.itens.length, 5)
  assert.ok(r.itens.every(i => i.explicacao && i.gabarito))
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/respostas.js'`

- [ ] **Step 3: Implementar `src/respostas.js`**

```js
// src/respostas.js
const FOLGA_DE_REDE_MS = 2_000
const ESCOLHAS_NORMAIS = ['busca', 'redacao']
const ESCOLHAS_RELAMPAGO = ['confio', 'confiro']

export function marcarFinalizadoSeCompleto (db, participanteId, agora = new Date()) {
  const { atribuidas, respondidas } = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM atribuicao WHERE participante_id = @p) atribuidas,
      (SELECT COUNT(*) FROM resposta  WHERE participante_id = @p) respondidas
  `).get({ p: participanteId })
  if (respondidas < atribuidas) return false
  db.prepare('UPDATE participante SET finalizado_em = ? WHERE id = ? AND finalizado_em IS NULL')
    .run(agora.toISOString(), participanteId)
  return true
}

export function registrarResposta (db, {
  participanteId, questaoId, escolha, msParaResponder = null, agora = new Date()
}) {
  const contexto = db.prepare(`
    SELECT a.entregue_em, q.gabarito, q.e_relampago,
           p.grupo_relampago, r.fase, r.segundos_relampago
    FROM atribuicao a
    JOIN questao q      ON q.id = a.questao_id
    JOIN participante p ON p.id = a.participante_id
    JOIN rodada r       ON r.id = p.rodada_id
    WHERE a.participante_id = ? AND a.questao_id = ?
  `).get(participanteId, questaoId)

  if (!contexto) return { registrado: false, motivo: 'nao_atribuida' }
  if (contexto.fase !== 'respondendo') return { registrado: false, motivo: 'fase_invalida' }

  const permitidas = contexto.e_relampago ? ESCOLHAS_RELAMPAGO : ESCOLHAS_NORMAIS
  if (!permitidas.includes(escolha)) return { registrado: false, motivo: 'escolha_invalida' }

  let escolhaGravada = escolha
  const sobPressao = contexto.e_relampago && contexto.grupo_relampago === 'cronometro'
  if (sobPressao && contexto.entregue_em) {
    const limite = contexto.segundos_relampago * 1000 + FOLGA_DE_REDE_MS
    if (agora.getTime() - new Date(contexto.entregue_em).getTime() > limite) {
      escolhaGravada = 'expirou'
    }
  }

  const info = db.prepare(`
    INSERT OR IGNORE INTO resposta
      (participante_id, questao_id, escolha, correta, ms_para_responder, respondido_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(participanteId, questaoId, escolhaGravada,
    escolhaGravada === contexto.gabarito ? 1 : 0, msParaResponder, agora.toISOString())

  if (info.changes === 0) return { registrado: false, motivo: 'ja_respondida' }

  marcarFinalizadoSeCompleto(db, participanteId, agora)
  return { registrado: true, escolhaGravada }
}

export function resultadoPessoal (db, participanteId) {
  const itens = db.prepare(`
    SELECT q.id, q.texto, q.gabarito, q.explicacao, q.e_relampago,
           r.escolha, r.correta, a.posicao
    FROM atribuicao a
    JOIN questao q ON q.id = a.questao_id
    LEFT JOIN resposta r ON r.participante_id = a.participante_id AND r.questao_id = a.questao_id
    WHERE a.participante_id = ?
    ORDER BY a.posicao
  `).all(participanteId).map(l => ({
    id: l.id,
    texto: l.texto,
    gabarito: l.gabarito,
    explicacao: l.explicacao,
    eRelampago: Boolean(l.e_relampago),
    escolha: l.escolha,
    correta: Boolean(l.correta)
  }))
  const normais = itens.filter(i => !i.eRelampago)
  return {
    acertos: normais.filter(i => i.correta).length,
    total: normais.length,
    itens
  }
}
```

`INSERT OR IGNORE` é a trava: se a linha já existe, `changes` é 0 e a primeira resposta fica intocada. Não é uma checagem prévia com janela de corrida — é a própria restrição do banco decidindo.

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/respostas.js testes/respostas.test.js
rtk git commit -m "feat: registro de respostas com trava de banco e expiração do relâmpago"
```

---

### Task 6: Agregados do telão

**Files:**
- Create: `src/agregados.js`
- Test: `testes/agregados.test.js`

**Interfaces:**
- Consumes: Tasks 1, 4 e 5.
- Produces: `calcularAgregados(db, rodadaId) -> Agregados`, com o formato:

```js
{
  fase: 'espera' | 'respondendo' | 'revelado',
  passoDebrief: number,
  conectados: number, respondendo: number, finalizados: number,
  placar: { decisoes, acertos, percentual },
  porCategoria: [{ categoria, total, acertos, percentual }],           // desc por percentual
  armadilhas: [{ id, texto, gabarito, explicacao, total, acertos, percentualErro }],  // até 3
  relampago: {
    cronometro: { total, acertos, expirados, percentual },
    controle:   { total, acertos, expirados, percentual }
  }
}
```

- [ ] **Step 1: Escrever os testes que falham**

```js
// testes/agregados.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarRodada, entrarParticipante, questoesDoParticipante, definirFase } from '../src/rodada.js'
import { registrarResposta } from '../src/respostas.js'
import { calcularAgregados } from '../src/agregados.js'

// Monta uma rodada onde cada participante acerta as `acertosDesejados` primeiras
// questões e erra o resto, para que os números sejam previsíveis.
function montar ({ participantes, acertosDesejados, responderRelampago = true }) {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 45 })
  definirFase(db, rodada.id, 'respondendo')
  const gabaritoDe = id => db.prepare('SELECT gabarito FROM questao WHERE id = ?').get(id).gabarito
  for (let i = 0; i < participantes; i++) {
    const { participante } = entrarParticipante(db, rodada.id, `tok-${i}`)
    const qs = questoesDoParticipante(db, participante.id)
    qs.slice(0, 4).forEach((q, idx) => {
      const certa = gabaritoDe(q.id)
      const escolha = idx < acertosDesejados ? certa : (certa === 'busca' ? 'redacao' : 'busca')
      registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha })
    })
    if (responderRelampago) {
      registrarResposta(db, { participanteId: participante.id, questaoId: qs[4].id, escolha: 'confiro' })
    }
  }
  return { db, rodada }
}

test('conta conectados, respondendo e finalizados', () => {
  const { db, rodada } = montar({ participantes: 6, acertosDesejados: 4 })
  entrarParticipante(db, rodada.id, 'so-entrou')      // conectado, não respondeu
  const emAndamento = entrarParticipante(db, rodada.id, 'meio').participante
  registrarResposta(db, {
    participanteId: emAndamento.id,
    questaoId: questoesDoParticipante(db, emAndamento.id)[0].id,
    escolha: 'busca'
  })
  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.conectados, 8)
  assert.equal(ag.finalizados, 6)
  assert.equal(ag.respondendo, 1)
})

test('o placar global conta 4 decisões por participante e exclui a relâmpago', () => {
  const { db, rodada } = montar({ participantes: 10, acertosDesejados: 3 })
  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.placar.decisoes, 40)
  assert.equal(ag.placar.acertos, 30)
  assert.equal(ag.placar.percentual, 75)
})

test('o placar por categoria soma o mesmo total do placar global', () => {
  const { db, rodada } = montar({ participantes: 12, acertosDesejados: 2 })
  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.porCategoria.reduce((s, c) => s + c.total, 0), ag.placar.decisoes)
  assert.equal(ag.porCategoria.reduce((s, c) => s + c.acertos, 0), ag.placar.acertos)
  assert.ok(!ag.porCategoria.some(c => c.categoria === 'relampago'))
})

test('as categorias vêm ordenadas do maior para o menor percentual de acerto', () => {
  const { db, rodada } = montar({ participantes: 12, acertosDesejados: 2 })
  const p = calcularAgregados(db, rodada.id).porCategoria.map(c => c.percentual)
  assert.deepEqual(p, [...p].sort((a, b) => b - a))
})

test('as armadilhas são no máximo 3, ordenadas por erro, com texto e explicação', () => {
  const { db, rodada } = montar({ participantes: 20, acertosDesejados: 2 })
  const ag = calcularAgregados(db, rodada.id)
  assert.ok(ag.armadilhas.length <= 3)
  const erros = ag.armadilhas.map(a => a.percentualErro)
  assert.deepEqual(erros, [...erros].sort((a, b) => b - a))
  for (const a of ag.armadilhas) {
    assert.ok(a.texto && a.explicacao && a.gabarito)
    assert.ok(a.total >= 5, 'questão com amostra pequena demais não vira armadilha')
  }
})

test('o A/B do relâmpago separa os dois grupos e conta os expirados à parte', () => {
  const { db, rodada } = montar({ participantes: 20, acertosDesejados: 4 })
  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.relampago.cronometro.total + ag.relampago.controle.total, 20)
  assert.equal(ag.relampago.cronometro.total, 10)
  assert.equal(ag.relampago.controle.total, 10)
  assert.equal(ag.relampago.cronometro.percentual, 100)
  assert.equal(ag.relampago.cronometro.expirados, 0)
})

test('rodada sem nenhuma resposta devolve zeros em vez de NaN', () => {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 20 })
  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.placar.decisoes, 0)
  assert.equal(ag.placar.percentual, 0)
  assert.deepEqual(ag.porCategoria, [])
  assert.deepEqual(ag.armadilhas, [])
  assert.equal(ag.relampago.cronometro.percentual, 0)
  assert.equal(ag.conectados, 0)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/agregados.js'`

- [ ] **Step 3: Implementar `src/agregados.js`**

```js
// src/agregados.js
const MINIMO_PARA_ARMADILHA = 5
const MAXIMO_ARMADILHAS = 3

const percentual = (parte, total) => (total === 0 ? 0 : Math.round((parte / total) * 100))

export function calcularAgregados (db, rodadaId) {
  const rodada = db.prepare('SELECT fase, passo_debrief FROM rodada WHERE id = ?').get(rodadaId)
  if (!rodada) throw new Error('rodada inexistente')

  const presenca = db.prepare(`
    SELECT
      COUNT(*) conectados,
      SUM(CASE WHEN p.finalizado_em IS NOT NULL THEN 1 ELSE 0 END) finalizados,
      SUM(CASE WHEN p.finalizado_em IS NULL
                AND EXISTS (SELECT 1 FROM resposta r WHERE r.participante_id = p.id)
               THEN 1 ELSE 0 END) respondendo
    FROM participante p WHERE p.rodada_id = ?
  `).get(rodadaId)

  const placarBruto = db.prepare(`
    SELECT COUNT(*) decisoes, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 0
  `).get(rodadaId)

  const decisoes = placarBruto.decisoes ?? 0
  const acertos = placarBruto.acertos ?? 0

  const porCategoria = db.prepare(`
    SELECT q.categoria, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 0
    GROUP BY q.categoria
  `).all(rodadaId)
    .map(l => ({ ...l, percentual: percentual(l.acertos, l.total) }))
    .sort((a, b) => b.percentual - a.percentual)

  const armadilhas = db.prepare(`
    SELECT q.id, q.texto, q.gabarito, q.explicacao, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 0
    GROUP BY q.id
    HAVING total >= ?
  `).all(rodadaId, MINIMO_PARA_ARMADILHA)
    .map(l => ({ ...l, percentualErro: percentual(l.total - l.acertos, l.total) }))
    .sort((a, b) => b.percentualErro - a.percentualErro)
    .slice(0, MAXIMO_ARMADILHAS)

  const grupos = db.prepare(`
    SELECT p.grupo_relampago grupo,
           COUNT(*) total,
           SUM(r.correta) acertos,
           SUM(CASE WHEN r.escolha = 'expirou' THEN 1 ELSE 0 END) expirados
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 1
    GROUP BY p.grupo_relampago
  `).all(rodadaId)

  const vazio = { total: 0, acertos: 0, expirados: 0, percentual: 0 }
  const relampago = { cronometro: { ...vazio }, controle: { ...vazio } }
  for (const g of grupos) {
    relampago[g.grupo] = {
      total: g.total,
      acertos: g.acertos ?? 0,
      expirados: g.expirados ?? 0,
      percentual: percentual(g.acertos ?? 0, g.total)
    }
  }

  return {
    fase: rodada.fase,
    passoDebrief: rodada.passo_debrief,
    conectados: presenca.conectados ?? 0,
    respondendo: presenca.respondendo ?? 0,
    finalizados: presenca.finalizados ?? 0,
    placar: { decisoes, acertos, percentual: percentual(acertos, decisoes) },
    porCategoria,
    armadilhas,
    relampago
  }
}
```

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/agregados.js testes/agregados.test.js
rtk git commit -m "feat: agregados do telão com placar, categorias, armadilhas e A/B"
```

---

### Task 7: Canal SSE e rotas do participante

**Files:**
- Create: `src/sse.js`, `src/servidor.js`
- Test: `testes/sse.test.js`, `testes/integracao.test.js`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 6.
- Produces:
  - `criarCanal() -> { inscrever(raw), publicar(evento, dados), manterVivo(), fechar(), quantidade }`
  - `agendarComDebounce(fn, ms) -> () => void`
  - `criarServidor(db, { adminKey }) -> { app, canais }` — `app` é a instância Fastify, testável com `app.inject()`
  - `payloadDoParticipante(rodada) -> { fase, segundosRelampago }` — **exportada só para poder ser testada**; é o único formato que trafega no canal do participante.

- [ ] **Step 1: Escrever os testes que falham**

```js
// testes/sse.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { criarCanal, agendarComDebounce } from '../src/sse.js'

function falsoFluxo () {
  return { escrito: [], cabecalhos: null, ouvintes: {},
    writeHead (c, h) { this.cabecalhos = h },
    write (t) { this.escrito.push(t); return true },
    end () {},
    on (evento, fn) { this.ouvintes[evento] = fn } }
}

test('inscrever manda os cabeçalhos de event-stream', () => {
  const canal = criarCanal(); const fluxo = falsoFluxo()
  canal.inscrever(fluxo)
  assert.equal(fluxo.cabecalhos['Content-Type'], 'text/event-stream')
  assert.equal(canal.quantidade, 1)
})

test('publicar entrega o bloco SSE a todos os inscritos', () => {
  const canal = criarCanal(); const a = falsoFluxo(); const b = falsoFluxo()
  canal.inscrever(a); canal.inscrever(b)
  canal.publicar('estado', { fase: 'espera' })
  const bloco = 'event: estado\ndata: {"fase":"espera"}\n\n'
  assert.ok(a.escrito.includes(bloco))
  assert.ok(b.escrito.includes(bloco))
})

test('fechar a conexão remove o inscrito', () => {
  const canal = criarCanal(); const fluxo = falsoFluxo()
  canal.inscrever(fluxo)
  fluxo.ouvintes.close()
  assert.equal(canal.quantidade, 0)
})

test('um inscrito que estoura no write é descartado sem derrubar os outros', () => {
  const canal = criarCanal()
  const bom = falsoFluxo()
  const ruim = { ...falsoFluxo(), write () { throw new Error('EPIPE') } }
  canal.inscrever(ruim); canal.inscrever(bom)
  canal.publicar('estado', { fase: 'espera' })
  assert.equal(canal.quantidade, 1)
  assert.ok(bom.escrito.some(t => t.includes('estado')))
})

test('o debounce agrupa rajadas numa chamada só', async () => {
  let chamadas = 0
  const agendar = agendarComDebounce(() => chamadas++, 20)
  for (let i = 0; i < 50; i++) agendar()
  assert.equal(chamadas, 0)
  await new Promise(r => setTimeout(r, 40))
  assert.equal(chamadas, 1)
})
```

```js
// testes/integracao.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarServidor, payloadDoParticipante } from '../src/servidor.js'
import { criarRodada, definirFase } from '../src/rodada.js'

const CHAVE = 'chave-de-teste'

function montarApp (previsao = 45) {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: previsao })
  const { app } = criarServidor(db, { adminKey: CHAVE })
  return { db, rodada, app }
}

async function entrar (app, cookie) {
  const r = await app.inject({
    method: 'POST', url: '/api/entrar',
    headers: cookie ? { cookie } : {}
  })
  return { corpo: r.json(), cookie: r.cookies.find(c => c.name === 'pt') }
}

test('entrar devolve as 5 questões, o rótulo e a fase', async () => {
  const { rodada, db, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo } = await entrar(a)
  assert.equal(corpo.questoes.length, 5)
  assert.equal(corpo.rotulo, 'Participante #1')
  assert.equal(corpo.fase, 'respondendo')
})

test('VAZAMENTO: a resposta de entrar não contém gabarito nem explicação', async () => {
  const { db, app: a } = montarApp()
  const { corpo } = await entrar(a)
  const texto = JSON.stringify(corpo)
  assert.ok(!texto.includes('gabarito'))
  assert.ok(!texto.includes('explicacao'))
  for (const { explicacao } of db.prepare('SELECT explicacao FROM questao').all()) {
    assert.ok(!texto.includes(explicacao), 'uma explicação vazou para o participante')
  }
})

test('VAZAMENTO: o payload do canal do participante só carrega fase e cronômetro', () => {
  const payload = payloadDoParticipante({
    id: 1, fase: 'respondendo', segundos_relampago: 10, passo_debrief: 3,
    previsao_participantes: 45, num_questoes_ativas: 10
  })
  assert.deepEqual(Object.keys(payload).sort(), ['fase', 'segundosRelampago'])
})

test('VAZAMENTO: responder não diz se acertou', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const r = await a.inject({
    method: 'POST', url: '/api/responder',
    headers: { cookie: `pt=${cookie.value}` },
    payload: { questaoId: corpo.questoes[0].id, escolha: 'busca', msParaResponder: 3000 }
  })
  const texto = JSON.stringify(r.json())
  assert.ok(!texto.includes('correta'))
  assert.ok(!texto.includes('gabarito'))
  assert.equal(r.json().ok, true)
})

test('reabrir a página com o mesmo cookie retoma a sessão e as mesmas questões', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const primeira = await entrar(a)
  const segunda = await entrar(a, `pt=${primeira.cookie.value}`)
  assert.equal(segunda.corpo.rotulo, primeira.corpo.rotulo)
  assert.deepEqual(
    segunda.corpo.questoes.map(q => q.id),
    primeira.corpo.questoes.map(q => q.id)
  )
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participante').get().c, 1)
})

test('entrar devolve as questões já respondidas para o cliente retomar de onde parou', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const primeira = corpo.questoes[0].id
  await a.inject({ method: 'POST', url: '/api/responder',
    headers: { cookie: `pt=${cookie.value}` },
    payload: { questaoId: primeira, escolha: 'busca' } })
  const volta = await entrar(a, `pt=${cookie.value}`)
  assert.deepEqual(volta.corpo.jaRespondidas, [primeira])
})

test('A TRAVA pela API: a segunda resposta é recusada e o banco não muda', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { corpo, cookie } = await entrar(a)
  const questaoId = corpo.questoes[0].id
  const enviar = escolha => a.inject({ method: 'POST', url: '/api/responder',
    headers: { cookie: `pt=${cookie.value}` }, payload: { questaoId, escolha } })

  assert.equal((await enviar('busca')).json().ok, true)
  const segunda = await enviar('redacao')
  assert.equal(segunda.statusCode, 409)
  assert.equal(segunda.json().motivo, 'ja_respondida')
  assert.equal(db.prepare('SELECT escolha FROM resposta').get().escolha, 'busca')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 1)
})

test('meu-resultado responde 409 antes da revelação e 200 depois', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const { cookie } = await entrar(a)
  const cabecalhos = { cookie: `pt=${cookie.value}` }

  assert.equal((await a.inject({ url: '/api/meu-resultado', headers: cabecalhos })).statusCode, 409)
  definirFase(db, rodada.id, 'revelado')
  const depois = await a.inject({ url: '/api/meu-resultado', headers: cabecalhos })
  assert.equal(depois.statusCode, 200)
  assert.ok('acertos' in depois.json())
})

test('responder sem cookie de participante é recusado', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  const r = await a.inject({ method: 'POST', url: '/api/responder',
    payload: { questaoId: 'B1', escolha: 'busca' } })
  assert.equal(r.statusCode, 401)
})

test('o canal do participante devolve content-type de event-stream', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: '/stream' })
  assert.match(r.headers['content-type'], /text\/event-stream/)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/sse.js'`

- [ ] **Step 3: Implementar `src/sse.js`**

```js
// src/sse.js
export function criarCanal () {
  const inscritos = new Set()

  const descartar = raw => inscritos.delete(raw)

  return {
    inscrever (raw) {
      raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      raw.write(': conectado\n\n')
      inscritos.add(raw)
      raw.on('close', () => descartar(raw))
      raw.on('error', () => descartar(raw))
      return () => descartar(raw)
    },
    publicar (evento, dados) {
      const bloco = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`
      for (const raw of [...inscritos]) {
        try { raw.write(bloco) } catch { descartar(raw) }
      }
    },
    manterVivo () {
      for (const raw of [...inscritos]) {
        try { raw.write(': ping\n\n') } catch { descartar(raw) }
      }
    },
    fechar () {
      for (const raw of [...inscritos]) { try { raw.end() } catch { /* já caiu */ } }
      inscritos.clear()
    },
    get quantidade () { return inscritos.size }
  }
}

export function agendarComDebounce (fn, ms) {
  let temporizador = null
  return () => {
    if (temporizador) return
    temporizador = setTimeout(() => { temporizador = null; fn() }, ms)
    temporizador.unref?.()
  }
}
```

- [ ] **Step 4: Implementar `src/servidor.js` com as rotas do participante**

```js
// src/servidor.js
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { abrirBanco } from './db.js'
import { criarCanal, agendarComDebounce } from './sse.js'
import { calcularAgregados } from './agregados.js'
import { registrarResposta, resultadoPessoal } from './respostas.js'
import {
  criarRodada, rodadaAtual, entrarParticipante, questoesDoParticipante,
  marcarEntregue, definirFase, definirEntradas, definirPassoDebrief, zerarRodada
} from './rodada.js'

const PASTA_PUBLICA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'publico')
const COOKIE_PARTICIPANTE = 'pt'
const DEBOUNCE_PAINEL_MS = 500
const PING_MS = 25_000

// O ÚNICO formato que trafega no canal do participante. Se algo for
// acrescentado aqui, o teste de vazamento da Task 7 quebra — de propósito.
export function payloadDoParticipante (rodada) {
  return { fase: rodada.fase, segundosRelampago: rodada.segundos_relampago }
}

export function criarServidor (db, { adminKey = process.env.ADMIN_KEY, logger = false } = {}) {
  const app = Fastify({ logger })
  app.register(fastifyCookie)
  app.register(fastifyStatic, { root: PASTA_PUBLICA, prefix: '/' })

  const canais = { participantes: criarCanal(), painel: criarCanal() }

  const emitirParticipantes = () => {
    const rodada = rodadaAtual(db)
    if (rodada) canais.participantes.publicar('estado', payloadDoParticipante(rodada))
  }
  const emitirPainel = agendarComDebounce(() => {
    const rodada = rodadaAtual(db)
    if (rodada) canais.painel.publicar('estado', calcularAgregados(db, rodada.id))
  }, DEBOUNCE_PAINEL_MS)

  const ping = setInterval(() => {
    canais.participantes.manterVivo(); canais.painel.manterVivo()
  }, PING_MS)
  ping.unref?.()
  app.addHook('onClose', async () => {
    clearInterval(ping); canais.participantes.fechar(); canais.painel.fechar()
  })

  function participanteDoPedido (req, rodada) {
    const token = req.cookies?.[COOKIE_PARTICIPANTE]
    if (!token) return null
    return db.prepare('SELECT * FROM participante WHERE rodada_id = ? AND token = ?')
      .get(rodada.id, token) ?? null
  }

  function exigirRodada (reply) {
    const rodada = rodadaAtual(db)
    if (!rodada) { reply.code(503).send({ erro: 'nenhuma rodada aberta' }); return null }
    return rodada
  }

  // ---------- participante ----------

  app.post('/api/entrar', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const token = req.cookies?.[COOKIE_PARTICIPANTE] ?? randomUUID()

    let participante
    try {
      ;({ participante } = entrarParticipante(db, rodada.id, token))
    } catch (erro) {
      return reply.code(403).send({ erro: erro.message })
    }

    reply.setCookie(COOKIE_PARTICIPANTE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 12
    })
    emitirPainel()

    const jaRespondidas = db
      .prepare('SELECT questao_id FROM resposta WHERE participante_id = ?')
      .all(participante.id).map(l => l.questao_id)

    return {
      rotulo: participante.rotulo,
      fase: rodada.fase,
      segundosRelampago: rodada.segundos_relampago,
      questoes: questoesDoParticipante(db, participante.id),
      jaRespondidas
    }
  })

  app.post('/api/entregar', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })
    marcarEntregue(db, participante.id, req.body?.questaoId)
    return { ok: true }
  })

  app.post('/api/responder', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })

    const { questaoId, escolha, msParaResponder } = req.body ?? {}
    const r = registrarResposta(db, {
      participanteId: participante.id, questaoId, escolha, msParaResponder
    })
    if (!r.registrado) {
      return reply.code(r.motivo === 'ja_respondida' ? 409 : 400).send({ motivo: r.motivo })
    }
    emitirPainel()
    // Devolve só o suficiente para o cliente avançar de tela. Nunca `correta`.
    return { ok: true, expirou: r.escolhaGravada === 'expirou' }
  })

  app.get('/api/meu-resultado', (req, reply) => {
    const rodada = exigirRodada(reply); if (!rodada) return
    const participante = participanteDoPedido(req, rodada)
    if (!participante) return reply.code(401).send({ erro: 'sem sessão' })
    if (rodada.fase !== 'revelado') {
      return reply.code(409).send({ erro: 'o resultado ainda não foi revelado' })
    }
    return resultadoPessoal(db, participante.id)
  })

  app.get('/stream', (req, reply) => {
    reply.hijack()
    canais.participantes.inscrever(reply.raw)
    const rodada = rodadaAtual(db)
    if (rodada) {
      reply.raw.write(`event: estado\ndata: ${JSON.stringify(payloadDoParticipante(rodada))}\n\n`)
    }
  })

  return { app, canais, emitirParticipantes, emitirPainel }
}

export async function iniciar () {
  const db = abrirBanco()
  const { app } = criarServidor(db, { logger: true })
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  iniciar().catch(erro => { console.error(erro); process.exit(1) })
}
```

- [ ] **Step 5: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS — inclusive os quatro testes marcados `VAZAMENTO`

- [ ] **Step 6: Commit**

```bash
rtk git add src/sse.js src/servidor.js testes/sse.test.js testes/integracao.test.js
rtk git commit -m "feat: canal SSE e rotas do participante, com canal isolado do gabarito"
```

---

### Task 8: Rotas do painel

**Files:**
- Modify: `src/servidor.js`
- Test: `testes/integracao.test.js`

**Interfaces:**
- Consumes: `criarServidor` (Task 7), `calcularAgregados` (Task 6), o módulo `rodada` (Task 4).
- Produces: rotas `POST /api/painel/rodada`, `/fase`, `/entradas`, `/debrief`, `/zerar`; `GET /api/painel/estado`; `GET /stream/painel`. Todas exigem a chave, aceita por `?k=` ou pelo cookie `painel`.

- [ ] **Step 1: Escrever os testes que falham**

```js
// acrescentar a testes/integracao.test.js

const comChave = url => `${url}${url.includes('?') ? '&' : '?'}k=${CHAVE}`

test('as rotas do painel exigem a chave', async () => {
  const { app: a } = montarApp()
  for (const url of ['/api/painel/estado', '/stream/painel']) {
    assert.equal((await a.inject({ url })).statusCode, 401, url)
  }
  const semChave = await a.inject({ method: 'POST', url: '/api/painel/fase', payload: { fase: 'respondendo' } })
  assert.equal(semChave.statusCode, 401)
})

test('a chave errada também é recusada', async () => {
  const { app: a } = montarApp()
  assert.equal((await a.inject({ url: '/api/painel/estado?k=errada' })).statusCode, 401)
})

test('criar rodada pelo painel dimensiona pela previsão', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/rodada'),
    payload: { previsaoParticipantes: 45 } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().numQuestoesAtivas, 10)
})

test('o painel troca a fase e o estado reflete', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/fase'), payload: { fase: 'respondendo' } })
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().fase, 'respondendo')
})

test('o painel recusa fase inválida', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ method: 'POST', url: comChave('/api/painel/fase'), payload: { fase: 'encerrado' } })
  assert.equal(r.statusCode, 400)
})

test('fechar as entradas bloqueia participante novo', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await a.inject({ method: 'POST', url: comChave('/api/painel/entradas'), payload: { abertas: false } })
  const r = await a.inject({ method: 'POST', url: '/api/entrar' })
  assert.equal(r.statusCode, 403)
})

test('o estado do painel traz os agregados completos', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await entrar(a)
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  for (const campo of ['conectados', 'respondendo', 'finalizados', 'placar', 'porCategoria', 'armadilhas', 'relampago']) {
    assert.ok(campo in estado, `faltou ${campo}`)
  }
  assert.equal(estado.conectados, 1)
})

test('avançar o debrief guarda o passo', async () => {
  const { app: a } = montarApp()
  await a.inject({ method: 'POST', url: comChave('/api/painel/debrief'), payload: { passo: 3 } })
  assert.equal((await a.inject({ url: comChave('/api/painel/estado') })).json().passoDebrief, 3)
})

test('zerar limpa os participantes e volta para espera', async () => {
  const { db, rodada, app: a } = montarApp()
  definirFase(db, rodada.id, 'respondendo')
  await entrar(a)
  await a.inject({ method: 'POST', url: comChave('/api/painel/zerar') })
  const estado = (await a.inject({ url: comChave('/api/painel/estado') })).json()
  assert.equal(estado.conectados, 0)
  assert.equal(estado.fase, 'espera')
})

test('o canal do painel devolve content-type de event-stream com a chave', async () => {
  const { app: a } = montarApp()
  const r = await a.inject({ url: comChave('/stream/painel') })
  assert.match(r.headers['content-type'], /text\/event-stream/)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — as rotas do painel devolvem 404, não 401

- [ ] **Step 3: Implementar as rotas do painel em `src/servidor.js`**

Inserir antes do `return { app, canais, ... }`:

```js
  // ---------- painel ----------

  function temChave (req) {
    const oferecida = req.query?.k ?? req.cookies?.painel
    return Boolean(adminKey) && oferecida === adminKey
  }

  function exigirChave (req, reply) {
    if (temChave(req)) return true
    reply.code(401).send({ erro: 'chave inválida' })
    return false
  }

  app.post('/api/painel/rodada', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const { previsaoParticipantes, numQuestoesAtivas, segundosRelampago } = req.body ?? {}
    if (!Number.isInteger(previsaoParticipantes) || previsaoParticipantes < 1) {
      return reply.code(400).send({ erro: 'previsaoParticipantes deve ser inteiro positivo' })
    }
    let rodada
    try {
      rodada = criarRodada(db, { previsaoParticipantes, numQuestoesAtivas, segundosRelampago })
    } catch (erro) {
      return reply.code(400).send({ erro: erro.message })
    }
    emitirParticipantes(); emitirPainel()
    return { id: rodada.id, numQuestoesAtivas: rodada.num_questoes_ativas }
  })

  app.post('/api/painel/fase', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    try {
      definirFase(db, rodada.id, req.body?.fase)
    } catch (erro) {
      return reply.code(400).send({ erro: erro.message })
    }
    emitirParticipantes(); emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/entradas', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    definirEntradas(db, rodada.id, Boolean(req.body?.abertas))
    emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/debrief', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    definirPassoDebrief(db, rodada.id, Number(req.body?.passo ?? 0))
    emitirPainel()
    return { ok: true }
  })

  app.post('/api/painel/zerar', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    zerarRodada(db, rodada.id)
    emitirParticipantes(); emitirPainel()
    return { ok: true }
  })

  app.get('/api/painel/estado', (req, reply) => {
    if (!exigirChave(req, reply)) return
    const rodada = exigirRodada(reply); if (!rodada) return
    return { ...calcularAgregados(db, rodada.id), entradasAbertas: Boolean(rodada.entradas_abertas) }
  })

  app.get('/stream/painel', (req, reply) => {
    if (!temChave(req)) return reply.code(401).send({ erro: 'chave inválida' })
    reply.hijack()
    canais.painel.inscrever(reply.raw)
    const rodada = rodadaAtual(db)
    if (rodada) {
      const estado = calcularAgregados(db, rodada.id)
      reply.raw.write(`event: estado\ndata: ${JSON.stringify(estado)}\n\n`)
    }
  })
```

- [ ] **Step 4: Rodar para confirmar que passam**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add src/servidor.js testes/integracao.test.js
rtk git commit -m "feat: rotas do painel de controle protegidas por chave"
```

---

### Task 9: Tela do participante

**Files:**
- Create: `src/publico/comum.css`, `src/publico/quiz.html`, `src/publico/quiz.js`
- Test: `testes/frontend.test.js`

**Interfaces:**
- Consumes: as rotas do participante da Task 7.
- Produces: `GET /quiz.html` — a tela que vai no chat do Zoom. Nenhum outro módulo depende dela.

- [ ] **Step 1: Escrever o teste de vazamento estático**

```js
// testes/frontend.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirBanco } from '../src/db.js'

const PUBLICO = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src', 'publico')
const ler = arquivo => fs.readFileSync(path.join(PUBLICO, arquivo), 'utf8')

test('a tela do participante não embute gabarito nem explicação', () => {
  const fonte = ler('quiz.html') + ler('quiz.js')
  const questoes = abrirBanco(':memory:').prepare('SELECT texto, explicacao FROM questao').all()
  for (const q of questoes) {
    assert.ok(!fonte.includes(q.explicacao), 'uma explicação está embutida na tela do quiz')
    assert.ok(!fonte.includes(q.texto), 'um enunciado está embutido na tela do quiz')
  }
})

test('a tela do participante não chama nenhuma rota do painel', () => {
  const fonte = ler('quiz.js')
  assert.ok(!fonte.includes('/api/painel'))
  assert.ok(!fonte.includes('/stream/painel'))
})

test('nenhum módulo do servidor identifica ou bloqueia por IP', () => {
  const SRC = path.dirname(PUBLICO)
  for (const arquivo of fs.readdirSync(SRC).filter(a => a.endsWith('.js'))) {
    const fonte = fs.readFileSync(path.join(SRC, arquivo), 'utf8')
    assert.ok(!/req\.ip|remoteAddress|x-forwarded-for/i.test(fonte),
      `${arquivo} usa o IP do participante, e a spec proíbe: na reunião online cada um vem de uma rede, mas a trava é o token, nunca o IP`)
  }
})

test('as três telas existem e declaram a paleta compartilhada', () => {
  for (const arquivo of ['quiz.html', 'telao.html', 'painel.html']) {
    assert.match(ler(arquivo), /comum\.css/, `${arquivo} não carrega comum.css`)
  }
})

test('a paleta usa azul e laranja, nunca o par verde/vermelho reprovado', () => {
  const css = ler('comum.css')
  assert.match(css, /--acerto:\s*#3987e5/)
  assert.match(css, /--erro:\s*#d95926/)
  assert.ok(!/#0ca30c/i.test(css), 'o verde reprovado no gate de daltonismo voltou')
  assert.ok(!/#d03b3b/i.test(css), 'o vermelho reprovado no gate de daltonismo voltou')
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `ENOENT: src/publico/quiz.html`

- [ ] **Step 3: Escrever `src/publico/comum.css`**

```css
/* src/publico/comum.css — paleta validada, tema escuro único */
:root {
  --plano:      #0d0d0d;
  --superficie: #1a1a19;
  --tinta:      #ffffff;
  --tinta-2:    #c3c2b7;
  --tinta-3:    #898781;
  --grade:      #2c2c2a;
  --acerto:     #3987e5;
  --erro:       #d95926;
  --expirou:    #898781;
  --raio:       12px;
  --fonte: system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--plano);
  color: var(--tinta);
  font-family: var(--fonte);
  -webkit-text-size-adjust: 100%;
}

.cartao {
  background: var(--superficie);
  border-radius: var(--raio);
  padding: 24px;
}

.discreto { color: var(--tinta-3); }
.secundario { color: var(--tinta-2); }

/* Barra empilhada. O vão de 2px é a superfície aparecendo entre segmentos. */
.barra {
  display: flex;
  gap: 2px;
  height: 28px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--grade);
}
.seg {
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 600; color: var(--plano);
  min-width: 0; transition: flex-basis 400ms ease;
}
.seg.acerto  { background: var(--acerto); }
.seg.erro    { background: var(--erro); }
.seg.expirou { background: var(--expirou); }

/* Legenda: a identidade nunca depende só da cor. */
.legenda { display: flex; gap: 20px; flex-wrap: wrap; color: var(--tinta-2); font-size: 14px; }
.legenda span { display: flex; align-items: center; gap: 8px; }
.amostra { width: 14px; height: 14px; border-radius: 3px; }
.amostra.acerto { background: var(--acerto); }
.amostra.erro { background: var(--erro); }
.amostra.expirou { background: var(--expirou); }
```

- [ ] **Step 4: Escrever `src/publico/quiz.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Confere ou Confia?</title>
  <link rel="stylesheet" href="/comum.css">
  <style>
    body { display: flex; justify-content: center; padding: 20px; }
    main { width: 100%; max-width: 560px; }
    .rotulo { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--tinta-3); }
    .progresso { font-size: 13px; color: var(--tinta-3); margin-top: 4px; }
    .enunciado { font-size: 21px; line-height: 1.45; margin: 24px 0 32px; }
    .opcoes { display: grid; gap: 12px; }
    button.opcao {
      font-family: var(--fonte); font-size: 18px; font-weight: 600;
      padding: 22px 20px; border-radius: var(--raio); border: 2px solid var(--grade);
      background: var(--superficie); color: var(--tinta); cursor: pointer; text-align: left;
    }
    button.opcao:hover:not(:disabled) { border-color: var(--tinta-3); }
    button.opcao:disabled { opacity: .45; cursor: default; }
    .cronometro { font-size: 44px; font-weight: 700; text-align: center; margin: 12px 0; }
    .cronometro.apertado { color: var(--erro); }
    .centrado { text-align: center; padding: 48px 0; }
    .grande { font-size: 56px; font-weight: 700; margin: 8px 0; }
    .item { border-top: 1px solid var(--grade); padding: 16px 0; }
    .veredito { font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .veredito.certo { color: var(--acerto); }
    .veredito.torto { color: var(--erro); }
  </style>
</head>
<body>
  <main id="tela" aria-live="polite"><p class="centrado discreto">Carregando…</p></main>
  <script type="module" src="/quiz.js"></script>
</body>
</html>
```

- [ ] **Step 5: Escrever `src/publico/quiz.js`**

```js
// src/publico/quiz.js
const tela = document.getElementById('tela')

const estado = {
  rotulo: '', fase: 'espera', segundosRelampago: 10,
  questoes: [], respondidas: new Set(), enviando: false,
  mostradaEm: 0, cronometro: null, resultado: null
}

const escapar = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

async function entrar () {
  const r = await fetch('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  if (!r.ok) {
    tela.innerHTML = '<p class="centrado discreto">A dinâmica ainda não abriu, ou as entradas foram encerradas.</p>'
    return false
  }
  const dados = await r.json()
  estado.rotulo = dados.rotulo
  estado.fase = dados.fase
  estado.segundosRelampago = dados.segundosRelampago
  estado.questoes = dados.questoes
  estado.respondidas = new Set(dados.jaRespondidas)
  return true
}

const pendente = () => estado.questoes.find(q => !estado.respondidas.has(q.id))

function pararCronometro () {
  if (estado.cronometro) { clearInterval(estado.cronometro); estado.cronometro = null }
}

async function responder (questao, escolha) {
  if (estado.enviando || estado.respondidas.has(questao.id)) return
  estado.enviando = true
  pararCronometro()
  document.querySelectorAll('button.opcao').forEach(b => { b.disabled = true })
  try {
    const r = await fetch('/api/responder', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questaoId: questao.id, escolha, msParaResponder: Date.now() - estado.mostradaEm })
    })
    // 409 = já respondida. A trava é do servidor; aqui é só seguir em frente.
    if (r.ok || r.status === 409) estado.respondidas.add(questao.id)
    else if (r.status === 400) estado.respondidas.add(questao.id)
  } catch {
    estado.enviando = false
    document.querySelectorAll('button.opcao').forEach(b => { b.disabled = false })
    return
  }
  estado.enviando = false
  desenhar()
}

function desenharQuestao (questao) {
  const numero = estado.respondidas.size + 1
  const eixo = questao.eRelampago
    ? [['confio', 'Confio — uso do jeito que veio'], ['confiro', 'Confiro — abro o link antes']]
    : [['busca', '🔎 Isso é BUSCA — vá à fonte'], ['redacao', '✍️ Isso é REDAÇÃO — a IA resolve']]

  tela.innerHTML = `
    <div class="rotulo">${escapar(estado.rotulo)}</div>
    <div class="progresso">${questao.eRelampago ? 'Pergunta relâmpago' : `Situação ${numero} de 4`}</div>
    ${questao.eRelampago && questao.comCronometro ? '<div class="cronometro" id="conta"></div>' : ''}
    <p class="enunciado">${escapar(questao.texto)}</p>
    <div class="opcoes">
      ${eixo.map(([valor, texto]) => `<button class="opcao" data-escolha="${valor}">${texto}</button>`).join('')}
    </div>`

  for (const botao of tela.querySelectorAll('button.opcao')) {
    botao.addEventListener('click', () => responder(questao, botao.dataset.escolha))
  }

  estado.mostradaEm = Date.now()

  if (questao.eRelampago) {
    fetch('/api/entregar', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ questaoId: questao.id })
    })
    if (questao.comCronometro) iniciarCronometro(questao)
  }
}

function iniciarCronometro (questao) {
  const conta = document.getElementById('conta')
  const fim = Date.now() + estado.segundosRelampago * 1000
  const passo = () => {
    const restante = Math.max(0, Math.ceil((fim - Date.now()) / 1000))
    conta.textContent = `${restante}s`
    conta.classList.toggle('apertado', restante <= 3)
    if (restante === 0) {
      pararCronometro()
      // Manda a escolha do eixo; o servidor decide se estourou. Ele é a autoridade.
      responder(questao, 'confio')
    }
  }
  passo()
  estado.cronometro = setInterval(passo, 200)
}

function desenharResultado () {
  const r = estado.resultado
  tela.innerHTML = `
    <div class="centrado">
      <div class="rotulo">${escapar(estado.rotulo)}</div>
      <div class="grande">${r.acertos} de ${r.total}</div>
      <p class="secundario">Confiar é ótimo. Conferir é obrigatório.</p>
    </div>
    ${r.itens.map(i => `
      <div class="item">
        <div class="veredito ${i.correta ? 'certo' : 'torto'}">${i.correta ? 'Acertou' : 'Escorregou'}</div>
        <p>${escapar(i.texto)}</p>
        <p class="secundario">${escapar(i.explicacao)}</p>
      </div>`).join('')}`
}

async function desenhar () {
  pararCronometro()

  if (estado.fase === 'espera') {
    tela.innerHTML = `<div class="centrado">
      <div class="rotulo">${escapar(estado.rotulo)}</div>
      <p class="secundario">Você está dentro. Aguarde o início.</p></div>`
    return
  }

  if (estado.fase === 'revelado') {
    if (!estado.resultado) {
      const r = await fetch('/api/meu-resultado')
      if (!r.ok) { tela.innerHTML = '<p class="centrado discreto">Aguarde…</p>'; return }
      estado.resultado = await r.json()
    }
    desenharResultado()
    return
  }

  const questao = pendente()
  if (questao) desenharQuestao(questao)
  else {
    tela.innerHTML = `<div class="centrado">
      <div class="rotulo">${escapar(estado.rotulo)}</div>
      <p class="secundario">Suas respostas foram registradas.<br>Aguarde a revelação.</p></div>`
  }
}

function ouvirEstado () {
  const fonte = new EventSource('/stream')
  fonte.addEventListener('estado', evento => {
    const dados = JSON.parse(evento.data)
    const mudou = dados.fase !== estado.fase
    estado.fase = dados.fase
    estado.segundosRelampago = dados.segundosRelampago
    // Só redesenha na virada de fase: no meio de uma questão, redesenhar
    // reiniciaria o cronômetro e apagaria o clique do participante.
    if (mudou) desenhar()
  })
}

if (await entrar()) { await desenhar(); ouvirEstado() }
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Conferir na tela**

```bash
ADMIN_KEY=teste npm start
```

Em outro terminal, criar a rodada e liberar:

```bash
curl -s -X POST 'localhost:3000/api/painel/rodada?k=teste' \
  -H 'content-type: application/json' -d '{"previsaoParticipantes":45}'
curl -s -X POST 'localhost:3000/api/painel/fase?k=teste' \
  -H 'content-type: application/json' -d '{"fase":"respondendo"}'
```

Abrir `http://localhost:3000/quiz.html` e responder as 5. Confirmar: tela de espera antes de liberar, nenhum feedback de acerto durante, e a tela de "aguarde" ao terminar. Abrir uma segunda aba anônima para virar o Participante #2 e ver o cronômetro de 10s no relâmpago.

- [ ] **Step 8: Commit**

```bash
rtk git add src/publico/comum.css src/publico/quiz.html src/publico/quiz.js testes/frontend.test.js
rtk git commit -m "feat: tela do participante, sem feedback antes da revelação"
```

---

### Task 10: Telão

**Files:**
- Create: `src/publico/telao.html`, `src/publico/telao.js`, `src/publico/telao.css`
- Modify: `testes/frontend.test.js`

**Interfaces:**
- Consumes: `GET /stream/painel` e `GET /api/painel/estado` (Task 8).
- Produces: `GET /telao.html?k=<chave>` — a tela que você compartilha no Zoom. Exporta `montarPassos(agregados)` de `telao.js` para poder ser testada.

- [ ] **Step 1: Escrever os testes que falham**

```js
// acrescentar a testes/frontend.test.js
import { montarPassos, larguraSegmentos } from '../src/publico/telao.js'

const agregadoFalso = (armadilhas = 3) => ({
  fase: 'revelado', passoDebrief: 0,
  conectados: 48, respondendo: 4, finalizados: 44,
  placar: { decisoes: 176, acertos: 132, percentual: 75 },
  porCategoria: [{ categoria: 'sintese de material proprio', total: 40, acertos: 36, percentual: 90 }],
  armadilhas: Array.from({ length: armadilhas }, (_, i) => ({
    id: `Q${i}`, texto: 't', gabarito: 'busca', explicacao: 'e', total: 18, acertos: 6, percentualErro: 67
  })),
  relampago: {
    cronometro: { total: 24, acertos: 12, expirados: 3, percentual: 50 },
    controle: { total: 24, acertos: 19, expirados: 0, percentual: 79 }
  }
})

test('o debrief tem placar, categorias, uma tela por armadilha, o A/B e o fechamento', () => {
  const passos = montarPassos(agregadoFalso(3))
  assert.deepEqual(passos.map(p => p.tipo),
    ['placar', 'categorias', 'armadilha', 'armadilha', 'armadilha', 'relampago', 'fechamento'])
})

test('sem armadilhas suficientes o debrief encurta sozinho', () => {
  assert.deepEqual(montarPassos(agregadoFalso(0)).map(p => p.tipo),
    ['placar', 'categorias', 'relampago', 'fechamento'])
})

test('os segmentos da barra somam 100% e o vão nunca some', () => {
  const larguras = larguraSegmentos([{ valor: 12 }, { valor: 5 }, { valor: 1 }])
  assert.equal(Math.round(larguras.reduce((s, l) => s + l, 0)), 100)
  assert.ok(larguras.every(l => l > 0))
})

test('barra com um segmento só ocupa a largura inteira', () => {
  assert.deepEqual(larguraSegmentos([{ valor: 9 }]), [100])
})

test('barra sem dado nenhum não vira NaN', () => {
  assert.deepEqual(larguraSegmentos([]), [])
  assert.deepEqual(larguraSegmentos([{ valor: 0 }, { valor: 0 }]), [0, 0])
})

test('o telão não embute a chave do painel no código', () => {
  const fonte = ler('telao.js') + ler('telao.html')
  assert.ok(!/ADMIN_KEY|chave-de-teste/.test(fonte), 'a chave deve vir da URL, nunca embutida')
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `ENOENT: src/publico/telao.js`

- [ ] **Step 3: Escrever `src/publico/telao.css`**

```css
/* src/publico/telao.css — desenhado para projeção via Zoom:
   tipografia grande, poucos elementos, alto contraste. */
body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 4vh 5vw; }
main { width: 100%; max-width: 1400px; }

h1 { font-size: clamp(28px, 3.4vw, 52px); margin: 0 0 8px; font-weight: 700; }
.legenda-tela { font-size: clamp(16px, 1.5vw, 24px); color: var(--tinta-2); margin: 0 0 40px; }

.contadores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.contador { background: var(--superficie); border-radius: var(--raio); padding: 32px; text-align: center; }
.contador .valor { font-size: clamp(48px, 7vw, 104px); font-weight: 700; line-height: 1; }
.contador .nome { font-size: clamp(14px, 1.2vw, 20px); color: var(--tinta-3);
                  text-transform: uppercase; letter-spacing: .08em; margin-top: 12px; }

.heroi { font-size: clamp(96px, 18vw, 260px); font-weight: 700; line-height: 1; text-align: center; }
.heroi-nota { text-align: center; font-size: clamp(18px, 2vw, 32px); color: var(--tinta-2); }

.linhas { display: grid; gap: 18px; margin: 32px 0; }
.linha { display: grid; grid-template-columns: minmax(200px, 26%) 1fr 90px; gap: 20px; align-items: center; }
.linha .nome { font-size: clamp(15px, 1.4vw, 22px); color: var(--tinta-2); }
.linha .n { font-size: clamp(13px, 1.1vw, 18px); color: var(--tinta-3);
            text-align: right; font-variant-numeric: tabular-nums; }
.linha .barra { height: clamp(32px, 4vw, 52px); }
.linha .seg { font-size: clamp(13px, 1.2vw, 19px); }

.enunciado-grande { font-size: clamp(22px, 2.6vw, 40px); line-height: 1.35; margin: 0 0 28px; }
.regra { font-size: clamp(16px, 1.7vw, 26px); color: var(--tinta-2); border-left: 3px solid var(--acerto);
         padding-left: 20px; margin-top: 28px; }

.entrada { text-align: center; }
.entrada .url { font-size: clamp(30px, 4.5vw, 68px); font-weight: 700; word-break: break-all; }

.fechamento { text-align: center; font-size: clamp(32px, 5vw, 78px); font-weight: 700; line-height: 1.25; }
.fechamento em { font-style: normal; color: var(--acerto); }
```

- [ ] **Step 4: Escrever `src/publico/telao.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confere ou Confia? — Resultados</title>
  <link rel="stylesheet" href="/comum.css">
  <link rel="stylesheet" href="/telao.css">
</head>
<body>
  <main id="tela"><p class="legenda-tela">Conectando…</p></main>
  <script type="module" src="/telao.js"></script>
</body>
</html>
```

- [ ] **Step 5: Escrever `src/publico/telao.js`**

```js
// src/publico/telao.js
const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// A régua de largura: um segmento com valor > 0 nunca desaparece da barra.
export function larguraSegmentos (segmentos) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0)
  if (total === 0) return segmentos.map(() => 0)
  return segmentos.map(s => (s.valor / total) * 100)
}

export function montarPassos (ag) {
  return [
    { tipo: 'placar' },
    { tipo: 'categorias' },
    ...ag.armadilhas.map((_, indice) => ({ tipo: 'armadilha', indice })),
    { tipo: 'relampago' },
    { tipo: 'fechamento' }
  ]
}

const LEGENDA = `<div class="legenda">
  <span><i class="amostra acerto"></i>Acertou</span>
  <span><i class="amostra erro"></i>Escorregou</span>
  <span><i class="amostra expirou"></i>Não respondeu a tempo</span>
</div>`

// Rótulo direto só onde cabe: abaixo de 12% o texto encavalaria.
const LIMIAR_ROTULO = 12

function barra (segmentos) {
  const larguras = larguraSegmentos(segmentos)
  const pedacos = segmentos.map((s, i) => {
    if (segmentos[i].valor === 0) return ''
    const rotulo = larguras[i] >= LIMIAR_ROTULO ? `<span>${escapar(s.rotulo)}</span>` : ''
    return `<div class="seg ${s.classe}" style="flex: 0 0 ${larguras[i]}%">${rotulo}</div>`
  })
  return `<div class="barra">${pedacos.join('')}</div>`
}

function linha (nome, segmentos, n) {
  return `<div class="linha">
    <div class="nome">${escapar(nome)}</div>
    ${barra(segmentos)}
    <div class="n">n=${n}</div>
  </div>`
}

const fatias = (acertos, erros, expirados = 0) => ([
  { classe: 'acerto', valor: acertos, rotulo: `${acertos}` },
  { classe: 'erro', valor: erros, rotulo: `${erros}` },
  { classe: 'expirou', valor: expirados, rotulo: `${expirados}` }
])

// ---------- as telas ----------

const telaEspera = ag => `
  <div class="entrada">
    <h1>Confere ou Confia?</h1>
    <p class="legenda-tela">Abra o link que está no chat do Zoom</p>
    <div class="url">${escapar(location.host)}/quiz.html</div>
    <div class="contadores" style="margin-top:56px">
      <div class="contador"><div class="valor">${ag.conectados}</div><div class="nome">conectados</div></div>
    </div>
  </div>`

const telaRespondendo = ag => `
  <h1>Respondendo</h1>
  <p class="legenda-tela">Ninguém vê resultado ainda — nem eu.</p>
  <div class="contadores">
    <div class="contador"><div class="valor">${ag.conectados}</div><div class="nome">conectados</div></div>
    <div class="contador"><div class="valor">${ag.respondendo}</div><div class="nome">respondendo</div></div>
    <div class="contador"><div class="valor">${ag.finalizados}</div><div class="nome">finalizados</div></div>
  </div>`

const telaPlacar = ag => `
  <h1>O resultado da sala</h1>
  <p class="legenda-tela">${ag.placar.decisoes} decisões, ${ag.finalizados} pessoas</p>
  <div class="heroi" id="heroi">0%</div>
  <p class="heroi-nota">de acerto na escolha entre buscar e redigir</p>`

const telaCategorias = ag => `
  <h1>Onde vocês foram bem, e onde escorregaram</h1>
  <div class="linhas">
    ${ag.porCategoria.map(c =>
      linha(c.categoria, fatias(c.acertos, c.total - c.acertos), c.total)).join('')}
  </div>
  ${LEGENDA}`

function telaArmadilha (ag, indice) {
  const a = ag.armadilhas[indice]
  const certo = a.gabarito === 'busca' ? '🔎 Isso era BUSCA' : '✍️ Isso era REDAÇÃO'
  return `
    <h1>${a.percentualErro}% escorregou aqui</h1>
    <p class="enunciado-grande">${escapar(a.texto)}</p>
    <div class="linhas">${linha(certo, fatias(a.acertos, a.total - a.acertos), a.total)}</div>
    ${LEGENDA}
    <p class="regra">${escapar(a.explicacao)}</p>`
}

const telaRelampago = ag => `
  <h1>A pergunta relâmpago</h1>
  <p class="legenda-tela">A mesma pergunta. A única diferença foi o cronômetro.</p>
  <div class="linhas">
    ${linha('Com 10 segundos',
      fatias(ag.relampago.cronometro.acertos,
             ag.relampago.cronometro.total - ag.relampago.cronometro.acertos - ag.relampago.cronometro.expirados,
             ag.relampago.cronometro.expirados), ag.relampago.cronometro.total)}
    ${linha('Sem cronômetro',
      fatias(ag.relampago.controle.acertos,
             ag.relampago.controle.total - ag.relampago.controle.acertos - ag.relampago.controle.expirados,
             ag.relampago.controle.expirados), ag.relampago.controle.total)}
  </div>
  ${LEGENDA}
  <p class="regra">Se veio com link, abra o link. São trinta segundos.</p>`

const telaFechamento = () => `
  <div class="fechamento">O Google busca.<br>A IA redige.<br><br>
    Confiar é ótimo.<br><em>Conferir é obrigatório.</em></div>`

// Sobe o número em vez de estampá-lo: é o momento da revelação.
function animarHeroi(alvo) {
  const no = document.getElementById('heroi')
  if (!no) return
  const inicio = performance.now()
  const duracao = 1400
  const passo = agora => {
    const t = Math.min(1, (agora - inicio) / duracao)
    const suave = 1 - Math.pow(1 - t, 3)
    no.textContent = `${Math.round(alvo * suave)}%`
    if (t < 1) requestAnimationFrame(passo)
  }
  requestAnimationFrame(passo)
}

function desenhar (ag) {
  const tela = document.getElementById('tela')
  if (ag.fase === 'espera') { tela.innerHTML = telaEspera(ag); return }
  if (ag.fase === 'respondendo') { tela.innerHTML = telaRespondendo(ag); return }

  const passos = montarPassos(ag)
  const passo = passos[Math.min(ag.passoDebrief, passos.length - 1)]
  const desenhos = {
    placar: () => telaPlacar(ag),
    categorias: () => telaCategorias(ag),
    armadilha: () => telaArmadilha(ag, passo.indice),
    relampago: () => telaRelampago(ag),
    fechamento: () => telaFechamento()
  }
  tela.innerHTML = desenhos[passo.tipo]()
  if (passo.tipo === 'placar') animarHeroi(ag.placar.percentual)
}

// Este módulo é importado em três contextos: pelo telão (que desenha), pelo
// painel (que só quer `montarPassos`) e pelos testes (onde não há `document`).
// Só o telão tem `#tela` — é o que autoriza abrir o EventSource daqui.
const raiz = typeof document !== 'undefined' && document.getElementById('tela')
if (raiz) {
  const chave = new URLSearchParams(location.search).get('k') ?? ''
  let ultimoPasso = null
  const fonte = new EventSource(`/stream/painel?k=${encodeURIComponent(chave)}`)
  fonte.addEventListener('estado', evento => {
    const ag = JSON.parse(evento.data)
    // Redesenhar o placar a cada evento reiniciaria a animação do número.
    const assinatura = `${ag.fase}:${ag.passoDebrief}`
    const mudouDePasso = assinatura !== ultimoPasso
    ultimoPasso = assinatura
    if (ag.fase === 'revelado' && !mudouDePasso) return
    desenhar(ag)
  })
  fonte.onerror = () => { raiz.innerHTML = '<p class="legenda-tela">Reconectando…</p>' }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Conferir na tela, do jeito que vai ser projetado**

Com o servidor no ar e uma rodada respondida por 3 abas anônimas, abrir
`http://localhost:3000/telao.html?k=teste` e percorrer os passos:

```bash
curl -s -X POST 'localhost:3000/api/painel/fase?k=teste' -H 'content-type: application/json' -d '{"fase":"revelado"}'
for p in 0 1 2 3 4 5 6; do
  curl -s -X POST "localhost:3000/api/painel/debrief?k=teste" -H 'content-type: application/json' -d "{\"passo\":$p}"
  sleep 2
done
```

Conferir com a janela em 1280×720 (o tamanho típico do compartilhamento no Zoom): nenhum rótulo encavalado, nenhuma barra estourando a linha, nada exigindo rolagem horizontal, e o número do placar subindo.

- [ ] **Step 8: Commit**

```bash
rtk git add src/publico/telao.html src/publico/telao.css src/publico/telao.js testes/frontend.test.js
rtk git commit -m "feat: telão com o arco de revelação e barras validadas para daltonismo"
```

---

### Task 11: Painel de controle

**Files:**
- Create: `src/publico/painel.html`, `src/publico/painel.js`
- Modify: `testes/frontend.test.js`

**Interfaces:**
- Consumes: as rotas do painel da Task 8, `montarPassos` da Task 10.
- Produces: `GET /painel.html?k=<chave>` — a tela que fica na sua segunda tela, nunca compartilhada.

- [ ] **Step 1: Escrever os testes que falham**

```js
// acrescentar a testes/frontend.test.js
test('o painel prevê o número de questões antes de criar a rodada', async () => {
  const { calcularQuestoesAtivas } = await import('../src/distribuicao.js')
  const fonte = ler('painel.js')
  assert.match(fonte, /calcularQuestoesAtivas|\/api\/painel\/previsao/,
    'o painel precisa mostrar a previsão antes de confirmar')
  assert.equal(calcularQuestoesAtivas(45), 10)
})

test('o painel avisa que não deve ser compartilhado', () => {
  assert.match(ler('painel.html'), /não compartilhe|nao compartilhe/i)
})
```

- [ ] **Step 2: Rodar para confirmar que falham**

Run: `npm test`
Expected: FAIL — `ENOENT: src/publico/painel.html`

- [ ] **Step 3: Escrever `src/publico/painel.html`**

```html
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Painel — Confere ou Confia?</title>
  <link rel="stylesheet" href="/comum.css">
  <style>
    body { padding: 24px; }
    main { max-width: 760px; margin: 0 auto; display: grid; gap: 20px; }
    .aviso { background: var(--erro); color: var(--plano); padding: 12px 16px;
             border-radius: var(--raio); font-weight: 700; }
    .linha-botoes { display: flex; gap: 10px; flex-wrap: wrap; }
    button { font-family: var(--fonte); font-size: 15px; font-weight: 600; padding: 12px 18px;
             border-radius: 10px; border: 1px solid var(--grade); background: var(--superficie);
             color: var(--tinta); cursor: pointer; }
    button.destaque { background: var(--acerto); border-color: var(--acerto); color: var(--plano); }
    button.perigo { border-color: var(--erro); color: var(--erro); }
    button:disabled { opacity: .4; cursor: default; }
    input { font-family: var(--fonte); font-size: 15px; padding: 12px; width: 110px;
            border-radius: 10px; border: 1px solid var(--grade);
            background: var(--plano); color: var(--tinta); }
    .numeros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; }
    .numeros div span { display: block; font-size: 34px; font-weight: 700; }
    .numeros div small { color: var(--tinta-3); text-transform: uppercase; letter-spacing: .06em; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em;
         color: var(--tinta-3); margin: 0 0 12px; }
  </style>
</head>
<body>
  <main>
    <div class="aviso">Esta é a sua tela. Não compartilhe no Zoom — compartilhe o telão.</div>

    <section class="cartao">
      <h2>1 · Preparar a rodada</h2>
      <div class="linha-botoes">
        <label>Previsão de participantes
          <input id="previsao" type="number" min="1" max="200" value="45"></label>
        <label>Cronômetro (s)
          <input id="segundos" type="number" min="3" max="60" value="10"></label>
      </div>
      <p class="secundario" id="previsaoTexto"></p>
      <div class="linha-botoes">
        <button id="criar" class="destaque">Criar rodada</button>
      </div>
    </section>

    <section class="cartao">
      <h2>2 · Conduzir</h2>
      <div class="numeros">
        <div><span id="nConectados">0</span><small>conectados</small></div>
        <div><span id="nRespondendo">0</span><small>respondendo</small></div>
        <div><span id="nFinalizados">0</span><small>finalizados</small></div>
      </div>
      <p class="secundario">Fase: <strong id="fase">—</strong></p>
      <div class="linha-botoes">
        <button id="liberar" class="destaque">Liberar o início</button>
        <button id="entradas">Fechar entradas</button>
        <button id="revelar" class="destaque">REVELAR</button>
      </div>
    </section>

    <section class="cartao">
      <h2>3 · Debrief</h2>
      <p class="secundario" id="passoTexto">—</p>
      <div class="linha-botoes">
        <button id="voltar">← Voltar</button>
        <button id="avancar" class="destaque">Avançar →</button>
      </div>
    </section>

    <section class="cartao">
      <h2>Ensaio</h2>
      <div class="linha-botoes">
        <button id="zerar" class="perigo">Zerar rodada</button>
        <a href="#" id="linkTelao" target="_blank"><button>Abrir telão</button></a>
      </div>
    </section>
  </main>
  <script type="module" src="/painel.js"></script>
</body>
</html>
```

- [ ] **Step 4: Escrever `src/publico/painel.js`**

```js
// src/publico/painel.js
import { montarPassos } from '/telao.js'
import { calcularQuestoesAtivas } from '/distribuicao-cliente.js'

const chave = new URLSearchParams(location.search).get('k') ?? ''
const $ = id => document.getElementById(id)
let atual = null

const comChave = rota => `${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(chave)}`

async function enviar (rota, corpo) {
  const r = await fetch(comChave(rota), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {})
  })
  if (!r.ok) alert(`Falhou: ${(await r.json()).erro ?? r.status}`)
  return r
}

function atualizarPrevisao () {
  const p = Number($('previsao').value)
  if (!Number.isInteger(p) || p < 1) { $('previsaoTexto').textContent = ''; return }
  const k = calcularQuestoesAtivas(p)
  $('previsaoTexto').textContent =
    `${k} questões em jogo — cerca de ${Math.round((p * 4) / k)} respostas por questão.`
}

const NOME_DO_PASSO = {
  placar: 'Placar global', categorias: 'Acertos por categoria',
  armadilha: 'Armadilha', relampago: 'A/B do relâmpago', fechamento: 'Fechamento'
}

function desenhar (ag) {
  atual = ag
  $('nConectados').textContent = ag.conectados
  $('nRespondendo').textContent = ag.respondendo
  $('nFinalizados').textContent = ag.finalizados
  $('fase').textContent = ag.fase
  $('entradas').textContent = ag.entradasAbertas === false ? 'Abrir entradas' : 'Fechar entradas'

  const passos = montarPassos(ag)
  const indice = Math.min(ag.passoDebrief, passos.length - 1)
  const passo = passos[indice]
  $('passoTexto').textContent = ag.fase === 'revelado'
    ? `${indice + 1} de ${passos.length} — ${NOME_DO_PASSO[passo.tipo]}${passo.indice != null ? ` ${passo.indice + 1}` : ''}`
    : 'Disponível depois de revelar'
  $('voltar').disabled = ag.fase !== 'revelado' || indice === 0
  $('avancar').disabled = ag.fase !== 'revelado' || indice >= passos.length - 1
}

$('previsao').addEventListener('input', atualizarPrevisao)

$('criar').addEventListener('click', async () => {
  if (!confirm('Criar uma rodada nova? A anterior sai de cena.')) return
  const r = await enviar('/api/painel/rodada', {
    previsaoParticipantes: Number($('previsao').value),
    segundosRelampago: Number($('segundos').value)
  })
  if (r.ok) alert(`Rodada criada com ${(await r.json()).numQuestoesAtivas} questões.`)
})

$('liberar').addEventListener('click', () => enviar('/api/painel/fase', { fase: 'respondendo' }))
$('entradas').addEventListener('click', () =>
  enviar('/api/painel/entradas', { abertas: atual?.entradasAbertas === false }))
$('revelar').addEventListener('click', () => {
  if (confirm('Revelar o resultado para todo mundo?')) enviar('/api/painel/fase', { fase: 'revelado' })
})
$('avancar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: (atual?.passoDebrief ?? 0) + 1 }))
$('voltar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: Math.max(0, (atual?.passoDebrief ?? 0) - 1) }))
$('zerar').addEventListener('click', () => {
  if (confirm('Apagar todas as respostas desta rodada?')) enviar('/api/painel/zerar')
})

$('linkTelao').href = comChave('/telao.html')
atualizarPrevisao()

const fonte = new EventSource(comChave('/stream/painel'))
fonte.addEventListener('estado', evento => desenhar(JSON.parse(evento.data)))
```

- [ ] **Step 5: Expor `calcularQuestoesAtivas` para o navegador**

O painel precisa da mesma fórmula do servidor. Duplicá-la abriria espaço para as
duas divergirem, então o servidor entrega o próprio módulo como estático.

Acrescentar em `src/servidor.js`, junto ao registro do `fastifyStatic`:

```js
  // O painel importa a mesma fórmula que o servidor usa. Uma fonte só.
  app.get('/distribuicao-cliente.js', (req, reply) => {
    reply.type('application/javascript')
    return fs.readFileSync(path.join(path.dirname(PASTA_PUBLICA), 'distribuicao.js'), 'utf8')
  })
```

E no topo do arquivo: `import fs from 'node:fs'`.

- [ ] **Step 6: Rodar os testes**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Ensaiar o fluxo inteiro à mão**

Abrir `http://localhost:3000/painel.html?k=teste`. Criar rodada com previsão 45
(deve dizer "10 questões em jogo"), liberar, responder em duas abas anônimas,
revelar, e percorrer o debrief do começo ao fim com os botões. Confirmar que o
telão numa terceira janela acompanha cada clique.

- [ ] **Step 8: Commit**

```bash
rtk git add src/publico/painel.html src/publico/painel.js src/servidor.js testes/frontend.test.js
rtk git commit -m "feat: painel de controle com previsão, condução e debrief"
```

---

### Task 12: Carga de 50 participantes simultâneos

**Files:**
- Create: `testes/carga.test.js`

**Interfaces:**
- Consumes: `criarServidor` (Tasks 7-8).
- Produces: nenhuma API nova. Prova que o sistema aguenta a reunião real.

- [ ] **Step 1: Escrever o teste de carga**

```js
// testes/carga.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarServidor } from '../src/servidor.js'
import { criarRodada, definirFase } from '../src/rodada.js'
import { calcularAgregados } from '../src/agregados.js'

test('50 participantes simultâneos respondem sem perder nem duplicar resposta', async t => {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 50 })
  definirFase(db, rodada.id, 'respondendo')
  const { app } = criarServidor(db, { adminKey: 'k' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  t.after(() => app.close())
  const base = `http://127.0.0.1:${app.server.address().port}`

  async function umParticipante (n) {
    const entrada = await fetch(`${base}/api/entrar`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })
    const cookie = entrada.headers.getSetCookie().find(c => c.startsWith('pt=')).split(';')[0]
    const { questoes } = await entrada.json()
    assert.equal(questoes.length, 5, `participante ${n} não recebeu 5 questões`)

    for (const q of questoes) {
      const escolha = q.eRelampago ? 'confiro' : (n % 2 ? 'busca' : 'redacao')
      const r = await fetch(`${base}/api/responder`, {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ questaoId: q.id, escolha, msParaResponder: 1000 })
      })
      assert.equal(r.status, 200, `participante ${n} falhou em ${q.id}`)
    }
    return cookie
  }

  const cookies = await Promise.all(Array.from({ length: 50 }, (_, n) => umParticipante(n)))

  const ag = calcularAgregados(db, rodada.id)
  assert.equal(ag.conectados, 50)
  assert.equal(ag.finalizados, 50)
  assert.equal(ag.placar.decisoes, 200)
  assert.equal(ag.relampago.cronometro.total + ag.relampago.controle.total, 50)
  assert.equal(ag.relampago.cronometro.total, 25)

  // Cada questão ativa recebeu uma fatia parecida do bolo.
  const usos = db.prepare(`
    SELECT q.gabarito, COUNT(*) c FROM resposta r
    JOIN questao q ON q.id = r.questao_id
    WHERE q.e_relampago = 0 GROUP BY r.questao_id
  `).all()
  for (const gabarito of ['busca', 'redacao']) {
    const c = usos.filter(u => u.gabarito === gabarito).map(u => u.c)
    assert.ok(Math.max(...c) - Math.min(...c) <= 1, `${gabarito}: ${c.join(',')}`)
  }

  // A trava resiste a uma rajada de reenvios concorrentes.
  const alvo = (await (await fetch(`${base}/api/entrar`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies[0] }, body: '{}'
  })).json()).questoes[0]
  await Promise.all(Array.from({ length: 20 }, () =>
    fetch(`${base}/api/responder`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookies[0] },
      body: JSON.stringify({ questaoId: alvo.id, escolha: 'busca' })
    })))
  assert.equal(calcularAgregados(db, rodada.id).placar.decisoes, 200, 'a trava deixou passar resposta extra')
})
```

- [ ] **Step 2: Rodar**

Run: `npm test -- --test-name-pattern=simultâneos`
Expected: PASS. Se falhar por tempo, aumentar o timeout do teste — nunca afrouxar a asserção de contagem.

- [ ] **Step 3: Commit**

```bash
rtk git add testes/carga.test.js
rtk git commit -m "test: 50 participantes simultâneos com verificação da trava sob concorrência"
```

---

### Task 13: Empacotamento e subida no VPS

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `LEIAME.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `npm start` (Task 7).
- Produces: a stack pronta para `docker compose up -d` no VPS, com TLS automático no domínio.

- [ ] **Step 1: Escrever o `Dockerfile`**

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
# better-sqlite3 compila binding nativo na instalação.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY dados/questoes.json ./dados/questoes.json
ENV NODE_ENV=production PORT=3000 DB_PATH=/dados/confere.sqlite
EXPOSE 3000
CMD ["node", "src/servidor.js"]
```

- [ ] **Step 2: Escrever `docker-compose.yml` e `Caddyfile`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    environment:
      ADMIN_KEY: ${ADMIN_KEY:?defina ADMIN_KEY no .env}
      DB_PATH: /dados/confere.sqlite
    volumes:
      - dados:/dados

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      DOMINIO: ${DOMINIO:?defina DOMINIO no .env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]

volumes:
  dados:
  caddy_data:
  caddy_config:
```

```caddyfile
{$DOMINIO} {
	encode zstd gzip
	# SSE não pode passar por buffer: o telão precisa dos eventos na hora.
	reverse_proxy app:3000 {
		flush_interval -1
	}
}
```

```bash
# .env.example
DOMINIO=dinamica.seudominio.com.br
ADMIN_KEY=troque-por-uma-chave-longa-e-aleatoria
```

`flush_interval -1` é o detalhe que faz ou quebra a dinâmica: sem ele o Caddy
segura os eventos SSE num buffer e o telão congela.

- [ ] **Step 3: Ajustar o `.gitignore`**

```bash
cat > .gitignore <<'EOF'
node_modules/
dados/*.sqlite
dados/*.sqlite-wal
dados/*.sqlite-shm
.env
EOF
```

- [ ] **Step 4: Escrever o `LEIAME.md` com o roteiro do dia**

````markdown
# Confere ou Confia?

Dinâmica da reunião técnica do LIB. Design em
`docs/superpowers/specs/2026-08-27-confere-ou-confia-design.md`.

## Subir

```bash
cp .env.example .env   # e editar DOMINIO e ADMIN_KEY
docker compose up -d --build
```

## As três telas

| Tela | URL | Quem vê |
|---|---|---|
| Quiz | `https://SEU_DOMINIO/quiz.html` | vai no chat do Zoom |
| Telão | `https://SEU_DOMINIO/telao.html?k=CHAVE` | você compartilha esta |
| Painel | `https://SEU_DOMINIO/painel.html?k=CHAVE` | só você, segunda tela |

## Roteiro do dia

1. Antes de entrar na reunião: abrir o painel, criar a rodada com a previsão de
   participantes, conferir quantas questões entraram em jogo.
2. Compartilhar **o telão** no Zoom. Nunca o painel.
3. Colar o link do quiz no chat. Ver o contador de conectados subir.
4. **Liberar o início.** O telão passa a mostrar só o progresso.
5. Quando os finalizados estabilizarem, **Revelar**.
6. Percorrer o debrief com "Avançar", conversando em cada tela.

## Ensaio

Rodar com 3 ou 4 colegas alguns dias antes, e depois **Zerar rodada** no painel.
Zerar apaga participantes e respostas, mantém as questões em jogo e volta a fase
para espera.
````

- [ ] **Step 5: Verificar a stack de ponta a ponta**

```bash
npm test
docker compose build
DOMINIO=localhost ADMIN_KEY=teste docker compose up -d
sleep 5
curl -sk https://localhost/quiz.html | head -5
docker compose down
```

Expected: os testes passam, a imagem constrói e o `curl` devolve o HTML do quiz.

- [ ] **Step 6: Commit**

```bash
rtk git add Dockerfile docker-compose.yml Caddyfile .env.example LEIAME.md .gitignore
rtk git commit -m "feat: empacotamento Docker com Caddy e roteiro de operação"
```

---

## Cobertura da spec

| Requisito da spec | Onde |
|---|---|
| Eixo binário Busca/Redação | Tasks 1, 5, 9 |
| Banco de 20 questões + relâmpago | Task 1 |
| Dimensionamento pela previsão | Tasks 2, 11 |
| Seleção estratificada com essenciais | Task 2 |
| Rodízio equilibrado, 2/2 por participante | Tasks 3, 4, 12 |
| Grupo A/B alternado | Tasks 3, 4, 12 |
| Retomada por token, sem duplicar | Tasks 4, 7 |
| Trava de resposta no banco | Tasks 1, 5, 7, 12 |
| Cronômetro validado no servidor, expirou ≠ erro | Tasks 5, 9 |
| Sem feedback antes da revelação | Tasks 7, 9 |
| Gabarito nunca no canal do participante | Tasks 4, 7, 9 |
| Três fases, três telas separadas | Tasks 4, 8, 9, 10, 11 |
| Contadores ao vivo sem placar | Tasks 6, 10 |
| Debrief em 5 momentos | Tasks 10, 11 |
| Placar por categoria | Tasks 6, 10 |
| Armadilhas ranqueadas por erro | Tasks 6, 10 |
| A/B do relâmpago | Tasks 6, 10 |
| Zerar rodada para ensaio | Tasks 4, 8, 11 |
| 50 simultâneos | Task 12 |
| Deploy no VPS com TLS | Task 13 |
