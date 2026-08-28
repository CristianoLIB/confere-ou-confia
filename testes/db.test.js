import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco, semear } from '../src/db.js'

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
