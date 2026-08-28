// painel.js — a tela do apresentador, nunca compartilhada
import { montarPassos } from '/telao.js'
import { calcularQuestoesAtivas } from '/distribuicao-cliente.js'

const chave = new URLSearchParams(location.search).get('k') ?? ''
const $ = id => document.getElementById(id)
let atual = null

const comChave = rota => `${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(chave)}`

async function enviar (rota, corpo) {
  const r = await fetch(comChave(rota), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {})
  })
  if (!r.ok) alert(`Falhou: ${(await r.json()).erro ?? r.status}`)
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
  if (!confirm('Criar uma rodada nova? A anterior sai de cena.')) return
  const r = await enviar('/api/painel/rodada', {
    previsaoParticipantes: Number($('previsao').value),
    segundosRelampago: Number($('segundos').value),
    segundosTrava: Number($('trava').value)
  })
  if (r.ok) alert(`Rodada criada com ${(await r.json()).numQuestoesAtivas} questões.`)
})

$('liberar').addEventListener('click', () => enviar('/api/painel/fase', { fase: 'respondendo' }))
$('entradas').addEventListener('click', () =>
  enviar('/api/painel/entradas', { abertas: atual?.entradasAbertas === false }))
$('revelar').addEventListener('click', () => {
  if (confirm('Revelar o resultado para todo mundo?')) enviar('/api/painel/fase', { fase: 'revelado' })
})
$('encerrar').addEventListener('click', () => {
  if (confirm('Encerrar para todos? Quem está no quiz vê a tela de encerrado e ninguém novo entra.')) {
    enviar('/api/painel/fase', { fase: 'encerrado' })
  }
})
$('avancar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: (atual?.passoDebrief ?? 0) + 1 }))
$('voltar').addEventListener('click', () =>
  enviar('/api/painel/debrief', { passo: Math.max(0, (atual?.passoDebrief ?? 0) - 1) }))
$('zerar').addEventListener('click', () => {
  if (confirm('Apagar todas as respostas desta rodada?')) enviar('/api/painel/zerar')
})

$('linkTelao').href = comChave('/telao.html')
$('linkQuestoes').href = comChave('/questoes.html')
$('linkHistorico').href = comChave('/historico.html')
atualizarPrevisao()

const fonte = new EventSource(comChave('/stream/painel'))
fonte.addEventListener('estado', evento => desenhar(JSON.parse(evento.data)))
