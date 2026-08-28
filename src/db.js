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
  segundos_trava         INTEGER NOT NULL DEFAULT 4,
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
