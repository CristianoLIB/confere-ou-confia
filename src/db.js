import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CAMINHO_QUESTOES = path.join(RAIZ, 'dados', 'questoes.json')

// A DDL da rodada fica separada porque a migração precisa recriá-la:
// o SQLite não altera um CHECK existente.
const DDL_RODADA = nome => `
CREATE TABLE IF NOT EXISTS ${nome} (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  criada_em              TEXT NOT NULL,
  previsao_participantes INTEGER NOT NULL,
  num_questoes_ativas    INTEGER NOT NULL,
  fase                   TEXT NOT NULL DEFAULT 'espera'
                         CHECK (fase IN ('espera','respondendo','revelado','encerrado')),
  entradas_abertas       INTEGER NOT NULL DEFAULT 1,
  segundos_relampago     INTEGER NOT NULL DEFAULT 10,
  segundos_trava         INTEGER NOT NULL DEFAULT 4,
  titulo                 TEXT NOT NULL DEFAULT 'Confere ou Confia?',
  atalho                 TEXT NOT NULL DEFAULT 'rt',
  no_ar                  INTEGER NOT NULL DEFAULT 1,
  segundos_preparacao    INTEGER NOT NULL DEFAULT 5,   -- sem uso: a tela de preparação saiu
  animacao_relampago     TEXT NOT NULL DEFAULT 'raio',
  passo_debrief          INTEGER NOT NULL DEFAULT 0
);`

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS questao (
  id           TEXT PRIMARY KEY,
  texto        TEXT NOT NULL,
  categoria    TEXT NOT NULL,
  gabarito     TEXT NOT NULL CHECK (gabarito IN ('busca','redacao','confiro')),
  explicacao   TEXT NOT NULL,
  essencial    INTEGER NOT NULL DEFAULT 0,
  e_relampago  INTEGER NOT NULL DEFAULT 0,
  ativa        INTEGER NOT NULL DEFAULT 1
);

${DDL_RODADA('rodada')}

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

// Só insere o que não existe. O JSON é a carga inicial; depois disso quem
// manda no banco é a página de questões — um restart não pode desfazer edições.
export function semear (db, questoes) {
  const inserir = db.prepare(`
    INSERT OR IGNORE INTO questao (id, texto, categoria, gabarito, explicacao, essencial, e_relampago)
    VALUES (@id, @texto, @categoria, @gabarito, @explicacao, @essencial, @e_relampago)
  `)
  const emLote = db.transaction(lista => {
    for (const q of lista) {
      inserir.run({ ...q, essencial: q.essencial ? 1 : 0, e_relampago: q.e_relampago ? 1 : 0 })
    }
  })
  emLote(questoes)
}

// Bancos criados antes destas colunas/fases existirem.
export function migrar (db) {
  const colunas = db.prepare("PRAGMA table_info('questao')").all().map(c => c.name)
  if (!colunas.includes('ativa')) {
    db.exec('ALTER TABLE questao ADD COLUMN ativa INTEGER NOT NULL DEFAULT 1')
  }

  // Colunas novas da rodada. Sem CHECK: o ALTER do SQLite não o aplicaria ao
  // que já existe, e a validação mora em rodada.js, valendo para todo caminho.
  const daRodada = db.prepare("PRAGMA table_info('rodada')").all().map(c => c.name)
  if (daRodada.length && !daRodada.includes('no_ar')) {
    db.exec('ALTER TABLE rodada ADD COLUMN no_ar INTEGER NOT NULL DEFAULT 1')
  }
  if (daRodada.length && !daRodada.includes('atalho')) {
    db.exec("ALTER TABLE rodada ADD COLUMN atalho TEXT NOT NULL DEFAULT 'rt'")
  }
  if (daRodada.length && !daRodada.includes('titulo')) {
    db.exec("ALTER TABLE rodada ADD COLUMN titulo TEXT NOT NULL DEFAULT 'Confere ou Confia?'")
  }
  if (daRodada.length && !daRodada.includes('segundos_preparacao')) {
    db.exec("ALTER TABLE rodada ADD COLUMN segundos_preparacao INTEGER NOT NULL DEFAULT 5")
  }
  if (daRodada.length && !daRodada.includes('animacao_relampago')) {
    db.exec("ALTER TABLE rodada ADD COLUMN animacao_relampago TEXT NOT NULL DEFAULT 'raio'")
  }

  acentuarCategorias(db)

  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rodada'").get()?.sql ?? ''
  if (!ddl.includes("'encerrado'")) {
    // Com foreign_keys ligado, DROP TABLE rodada apagaria os participantes em cascata.
    db.pragma('foreign_keys = OFF')
    db.transaction(() => {
      db.exec(DDL_RODADA('rodada_nova'))
      db.exec(`
        INSERT INTO rodada_nova (id, criada_em, previsao_participantes, num_questoes_ativas,
                                 fase, entradas_abertas, segundos_relampago, segundos_trava, passo_debrief)
        SELECT id, criada_em, previsao_participantes, num_questoes_ativas,
               fase, entradas_abertas, segundos_relampago, segundos_trava, passo_debrief FROM rodada`)
      db.exec('DROP TABLE rodada')
      db.exec('ALTER TABLE rodada_nova RENAME TO rodada')
    })()
    db.pragma('foreign_keys = ON')
  }
}

// As categorias nasceram sem acento e são texto de tela: o telão as mostra
// como estão. Renomear no lugar preserva as respostas já dadas.
const CATEGORIAS_ACENTUADAS = {
  "dado estatistico": "dado estatístico",
  "citacao e fonte": "citação e fonte",
  "sintese de material proprio": "síntese de material próprio",
  "adaptacao de linguagem": "adaptação de linguagem",
  "geracao de ideias": "geração de ideias",
  "relampago": "relâmpago"
}

function acentuarCategorias (db) {
  const renomear = db.prepare('UPDATE questao SET categoria = ? WHERE categoria = ?')
  for (const [velho, novo] of Object.entries(CATEGORIAS_ACENTUADAS)) renomear.run(novo, velho)
}

export function abrirBanco (caminho = process.env.DB_PATH || path.join(RAIZ, 'dados', 'confere.sqlite')) {
  if (caminho !== ':memory:') fs.mkdirSync(path.dirname(caminho), { recursive: true })
  const db = new Database(caminho)
  if (caminho !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(ESQUEMA)
  migrar(db)
  semear(db, JSON.parse(fs.readFileSync(CAMINHO_QUESTOES, 'utf8')))
  return db
}
