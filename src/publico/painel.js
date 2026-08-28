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

const NOME_DO_PASSO = {
  placar: 'Placar', categorias: 'Categorias',
  armadilha: 'Armadilha', relampago: 'Relâmpago', fechamento: 'Fechamento'
}

function desenhar (ag) {
  atual = ag
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
  // O host precisa saber que o placar pessoal ainda está represado.
  $('gateTexto').textContent = ag.resultadoLiberado
    ? 'resultado individual liberado nas telas dos participantes'
    : (revelado ? 'placar pessoal represado — libera no último passo' : 'placar pessoal represado')
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
    segundosTrava: Number($('trava').value)
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

$('liberar').addEventListener('click', () => enviar('/api/painel/fase', { fase: 'respondendo' }))
$('entradas').addEventListener('click', () =>
  enviar('/api/painel/entradas', { abertas: atual?.entradasAbertas === false }))
$('revelar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Revelar o resultado?',
    texto: 'O telão começa o debrief. O placar de cada participante continua represado até você chegar ao fechamento.',
    rotuloConfirmar: 'Revelar'
  })
  if (ok) enviar('/api/painel/fase', { fase: 'revelado' })
})
$('encerrar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Encerrar para todos?',
    texto: 'Quem está no quiz vê a tela de encerrado e ninguém novo entra. As respostas ficam guardadas.',
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
