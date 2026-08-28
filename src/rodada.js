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
  segundosTrava = 4,
  aleatorio = Math.random
}) {
  const k = numQuestoesAtivas ?? calcularQuestoesAtivas(previsaoParticipantes)
  const questoes = db.prepare('SELECT * FROM questao').all()
  const ativas = selecionarQuestoesAtivas(questoes, k, aleatorio)
  const relampago = questoes.find(q => q.e_relampago)
  if (!relampago) throw new Error('o banco de questões não tem uma questão relâmpago')

  return db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas,
                          segundos_relampago, segundos_trava)
      VALUES (?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), previsaoParticipantes, k, segundosRelampago, segundosTrava)
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

// Carimba uma única vez: é o que arma a trava e, no relâmpago, o cronômetro.
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

// Só apaga participante; atribuicao e resposta somem pelo ON DELETE CASCADE.
export function zerarRodada (db, rodadaId) {
  db.transaction(() => {
    db.prepare('DELETE FROM participante WHERE rodada_id = ?').run(rodadaId)
    db.prepare(`
      UPDATE rodada SET fase = 'espera', entradas_abertas = 1, passo_debrief = 0 WHERE id = ?
    `).run(rodadaId)
  })()
}
