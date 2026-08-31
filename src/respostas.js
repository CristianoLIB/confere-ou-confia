import { resultadoLiberado } from './agregados.js'

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
           p.grupo_relampago, r.id rodada_id, r.fase, r.passo_debrief,
           r.segundos_relampago, r.segundos_trava
    FROM atribuicao a
    JOIN questao q      ON q.id = a.questao_id
    JOIN participante p ON p.id = a.participante_id
    JOIN rodada r       ON r.id = p.rodada_id
    WHERE a.participante_id = ? AND a.questao_id = ?
  `).get(participanteId, questaoId)

  if (!contexto) return { registrado: false, motivo: 'nao_atribuida' }

  // Revelar é um encerramento silencioso: o telão vai para o debrief, mas
  // quem está no meio das perguntas termina em paz. Quem não terminar até o
  // fechamento — quando o placar pessoal abre — fica com o que respondeu.
  const aindaAceita = contexto.fase === 'respondendo' ||
    (contexto.fase === 'revelado' && !resultadoLiberado(db, {
      id: contexto.rodada_id, fase: contexto.fase, passo_debrief: contexto.passo_debrief
    }))
  if (!aindaAceita) return { registrado: false, motivo: 'fase_invalida' }

  const permitidas = contexto.e_relampago ? ESCOLHAS_RELAMPAGO : ESCOLHAS_NORMAIS
  if (!permitidas.includes(escolha)) return { registrado: false, motivo: 'escolha_invalida' }

  // Questão que nunca foi exibida não aceita resposta: sem `entregue_em` não há
  // como medir nem a trava nem o cronômetro, e quem pulasse o /api/entregar
  // responderia fora de qualquer regra de tempo. Vale para todas, inclusive a
  // relâmpago — nela é o carimbo que define o início dos 10 segundos.
  if (!contexto.entregue_em) return { registrado: false, motivo: 'cedo_demais' }

  // A trava de armação é só das situações normais: resposta cedo demais é
  // reflexo, não decisão. No relâmpago quem cuida do tempo é o cronômetro.
  if (!contexto.e_relampago) {
    const desdeQueApareceu = agora.getTime() - new Date(contexto.entregue_em).getTime()
    if (desdeQueApareceu < contexto.segundos_trava * 1000) {
      return { registrado: false, motivo: 'cedo_demais' }
    }
  }

  let escolhaGravada = escolha
  const sobPressao = contexto.e_relampago && contexto.grupo_relampago === 'cronometro'
  if (sobPressao) {
    const limite = contexto.segundos_relampago * 1000 + FOLGA_DE_REDE_MS
    if (agora.getTime() - new Date(contexto.entregue_em).getTime() > limite) {
      escolhaGravada = 'expirou'
    }
  }

  // INSERT OR IGNORE é a trava anti-repetição: se a linha já existe, changes
  // é 0 e a primeira resposta fica intocada. É a restrição do banco decidindo.
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
    correta: Boolean(l.correta),
    // Sem escolha é diferente de errar: quem não chegou a responder não
    // escorregou, ficou sem tempo.
    semResposta: l.escolha === null || l.escolha === 'expirou'
  }))
  const normais = itens.filter(i => !i.eRelampago)
  return {
    acertos: normais.filter(i => i.correta).length,
    total: normais.length,
    itens
  }
}
