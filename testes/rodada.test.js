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

test('criar rodada guarda a duração da trava', () => {
  const db = abrirBanco(':memory:')
  assert.equal(criarRodada(db, { previsaoParticipantes: 20 }).segundos_trava, 4)
  assert.equal(criarRodada(db, { previsaoParticipantes: 20, segundosTrava: 3 }).segundos_trava, 3)
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
