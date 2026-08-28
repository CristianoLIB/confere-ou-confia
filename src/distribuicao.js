const ALVO_RESPOSTAS_POR_QUESTAO = 18
const MINIMO_ATIVAS = 6
const MAXIMO_ATIVAS = 14
const QUESTOES_POR_PARTICIPANTE = 4
const POR_GABARITO_NA_ATRIBUICAO = 2

export function embaralhar (lista, aleatorio = Math.random) {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

export function calcularQuestoesAtivas (previsaoParticipantes) {
  const decisoes = previsaoParticipantes * QUESTOES_POR_PARTICIPANTE
  let k = Math.round(decisoes / ALVO_RESPOSTAS_POR_QUESTAO)
  if (k % 2 !== 0) k += 1
  return Math.min(MAXIMO_ATIVAS, Math.max(MINIMO_ATIVAS, k))
}

function completarLado (disponiveis, metade, aleatorio) {
  const essenciais = disponiveis.filter(q => q.essencial)
  if (essenciais.length > metade) {
    throw new Error(`há ${essenciais.length} essenciais para ${metade} vagas`)
  }
  const lado = [...essenciais]
  const resto = embaralhar(disponiveis.filter(q => !q.essencial), aleatorio)
  const categorias = new Set(lado.map(q => q.categoria))

  // Primeiro passe: cobre categorias ainda não representadas.
  for (const q of resto) {
    if (lado.length === metade) break
    if (!categorias.has(q.categoria)) { lado.push(q); categorias.add(q.categoria) }
  }
  // Segundo passe: completa com o que sobrou.
  const jaEscolhidas = new Set(lado.map(q => q.id))
  for (const q of resto) {
    if (lado.length === metade) break
    if (!jaEscolhidas.has(q.id)) { lado.push(q); jaEscolhidas.add(q.id) }
  }
  if (lado.length < metade) {
    throw new Error(`banco insuficiente: ${lado.length} de ${metade} vagas preenchidas`)
  }
  return lado
}

export function selecionarQuestoesAtivas (questoes, k, aleatorio = Math.random) {
  if (k % 2 !== 0) throw new Error('o número de questões ativas deve ser par')
  const metade = k / 2
  const elegiveis = questoes.filter(q => !q.e_relampago)
  const escolhidas = []
  for (const gabarito of ['busca', 'redacao']) {
    escolhidas.push(...completarLado(elegiveis.filter(q => q.gabarito === gabarito), metade, aleatorio))
  }
  return escolhidas
}

export function sortearAtribuicao (questoesAtivas, contagens, aleatorio = Math.random) {
  const escolhidas = []
  for (const gabarito of ['busca', 'redacao']) {
    const candidatas = questoesAtivas.filter(q => q.gabarito === gabarito)
    if (candidatas.length < POR_GABARITO_NA_ATRIBUICAO) {
      throw new Error(`questões ativas insuficientes de ${gabarito}: ${candidatas.length}`)
    }
    // Embaralha antes de ordenar: como o sort de V8 é estável, o embaralhamento
    // vira o critério de desempate entre questões com a mesma contagem de uso.
    const porMenosUsada = embaralhar(candidatas, aleatorio)
      .sort((a, b) => (contagens[a.id] ?? 0) - (contagens[b.id] ?? 0))
    escolhidas.push(...porMenosUsada.slice(0, POR_GABARITO_NA_ATRIBUICAO))
  }
  return embaralhar(escolhidas, aleatorio)
}

export function grupoPorOrdemChegada (ordemChegada) {
  return ordemChegada % 2 === 0 ? 'cronometro' : 'controle'
}
