const MINIMO_PARA_ARMADILHA = 5
const MAXIMO_ARMADILHAS = 3

const percentual = (parte, total) => (total === 0 ? 0 : Math.round((parte / total) * 100))

// Uma linha por rodada que teve gente, da mais recente para a mais antiga.
export function listarSessoes (db) {
  return db.prepare(`
    SELECT ro.id, ro.criada_em, ro.titulo, ro.previsao_participantes, ro.num_questoes_ativas, ro.fase,
           COUNT(DISTINCT p.id) participantes,
           SUM(CASE WHEN p.finalizado_em IS NOT NULL THEN 1 ELSE 0 END) finalizados,
           (SELECT COUNT(*) FROM resposta r JOIN questao q ON q.id = r.questao_id
              JOIN participante pp ON pp.id = r.participante_id
             WHERE pp.rodada_id = ro.id AND pp.finalizado_em IS NOT NULL AND q.e_relampago = 0) decisoes,
           (SELECT COALESCE(SUM(r.correta), 0) FROM resposta r JOIN questao q ON q.id = r.questao_id
              JOIN participante pp ON pp.id = r.participante_id
             WHERE pp.rodada_id = ro.id AND pp.finalizado_em IS NOT NULL AND q.e_relampago = 0) acertos
    FROM rodada ro
    LEFT JOIN participante p ON p.rodada_id = ro.id
    GROUP BY ro.id
    HAVING participantes > 0
    ORDER BY ro.id DESC
  `).all().map(l => ({ ...l, percentual: percentual(l.acertos, l.decisoes) }))
}

// Quantos passos o debrief terá: placar, categorias, uma tela por armadilha,
// o relâmpago e o fechamento. O participante só vê o placar pessoal no último.
export function totalPassosDebrief (db, rodadaId) {
  const armadilhas = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT r.questao_id FROM resposta r
      JOIN questao q      ON q.id = r.questao_id
      JOIN participante p ON p.id = r.participante_id
      WHERE p.rodada_id = ? AND p.finalizado_em IS NOT NULL AND q.e_relampago = 0
      GROUP BY r.questao_id HAVING COUNT(*) >= ?
      LIMIT ?)
  `).get(rodadaId, MINIMO_PARA_ARMADILHA, MAXIMO_ARMADILHAS).c
  return 2 + armadilhas + 2
}

// O resultado individual fica represado até o host chegar no fechamento:
// revelar tudo de uma vez rouba a atenção da apresentação.
export function resultadoLiberado (db, rodada) {
  if (rodada.fase === 'encerrado') return true
  if (rodada.fase !== 'revelado') return false
  return rodada.passo_debrief >= totalPassosDebrief(db, rodada.id) - 1
}

export function calcularAgregados (db, rodadaId) {
  const rodada = db.prepare('SELECT fase, passo_debrief FROM rodada WHERE id = ?').get(rodadaId)
  if (!rodada) throw new Error('rodada inexistente')

  const presenca = db.prepare(`
    SELECT
      COUNT(*) conectados,
      SUM(CASE WHEN p.finalizado_em IS NOT NULL THEN 1 ELSE 0 END) finalizados,
      SUM(CASE WHEN p.finalizado_em IS NULL
                AND EXISTS (SELECT 1 FROM resposta r WHERE r.participante_id = p.id)
               THEN 1 ELSE 0 END) respondendo
    FROM participante p WHERE p.rodada_id = ?
  `).get(rodadaId)

  const placarBruto = db.prepare(`
    SELECT COUNT(*) decisoes, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND p.finalizado_em IS NOT NULL AND q.e_relampago = 0
  `).get(rodadaId)

  const decisoes = placarBruto.decisoes ?? 0
  const acertos = placarBruto.acertos ?? 0

  const porCategoria = db.prepare(`
    SELECT q.categoria, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND p.finalizado_em IS NOT NULL AND q.e_relampago = 0
    GROUP BY q.categoria
  `).all(rodadaId)
    .map(l => ({ ...l, percentual: percentual(l.acertos, l.total) }))
    .sort((a, b) => b.percentual - a.percentual)

  const armadilhas = db.prepare(`
    SELECT q.id, q.texto, q.gabarito, q.explicacao, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND p.finalizado_em IS NOT NULL AND q.e_relampago = 0
    GROUP BY q.id
    HAVING total >= ?
  `).all(rodadaId, MINIMO_PARA_ARMADILHA)
    .map(l => ({ ...l, percentualErro: percentual(l.total - l.acertos, l.total) }))
    .sort((a, b) => b.percentualErro - a.percentualErro)
    .slice(0, MAXIMO_ARMADILHAS)

  const grupos = db.prepare(`
    SELECT p.grupo_relampago grupo,
           COUNT(*) total,
           SUM(r.correta) acertos,
           SUM(CASE WHEN r.escolha = 'expirou' THEN 1 ELSE 0 END) expirados
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND p.finalizado_em IS NOT NULL AND q.e_relampago = 1
    GROUP BY p.grupo_relampago
  `).all(rodadaId)

  const vazio = { total: 0, acertos: 0, expirados: 0, percentual: 0 }
  const relampago = { cronometro: { ...vazio }, controle: { ...vazio } }
  for (const g of grupos) {
    relampago[g.grupo] = {
      total: g.total,
      acertos: g.acertos ?? 0,
      expirados: g.expirados ?? 0,
      percentual: percentual(g.acertos ?? 0, g.total)
    }
  }

  return {
    fase: rodada.fase,
    passoDebrief: rodada.passo_debrief,
    // Quem começou e não terminou fica de fora do placar até finalizar.
    foraDoPlacar: presenca.respondendo ?? 0,
    conectados: presenca.conectados ?? 0,
    respondendo: presenca.respondendo ?? 0,
    finalizados: presenca.finalizados ?? 0,
    placar: { decisoes, acertos, percentual: percentual(acertos, decisoes) },
    porCategoria,
    armadilhas,
    relampago
  }
}
