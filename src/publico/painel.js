// painel.js — a tela do apresentador, nunca compartilhada
import { montarPassos } from '/telao.js'
import { calcularQuestoesAtivas } from '/distribuicao-cliente.js'
import { confirmar, avisar } from '/modal.js'

const chave = new URLSearchParams(location.search).get('k') ?? ''
const $ = id => document.getElementById(id)
let atual = null

const comChave = rota => `${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(chave)}`

async function enviar (rota, corpo) {
  const r = await fetch(comChave(rota), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {})
  })
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}))
    await avisar({ titulo: 'Não deu certo', texto: corpo.erro ?? `O servidor respondeu ${r.status}.` })
  }
  return r
}

function atualizarPrevisao () {
  const p = Number($('previsao').value)
  if (!Number.isInteger(p) || p < 1 || p > 200) {
    $('questoesAtivas').textContent = '—'
    $('previsaoTexto').textContent = 'informe uma previsão entre 1 e 200'
    return
  }
  const k = calcularQuestoesAtivas(p)
  $('questoesAtivas').textContent = k
  $('previsaoTexto').textContent =
    `questões em jogo, cerca de ${Math.round((p * 4) / k)} respostas em cada uma`
}

// É este endereço que o telão manda digitar e que o QR aponta.
function mostrarEndereco (atalho) {
  $('atalhoTexto').textContent = `os participantes entram por ${location.host}/${atalho}`
}

const NOME_DO_PASSO = {
  placar: 'Placar', categorias: 'Categorias',
  armadilha: 'Armadilha', relampago: 'Relâmpago', fechamento: 'Fechamento'
}

// Enquanto o host não mexe nos campos, eles espelham a rodada.
let ajustesTocados = false
for (const id of ['titulo', 'atalho', 'trava', 'preparacao', 'segundos', 'animacao']) {
  document.getElementById(id).addEventListener('input', () => {
    ajustesTocados = true
    $('ajustesTexto').textContent = 'alterado — clique em Aplicar'
    $('ajustesTexto').style.color = 'var(--lilas-claro)'
  })
}

function desenhar (ag) {
  const primeiro = atual === null
  atual = ag
  if (ag.ajustes && (primeiro || !ajustesTocados)) {
    $('trava').value = ag.ajustes.segundosTrava
    $('preparacao').value = ag.ajustes.segundosPreparacao
    $('segundos').value = ag.ajustes.segundosRelampago
    $('animacao').value = ag.ajustes.animacaoRelampago
    $('titulo').value = ag.ajustes.titulo
    $('atalho').value = ag.ajustes.atalho
    mostrarEndereco(ag.ajustes.atalho)
    if (primeiro) $('ajustesTexto').textContent = 'em uso nesta rodada'
  }
  $('nConectados').textContent = ag.conectados
  $('nRespondendo').textContent = ag.respondendo
  $('nFinalizados').textContent = ag.finalizados
  $('fase').textContent = ag.fase
  $('entradas').textContent = ag.entradasAbertas === false ? 'Abrir entradas' : 'Fechar entradas'

  const passos = montarPassos(ag)
  const indice = Math.min(ag.passoDebrief, passos.length - 1)
  const passo = passos[indice]
  const revelado = ag.fase === 'revelado'
  $('passoTexto').textContent = revelado
    ? `${indice + 1}/${passos.length}  ${NOME_DO_PASSO[passo.tipo]}${passo.indice != null ? ` ${passo.indice + 1}` : ''}`
    : 'depois de revelar'
  $('encerrar').disabled = ag.fase === 'encerrado'
  $('voltar').disabled = !revelado || indice === 0
  $('avancar').disabled = !revelado || indice >= passos.length - 1
  // O host precisa saber que o placar pessoal ainda está represado, e quantas
  // pessoas seguem respondendo sem entrar na conta.
  const pendentes = ag.foraDoPlacar
    ? ` · ${ag.foraDoPlacar} ainda respondendo, fora do placar`
    : ''
  $('gateTexto').textContent = (ag.resultadoLiberado
    ? 'resultado individual liberado nas telas dos participantes'
    : (revelado ? 'placar pessoal represado — libera no último passo' : 'placar pessoal represado')) + pendentes
  $('gateTexto').style.color = ag.resultadoLiberado ? 'var(--laranja)' : 'var(--lilas)'
}

$('previsao').addEventListener('input', atualizarPrevisao)

$('criar').addEventListener('click', async () => {
  const temGente = (atual?.conectados ?? 0) > 0
  const ok = await confirmar({
    titulo: 'Criar uma rodada nova?',
    texto: 'A rodada atual sai de cena e uma nova começa do zero.',
    detalhe: temGente
      ? `A atual tem ${atual.conectados} pessoas — ela fica guardada no histórico.`
      : 'A rodada atual está vazia.',
    rotuloConfirmar: 'Criar rodada'
  })
  if (!ok) return
  const r = await enviar('/api/painel/rodada', {
    previsaoParticipantes: Number($('previsao').value),
    segundosRelampago: Number($('segundos').value),
    segundosTrava: Number($('trava').value),
    segundosPreparacao: Number($('preparacao').value),
    animacaoRelampago: $('animacao').value,
    titulo: $('titulo').value,
    atalho: $('atalho').value
  })
  if (r.ok) await avisar({ titulo: 'Rodada criada', texto: `${(await r.json()).numQuestoesAtivas} questões em jogo.` })
})

$('arquivar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Arquivar esta sessão?',
    texto: 'Ela é encerrada e guardada no histórico, e uma rodada nova igual abre em seguida.',
    detalhe: (atual?.conectados ?? 0) > 0
      ? `${atual.conectados} pessoas e ${atual.placar.decisoes} decisões ficam preservadas.`
      : 'Esta sessão ainda não tem participantes — não há nada a guardar.',
    rotuloConfirmar: 'Arquivar'
  })
  if (!ok) return
  const r = await enviar('/api/painel/arquivar')
  if (r.ok) {
    const d = await r.json()
    await avisar({
      titulo: 'Sessão arquivada',
      texto: `A sessão #${d.arquivada} está no histórico. A nova tem ${d.numQuestoesAtivas} questões.`
    })
  }
})

$('salvarAjustes').addEventListener('click', async () => {
  const r = await enviar('/api/painel/ajustes', {
    segundosTrava: Number($('trava').value),
    segundosPreparacao: Number($('preparacao').value),
    segundosRelampago: Number($('segundos').value),
    animacaoRelampago: $('animacao').value,
    titulo: $('titulo').value,
    atalho: $('atalho').value
  })
  if (r.ok) {
    const d = await r.json()
    // O servidor limita os valores: mostra o que de fato ficou valendo.
    $('trava').value = d.segundosTrava
    $('preparacao').value = d.segundosPreparacao
    $('segundos').value = d.segundosRelampago
    $('animacao').value = d.animacaoRelampago
    $('titulo').value = d.titulo
    $('atalho').value = d.atalho
    mostrarEndereco(d.atalho)
    $('ajustesTexto').textContent = 'aplicado — vale na próxima questão de cada um'
    $('ajustesTexto').style.color = 'var(--laranja)'
  }
})

$('liberar').addEventListener('click', () => enviar('/api/painel/fase', { fase: 'respondendo' }))
$('entradas').addEventListener('click', () =>
  enviar('/api/painel/entradas', { abertas: atual?.entradasAbertas === false }))
$('revelar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Revelar o resultado?',
    texto: 'O telão começa o debrief. Quem ainda está respondendo termina em paz, e o placar de cada um continua represado até você chegar ao fechamento.',
    detalhe: (atual?.foraDoPlacar ?? 0) > 0
      ? `${atual.foraDoPlacar} pessoa(s) ainda respondendo — só entram no placar se terminarem antes do fechamento.`
      : '',
    rotuloConfirmar: 'Revelar'
  })
  if (ok) enviar('/api/painel/fase', { fase: 'revelado' })
})
$('encerrar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Encerrar para todos?',
    texto: 'Ninguém novo entra, quem está respondendo para na hora, e o placar pessoal aparece na tela de cada um — inclusive de quem não terminou.',
    rotuloConfirmar: 'Encerrar'
  })
  if (ok) enviar('/api/painel/fase', { fase: 'encerrado' })
})
$('avancar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: (atual?.passoDebrief ?? 0) + 1 }))
$('voltar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: Math.max(0, (atual?.passoDebrief ?? 0) - 1) }))
$('zerar').addEventListener('click', async () => {
  const pessoas = atual?.conectados ?? 0
  const decisoes = atual?.placar?.decisoes ?? 0
  if (pessoas === 0) {
    const ok = await confirmar({
      titulo: 'Zerar a rodada?',
      texto: 'Ela ainda não tem participantes, então nada se perde. A fase volta para espera.',
      rotuloConfirmar: 'Zerar'
    })
    if (ok) enviar('/api/painel/zerar')
    return
  }
  // Com gente dentro, apagar não tem volta: exige digitar.
  const ok = await confirmar({
    titulo: 'Apagar as respostas desta sessão?',
    texto: 'Isto não tem volta. A sessão sai do histórico e os dados não podem ser recuperados. Se quiser guardá-la, use Arquivar.',
    detalhe: `${pessoas} pessoas e ${decisoes} decisões serão apagadas.`,
    rotuloConfirmar: 'Apagar mesmo assim',
    perigo: true,
    digitar: 'ZERAR'
  })
  if (ok) enviar('/api/painel/zerar')
})

$('linkTelao').href = comChave('/telao.html')
$('linkQuestoes').href = comChave('/questoes.html')
$('linkHistorico').href = comChave('/historico.html')
atualizarPrevisao()

const fonte = new EventSource(comChave('/stream/painel'))
fonte.addEventListener('estado', evento => desenhar(JSON.parse(evento.data)))
