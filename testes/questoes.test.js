import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarRodada } from '../src/rodada.js'
import {
  normalizar, validar, listar, salvar, apagar,
  paraCsv, deCsv, analisarCsv, importarCsv, COLUNAS
} from '../src/questoes.js'

const nova = (extra = {}) => ({
  id: 'N1', gabarito: 'busca', categoria: 'teste', texto: 'Um enunciado.', explicacao: 'Uma regra.', ...extra
})

// ---------- validação ----------

test('normalizar aceita sim/não, true/false, 1/0 e x nos booleanos', () => {
  for (const v of ['1', 'sim', 'true', 'x', 'S', 1, true]) assert.equal(normalizar({ essencial: v }).essencial, 1, String(v))
  for (const v of ['0', 'não', 'nao', 'false', '', undefined, 0, false]) assert.equal(normalizar({ essencial: v }).essencial, 0, String(v))
  assert.equal(normalizar({}).ativa, 1, 'ativa é 1 por padrão')
})

test('validar rejeita id inválido, gabarito desconhecido e campos vazios', () => {
  assert.ok(validar(normalizar(nova({ id: 'tem espaço' }))).some(e => /id/.test(e)))
  assert.ok(validar(normalizar(nova({ gabarito: 'talvez' }))).some(e => /gabarito/.test(e)))
  assert.ok(validar(normalizar(nova({ texto: '  ' }))).some(e => /texto/.test(e)))
  assert.deepEqual(validar(normalizar(nova())), [])
})

test('validar amarra o gabarito confiro à relâmpago', () => {
  assert.ok(validar(normalizar(nova({ gabarito: 'confiro' }))).some(e => /relâmpago/.test(e)))
  assert.ok(validar(normalizar(nova({ e_relampago: 1, gabarito: 'busca' }))).some(e => /confiro/.test(e)))
  assert.deepEqual(validar(normalizar(nova({ e_relampago: 1, gabarito: 'confiro' }))), [])
})

// ---------- CRUD ----------

test('salvar cria, edita e recusa criar id repetido', () => {
  const db = abrirBanco(':memory:')
  const r = salvar(db, nova(), { criar: true })
  assert.equal(r.ok, true); assert.equal(r.criada, true)
  assert.equal(listar(db).length, 22)

  assert.equal(salvar(db, nova(), { criar: true }).motivo, 'ja_existe')
  const e = salvar(db, nova({ texto: 'Editado.' }))
  assert.equal(e.ok, true); assert.equal(e.criada, false)
  assert.equal(e.questao.texto, 'Editado.')
  assert.equal(salvar(db, nova({ id: 'ZZ' })).motivo, 'nao_encontrada')
})

test('salvar devolve os erros de validação sem tocar no banco', () => {
  const db = abrirBanco(':memory:')
  const r = salvar(db, nova({ gabarito: 'x' }), { criar: true })
  assert.equal(r.ok, false); assert.equal(r.motivo, 'invalida'); assert.ok(r.erros.length)
  assert.equal(listar(db).length, 21)
})

test('só uma relâmpago ativa: a segunda é recusada até a primeira ser desativada', () => {
  const db = abrirBanco(':memory:')
  const seg = salvar(db, nova({ id: 'REL2', e_relampago: 1, gabarito: 'confiro' }), { criar: true })
  assert.equal(seg.ok, false); assert.match(seg.erros[0], /REL/)
  db.prepare("UPDATE questao SET ativa = 0 WHERE id = 'REL'").run()
  assert.equal(salvar(db, nova({ id: 'REL2', e_relampago: 1, gabarito: 'confiro' }), { criar: true }).ok, true)
})

test('apagar recusa questão usada numa rodada, e sugere desativar', () => {
  const db = abrirBanco(':memory:')
  criarRodada(db, { previsaoParticipantes: 60 })
  const usada = db.prepare('SELECT questao_id id FROM rodada_questao LIMIT 1').get().id
  const r = apagar(db, usada)
  assert.equal(r.ok, false); assert.equal(r.motivo, 'em_uso')
  assert.equal(apagar(db, 'inexistente').motivo, 'nao_encontrada')
  salvar(db, nova(), { criar: true })
  assert.equal(apagar(db, 'N1').ok, true)
})

// ---------- CSV ----------

test('analisarCsv trata aspas, separador dentro de aspas, quebra de linha e aspas dobradas', () => {
  const texto = 'a;b\r\n"um; dois";"diz ""oi""\ne pula"\r\n'
  assert.deepEqual(analisarCsv(texto), [['a', 'b'], ['um; dois', 'diz "oi"\ne pula']])
})

test('analisarCsv detecta vírgula ou ponto e vírgula pela primeira linha', () => {
  assert.deepEqual(analisarCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(analisarCsv('a;b\n1;2\n'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(analisarCsv('"x, y";b\n1;2\n'), [['x, y', 'b'], ['1', '2']], 'vírgula entre aspas não conta')
})

test('paraCsv → deCsv faz a viagem de ida e volta sem perder nada', () => {
  const db = abrirBanco(':memory:')
  const antes = listar(db)
  const csv = paraCsv(antes)
  assert.ok(csv.startsWith('﻿'), 'BOM para o Excel reconhecer UTF-8')
  const { questoes, erros } = deCsv(csv)
  assert.deepEqual(erros, [])
  assert.equal(questoes.length, antes.length)
  for (let i = 0; i < antes.length; i++) {
    for (const c of COLUNAS) assert.equal(String(questoes[i][c]), String(antes[i][c]), `${antes[i].id}.${c}`)
  }
})

test('deCsv aceita colunas em qualquer ordem e recusa cabeçalho incompleto', () => {
  const { questoes } = deCsv('texto;id;gabarito;explicacao\n"t";"Q9";"busca";"e"\n')
  assert.equal(questoes[0].id, 'Q9')
  assert.match(deCsv('id;texto\n"Q9";"t"\n').erros[0], /gabarito/)
})

test('importarCsv é tudo ou nada: uma linha inválida barra o arquivo inteiro', () => {
  const db = abrirBanco(':memory:')
  const csv = paraCsv([
    normalizar(nova({ id: 'I1' })),
    normalizar(nova({ id: 'I2', gabarito: 'nada' })),
    normalizar(nova({ id: 'I1' }))
  ])
  const r = importarCsv(db, csv)
  assert.equal(r.ok, false)
  assert.ok(r.erros.some(e => e.linha === 3 && e.erros.some(x => /gabarito/.test(x))))
  assert.ok(r.erros.some(e => e.linha === 4 && e.erros.some(x => /repetido/.test(x))))
  assert.equal(listar(db).length, 21, 'nada entrou')
})

test('importarCsv insere as novas e atualiza as existentes', () => {
  const db = abrirBanco(':memory:')
  const csv = paraCsv([normalizar(nova({ id: 'I1' })), { ...listar(db)[0], texto: 'Atualizado via CSV.' }])
  const r = importarCsv(db, csv)
  assert.deepEqual(r, { ok: true, inseridas: 1, atualizadas: 1 })
  assert.equal(db.prepare("SELECT texto FROM questao WHERE id = ?").get(listar(db)[0].id).texto, 'Atualizado via CSV.')
})

test('importarCsv com vírgula e booleanos em português funciona', () => {
  const db = abrirBanco(':memory:')
  const csv = 'id,gabarito,categoria,essencial,ativa,texto,explicacao\nV1,redacao,"cat, com vírgula",sim,não,"Texto",Regra\n'
  assert.equal(importarCsv(db, csv).ok, true)
  const q = db.prepare("SELECT * FROM questao WHERE id = 'V1'").get()
  assert.equal(q.categoria, 'cat, com vírgula'); assert.equal(q.essencial, 1); assert.equal(q.ativa, 0)
})

test('importarCsv não deixa duas relâmpagos ativas, nem via arquivo nem contra o banco', () => {
  const db = abrirBanco(':memory:')
  const duas = paraCsv([
    normalizar(nova({ id: 'RA', e_relampago: 1, gabarito: 'confiro' })),
    normalizar(nova({ id: 'RB', e_relampago: 1, gabarito: 'confiro' }))
  ])
  assert.match(importarCsv(db, duas).erros[0].erros[0], /mais de uma/)
  const contraBanco = paraCsv([normalizar(nova({ id: 'RA', e_relampago: 1, gabarito: 'confiro' }))])
  assert.match(importarCsv(db, contraBanco).erros[0].erros[0], /REL/)
})
