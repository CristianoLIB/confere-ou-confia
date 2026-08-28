import {
  calcularQuestoesAtivas, selecionarQuestoesAtivas,
  sortearAtribuicao, grupoPorOrdemChegada
} from './distribuicao.js'

const FASES = ['espera', 'respondendo', 'revelado', 'encerrado']
export const ANIMACOES = ['raio', 'flash', 'nenhuma']
export const TITULO_PADRAO = 'Confere ou Confia?'
export const ATALHO_PADRAO = 'rt'

// Nomes que já são rota: um atalho igual a eles sequestraria a própria
// aplicação. Arquivos têm ponto, e a regex de atalho já barra ponto.
const ATALHOS_RESERVADOS = new Set(['api', 'stream', 'favicon', 'robots', 'assets', 'public'])

// Só letras, números e hífen, em minúsculas: precisa ser ditável em voz alta
// numa reunião e digitável sem erro.
export function arrumarAtalho (valor, padrao = ATALHO_PADRAO) {
  const a = String(valor ?? '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40)
  if (!a || ATALHOS_RESERVADOS.has(a)) return padrao
  return a
}
const TITULO_MAX = 60

// O título é texto de tela em quatro lugares: aparar e limitar aqui evita
// que um título gigante quebre o cabeçalho do telão.
function arrumarTitulo (valor, padrao) {
  const t = String(valor ?? '').trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, TITULO_MAX) : padrao
}

// Limites dos ajustes de ritmo. Validados aqui porque valem para todo caminho:
// criar rodada, ajustar ao vivo, ou semear em teste.
const LIMITES = {
  segundosTrava: [0, 15],
  segundosPreparacao: [0, 30],
  segundosRelampago: [3, 120]
}

function limitar (nome, valor, padrao) {
  const n = Number(valor)
  if (!Number.isFinite(n)) return padrao
  const [min, max] = LIMITES[nome]
  return Math.min(max, Math.max(min, Math.round(n)))
}
const QUESTOES_POR_PARTICIPANTE = 4

export function criarRodada (db, {
  previsaoParticipantes,
  numQuestoesAtivas,
  segundosRelampago = 10,
  segundosTrava = 4,
  segundosPreparacao = 5,
  animacaoRelampago = 'raio',
  titulo = TITULO_PADRAO,
  atalho = ATALHO_PADRAO,
  aleatorio = Math.random
}) {
  titulo = arrumarTitulo(titulo, TITULO_PADRAO)
  atalho = arrumarAtalho(atalho)
  segundosRelampago = limitar('segundosRelampago', segundosRelampago, 10)
  segundosTrava = limitar('segundosTrava', segundosTrava, 4)
  segundosPreparacao = limitar('segundosPreparacao', segundosPreparacao, 5)
  if (!ANIMACOES.includes(animacaoRelampago)) animacaoRelampago = 'raio'
  const k = numQuestoesAtivas ?? calcularQuestoesAtivas(previsaoParticipantes)
  const questoes = db.prepare('SELECT * FROM questao WHERE ativa = 1').all()
  const ativas = selecionarQuestoesAtivas(questoes, k, aleatorio)
  const relampago = questoes.find(q => q.e_relampago)
  if (!relampago) throw new Error('o banco de questões não tem uma questão relâmpago')

  return db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO rodada (criada_em, previsao_participantes, num_questoes_ativas,
                          segundos_relampago, segundos_trava, segundos_preparacao,
                          animacao_relampago, titulo, atalho)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(new Date().toISOString(), previsaoParticipantes, k, segundosRelampago,
      segundosTrava, segundosPreparacao, animacaoRelampago, titulo, atalho)
    const inserir = db.prepare('INSERT INTO rodada_questao (rodada_id, questao_id) VALUES (?, ?)')
    for (const q of [...ativas, relampago]) inserir.run(info.lastInsertRowid, q.id)
    return db.prepare('SELECT * FROM rodada WHERE id = ?').get(info.lastInsertRowid)
  })()
}

export function rodadaAtual (db) {
  return db.prepare('SELECT * FROM rodada ORDER BY id DESC LIMIT 1').get()
}

// O que o participante enxerga. Fora do ar, para ele é como se não existisse
// rodada nenhuma — inclusive para quem já participou de uma sessão anterior.
export function rodadaNoAr (db) {
  const rodada = rodadaAtual(db)
  return rodada && rodada.no_ar ? rodada : undefined
}

export function definirNoAr (db, rodadaId, noAr) {
  db.prepare('UPDATE rodada SET no_ar = ? WHERE id = ?').run(noAr ? 1 : 0, rodadaId)
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
    if (!rodada.entradas_abertas || rodada.fase === 'encerrado') throw new Error('entradas fechadas')

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

// Ajusta o ritmo da rodada em andamento, sem precisar criar outra.
export function definirAjustes (db, rodadaId, ajustes = {}) {
  const atual = db.prepare('SELECT * FROM rodada WHERE id = ?').get(rodadaId)
  if (!atual) throw new Error('rodada inexistente')

  const novo = {
    segundos_trava: 'segundosTrava' in ajustes
      ? limitar('segundosTrava', ajustes.segundosTrava, atual.segundos_trava) : atual.segundos_trava,
    segundos_preparacao: 'segundosPreparacao' in ajustes
      ? limitar('segundosPreparacao', ajustes.segundosPreparacao, atual.segundos_preparacao) : atual.segundos_preparacao,
    segundos_relampago: 'segundosRelampago' in ajustes
      ? limitar('segundosRelampago', ajustes.segundosRelampago, atual.segundos_relampago) : atual.segundos_relampago,
    animacao_relampago: ANIMACOES.includes(ajustes.animacaoRelampago)
      ? ajustes.animacaoRelampago : atual.animacao_relampago,
    titulo: 'titulo' in ajustes ? arrumarTitulo(ajustes.titulo, atual.titulo) : atual.titulo,
    atalho: 'atalho' in ajustes ? arrumarAtalho(ajustes.atalho, atual.atalho) : atual.atalho
  }
  db.prepare(`
    UPDATE rodada SET segundos_trava = @segundos_trava, segundos_preparacao = @segundos_preparacao,
                      segundos_relampago = @segundos_relampago, animacao_relampago = @animacao_relampago,
                      titulo = @titulo, atalho = @atalho
    WHERE id = ${rodadaId}
  `).run(novo)
  return db.prepare('SELECT * FROM rodada WHERE id = ?').get(rodadaId)
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
