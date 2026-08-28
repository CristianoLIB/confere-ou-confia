const MINIMO_PARA_ARMADILHA = 5
const MAXIMO_ARMADILHAS = 3

const percentual = (parte, total) => (total === 0 ? 0 : Math.round((parte / total) * 100))

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
    WHERE p.rodada_id = ? AND q.e_relampago = 0
  `).get(rodadaId)

  const decisoes = placarBruto.decisoes ?? 0
  const acertos = placarBruto.acertos ?? 0

  const porCategoria = db.prepare(`
    SELECT q.categoria, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 0
    GROUP BY q.categoria
  `).all(rodadaId)
    .map(l => ({ ...l, percentual: percentual(l.acertos, l.total) }))
    .sort((a, b) => b.percentual - a.percentual)

  const armadilhas = db.prepare(`
    SELECT q.id, q.texto, q.gabarito, q.explicacao, COUNT(*) total, SUM(r.correta) acertos
    FROM resposta r
    JOIN questao q      ON q.id = r.questao_id
    JOIN participante p ON p.id = r.participante_id
    WHERE p.rodada_id = ? AND q.e_relampago = 0
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
    WHERE p.rodada_id = ? AND q.e_relampago = 1
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
    conectados: presenca.conectados ?? 0,
    respondendo: presenca.respondendo ?? 0,
    finalizados: presenca.finalizados ?? 0,
    placar: { decisoes, acertos, percentual: percentual(acertos, decisoes) },
    porCategoria,
    armadilhas,
    relampago
  }
}
