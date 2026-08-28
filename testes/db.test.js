import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { abrirBanco, semear, migrar } from '../src/db.js'

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
  const questoes = db.prepare('SELECT * FROM questao').all()
  // Semear de novo por cima do mesmo banco: o ON CONFLICT precisa segurar.
  semear(db, questoes)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM questao').get().c, antes)
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

test('semear não sobrescreve uma questão editada pela interface', () => {
  const db = abrirBanco(':memory:')
  db.prepare("UPDATE questao SET texto = 'editado' WHERE id = 'B1'").run()
  semear(db, [{ id: 'B1', texto: 'do json', categoria: 'x', gabarito: 'busca', explicacao: 'e', essencial: 1, e_relampago: 0 }])
  assert.equal(db.prepare("SELECT texto FROM questao WHERE id = 'B1'").get().texto, 'editado')
})

test('toda questão nasce ativa', () => {
  const db = abrirBanco(':memory:')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM questao WHERE ativa = 1').get().c, 21)
})

test('a fase encerrado é aceita pelo banco', () => {
  const db = abrirBanco(':memory:')
  db.prepare("INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas, fase) VALUES ('x', 1, 6, 'encerrado')").run()
  assert.equal(db.prepare('SELECT fase FROM rodada').get().fase, 'encerrado')
})

test('migrar: banco antigo ganha a coluna ativa e a fase encerrado sem perder participantes', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  // Esquema como era no primeiro deploy: sem `ativa`, três fases.
  db.exec(`
    CREATE TABLE questao (id TEXT PRIMARY KEY, texto TEXT NOT NULL, categoria TEXT NOT NULL,
      gabarito TEXT NOT NULL, explicacao TEXT NOT NULL, essencial INTEGER NOT NULL DEFAULT 0,
      e_relampago INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE rodada (id INTEGER PRIMARY KEY AUTOINCREMENT, criada_em TEXT NOT NULL,
      previsao_participantes INTEGER NOT NULL, num_questoes_ativas INTEGER NOT NULL,
      fase TEXT NOT NULL DEFAULT 'espera' CHECK (fase IN ('espera','respondendo','revelado')),
      entradas_abertas INTEGER NOT NULL DEFAULT 1, segundos_relampago INTEGER NOT NULL DEFAULT 10,
      segundos_trava INTEGER NOT NULL DEFAULT 4, passo_debrief INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE participante (id INTEGER PRIMARY KEY AUTOINCREMENT,
      rodada_id INTEGER NOT NULL REFERENCES rodada(id) ON DELETE CASCADE, token TEXT NOT NULL);
    INSERT INTO questao VALUES ('Q1', 't', 'c', 'busca', 'e', 0, 0);
    INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas, fase) VALUES ('x', 10, 6, 'revelado');
    INSERT INTO participante (rodada_id, token) VALUES (1, 'tok');
  `)
  migrar(db)
  assert.equal(db.prepare("SELECT ativa FROM questao WHERE id = 'Q1'").get().ativa, 1)
  assert.equal(db.prepare('SELECT fase FROM rodada WHERE id = 1').get().fase, 'revelado', 'os dados da rodada sobrevivem')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM participante').get().c, 1, 'o participante sobrevive')
  db.prepare("UPDATE rodada SET fase = 'encerrado' WHERE id = 1").run()
  assert.equal(db.prepare('SELECT fase FROM rodada WHERE id = 1').get().fase, 'encerrado')
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'as chaves estrangeiras voltam a ficar ligadas')
})

test('migrar é idempotente', () => {
  const db = abrirBanco(':memory:')
  migrar(db); migrar(db)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM questao').get().c, 21)
})
