import test from 'node:test'
import assert from 'node:assert/strict'
import { abrirBanco } from '../src/db.js'
import { criarRodada, entrarParticipante, questoesDoParticipante, marcarEntregue, definirFase } from '../src/rodada.js'
import { registrarResposta, marcarFinalizadoSeCompleto, resultadoPessoal } from '../src/respostas.js'

// Cada cenário entrega todas as questões "há muito tempo", para os testes que
// não são sobre a trava de armação não esbarrarem nela.
const PASSADO = new Date('2026-08-27T09:00:00Z')

function cenario (grupoDesejado = 'controle', { segundosTrava = 4 } = {}) {
  const db = abrirBanco(':memory:')
  const rodada = criarRodada(db, { previsaoParticipantes: 45, segundosRelampago: 10, segundosTrava })
  definirFase(db, rodada.id, 'respondendo')
  // ordem ímpar = controle, par = cronometro
  const token = grupoDesejado === 'controle' ? 'tok-1' : 'tok-2'
  if (grupoDesejado === 'cronometro') entrarParticipante(db, rodada.id, 'tok-1')
  const { participante } = entrarParticipante(db, rodada.id, token)
  const questoes = questoesDoParticipante(db, participante.id)
  for (const q of questoes) marcarEntregue(db, participante.id, q.id, PASSADO)
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

test('ENCERRAMENTO SILENCIOSO: revelar não derruba quem está no meio das perguntas', () => {
  const { db, rodada, participante, questoes } = cenario()
  definirFase(db, rodada.id, 'revelado')
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: questoes[0].id, escolha: 'busca' })
  assert.equal(r.registrado, true, 'o telão vai para o debrief, mas ela termina em paz')
})

test('ENCERRAMENTO SILENCIOSO: o fechamento do debrief corta em definitivo', () => {
  const { db, rodada, participante, questoes } = cenario()
  definirFase(db, rodada.id, 'revelado')
  // Sem ninguém finalizado não há armadilhas: o debrief tem 4 passos.
  db.prepare('UPDATE rodada SET passo_debrief = 3 WHERE id = ?').run(rodada.id)
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: questoes[0].id, escolha: 'busca' })
  assert.equal(r.registrado, false)
  assert.equal(r.motivo, 'fase_invalida')
})

test('encerrar para todos também recusa resposta', () => {
  const { db, rodada, participante, questoes } = cenario()
  definirFase(db, rodada.id, 'encerrado')
  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: questoes[0].id, escolha: 'busca' }).motivo, 'fase_invalida')
})

test('quem não respondeu não escorregou: o resultado distingue os dois', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id) })
  const r = resultadoPessoal(db, participante.id)
  const respondida = r.itens.find(i => i.id === q.id)
  const emBranco = r.itens.find(i => i.id !== q.id)
  assert.equal(respondida.semResposta, false)
  assert.equal(emBranco.semResposta, true, 'sem escolha é ausência, não erro')
  assert.equal(emBranco.correta, false)
})

test('rejeita escolha do eixo errado', () => {
  const { db, participante, questoes } = cenario()
  const normal = questoes[0]
  const relampago = questoes[4]
  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: normal.id, escolha: 'confio' }).motivo, 'escolha_invalida')
  assert.equal(registrarResposta(db, { participanteId: participante.id, questaoId: relampago.id, escolha: 'busca' }).motivo, 'escolha_invalida')
})

// ---------- trava de armação ----------

test('A TRAVA DE ARMAÇÃO: resposta antes do prazo é recusada e nada é gravado', () => {
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  const apareceu = new Date('2026-08-27T10:00:00Z')
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(apareceu.toISOString(), participante.id, q.id)

  const cedo = registrarResposta(db, {
    participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id),
    agora: new Date(apareceu.getTime() + 2_000)
  })
  assert.equal(cedo.registrado, false)
  assert.equal(cedo.motivo, 'cedo_demais')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM resposta').get().c, 0)

  const noPrazo = registrarResposta(db, {
    participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id),
    agora: new Date(apareceu.getTime() + 4_100)
  })
  assert.equal(noPrazo.registrado, true)
  assert.equal(db.prepare('SELECT correta FROM resposta').get().correta, 1)
})

test('a trava não se aplica ao relâmpago: 4s dos 10 matariam a pergunta', () => {
  const { db, participante, questoes } = cenario('cronometro')
  const rel = questoes[4]
  const apareceu = new Date('2026-08-27T10:00:00Z')
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(apareceu.toISOString(), participante.id, rel.id)
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: rel.id, escolha: 'confiro',
    agora: new Date(apareceu.getTime() + 1_500)
  })
  assert.equal(r.registrado, true)
  assert.equal(r.escolhaGravada, 'confiro')
})

test('questão nunca exibida não aceita resposta: sem entregue_em é cedo demais', () => {
  // Fecha a brecha: quem pula o /api/entregar não pode responder na hora.
  const { db, participante, questoes, gabaritoDe } = cenario()
  const q = questoes[0]
  db.prepare('UPDATE atribuicao SET entregue_em = NULL WHERE participante_id = ? AND questao_id = ?')
    .run(participante.id, q.id)
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id) })
  assert.equal(r.registrado, false)
  assert.equal(r.motivo, 'cedo_demais')
})

test('trava de zero segundos libera na hora (para ensaios e carga)', () => {
  const { db, participante, questoes, gabaritoDe } = cenario('controle', { segundosTrava: 0 })
  const q = questoes[0]
  const agora = new Date()
  marcarEntregue(db, participante.id, q.id, agora)
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(agora.toISOString(), participante.id, q.id)
  const r = registrarResposta(db, { participanteId: participante.id, questaoId: q.id, escolha: gabaritoDe(q.id), agora })
  assert.equal(r.registrado, true)
})

// ---------- cronômetro ----------

test('o relâmpago fora do prazo vira expirou, não erro', () => {
  const { db, participante, questoes } = cenario('cronometro')
  const rel = questoes[4]
  const inicio = new Date('2026-08-27T10:00:00Z')
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(inicio.toISOString(), participante.id, rel.id)
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
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(inicio.toISOString(), participante.id, rel.id)
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
  db.prepare('UPDATE atribuicao SET entregue_em = ? WHERE participante_id = ? AND questao_id = ?')
    .run(inicio.toISOString(), participante.id, rel.id)
  const r = registrarResposta(db, {
    participanteId: participante.id, questaoId: rel.id, escolha: 'confiro',
    agora: new Date(inicio.getTime() + 120_000)
  })
  assert.equal(r.escolhaGravada, 'confiro')
})

// ---------- finalização e resultado ----------

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
