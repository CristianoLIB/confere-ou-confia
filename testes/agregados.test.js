import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarRodada, entrarParticipante, questoesDoParticipante, marcarEntregue, definirFase } from '../src/rodada.js'
import { registrarResposta } from '../src/respostas.js'
import { calcularAgregados } from '../src/agregados.js'

const PASSADO = new Date('2026-08-27T09:00:00Z')

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
    // As normais foram exibidas "há muito tempo" (a trava de armação não
    // atrapalha); a relâmpago é exibida agora, senão o grupo do cronômetro expira.
    for (const q of qs) marcarEntregue(db, participante.id, q.id, q.eRelampago ? new Date() : PASSADO)
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
  const primeira = questoesDoParticipante(db, emAndamento.id)[0]
  marcarEntregue(db, emAndamento.id, primeira.id, PASSADO)
  registrarResposta(db, { participanteId: emAndamento.id, questaoId: primeira.id, escolha: 'busca' })
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
