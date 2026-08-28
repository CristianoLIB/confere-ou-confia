// telao.js — a tela projetada no Zoom
const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// A régua de largura: um segmento com valor > 0 nunca desaparece da barra.
export function larguraSegmentos (segmentos) {
  const total = segmentos.reduce((s, x) => s + x.valor, 0)
  if (total === 0) return segmentos.map(() => 0)
  return segmentos.map(s => (s.valor / total) * 100)
}

export function montarPassos (ag) {
  return [
    { tipo: 'placar' },
    { tipo: 'categorias' },
    ...ag.armadilhas.map((_, indice) => ({ tipo: 'armadilha', indice })),
    { tipo: 'relampago' },
    { tipo: 'fechamento' }
  ]
}

const CHAVE = (comExpirou = false) => `<div class="chave">
  <span><i class="quadrado" style="background: var(--branco)"></i>Acertou</span>
  <span><i class="quadrado" style="background: var(--laranja)"></i>Escorregou</span>
  ${comExpirou ? '<span><i class="quadrado" style="background: var(--lilas)"></i>Não respondeu a tempo</span>' : ''}
</div>`

// Rótulo direto só onde cabe: abaixo de 12% o texto encavalaria.
const LIMIAR_ROTULO = 12

function barra (segmentos, classe = '') {
  const larguras = larguraSegmentos(segmentos)
  return `<div class="trilho ${classe}">${segmentos.map((s, i) => s.valor === 0 ? '' :
    `<div class="parte ${s.classe}" style="flex: 0 0 ${larguras[i]}%">${larguras[i] >= LIMIAR_ROTULO ? escapar(s.rotulo) : ''}</div>`
  ).join('')}</div>`
}

function linha (nome, segmentos, n) {
  return `<div class="linha">
    <div class="nome">${escapar(nome)}</div>
    ${barra(segmentos)}
    <div class="n etiq">n ${n}</div>
  </div>`
}

const fatias = (acertos, erros, expirados = 0) => ([
  { classe: 'p-acerto', valor: acertos, rotulo: String(acertos) },
  { classe: 'p-erro', valor: erros, rotulo: String(erros) },
  { classe: 'p-expirou', valor: expirados, rotulo: expirados > 0 ? String(expirados) : '' }
])

const cabeca = (ag, contador) => `<div class="cabeca etiq">
  <span><strong>Confere ou Confia?</strong>&nbsp;&nbsp;Lean Institute Brasil</span>
  <span>${contador}</span>
</div>`

// ---------- as telas ----------

const telaEspera = ag => `
  <div class="campo navy" style="grid-column:1/8; grid-row:2/5; justify-content:flex-end">
    <h1 class="disp t-titulo">Confere<br><span style="color:var(--laranja)">ou</span> confia?</h1>
  </div>
  <div class="campo branco" style="grid-column:1/8; grid-row:5/8; justify-content:flex-end">
    <div class="num t-numero">${ag.conectados}</div>
    <div class="etiq" style="margin-top:14px; color:var(--texto-claro)">conectados</div>
  </div>
  <div class="campo laranja" style="grid-column:8/13; grid-row:2/8; justify-content:space-between; align-items:flex-start">
    <div class="etiq">O link está no chat — ou aponte o celular</div>
    <img class="qr" src="/qr.svg" alt="QR code do link do quiz">
    <div class="disp t-subtitulo" style="text-transform:none; word-break:break-all">${escapar(location.host)}</div>
  </div>`

const telaRespondendo = ag => `
  <div class="campo navy" style="grid-column:1/13; grid-row:2/4; justify-content:center">
    <h1 class="disp t-titulo">Ninguém vê resultado<br>ainda. <span style="color:var(--laranja)">Nem eu.</span></h1>
  </div>
  <div class="campo branco" style="grid-column:1/5; grid-row:4/8; justify-content:flex-end">
    <div class="num t-numero">${ag.conectados}</div><div class="etiq" style="margin-top:14px; color:var(--texto-claro)">conectados</div>
  </div>
  <div class="campo laranja" style="grid-column:5/9; grid-row:4/8; justify-content:flex-end">
    <div class="num t-numero">${ag.respondendo}</div><div class="etiq" style="margin-top:14px">respondendo</div>
  </div>
  <div class="campo teal" style="grid-column:9/13; grid-row:4/8; justify-content:flex-end">
    <div class="num t-numero">${ag.finalizados}</div><div class="etiq" style="margin-top:14px">finalizados</div>
  </div>`

const telaPlacar = ag => `
  <div class="campo laranja" style="grid-column:1/7; grid-row:2/8; justify-content:center">
    <div class="num t-heroi" id="heroi">0%</div>
  </div>
  <div class="campo navy" style="grid-column:7/13; grid-row:2/5; justify-content:flex-end">
    <h1 class="disp t-titulo">O resultado<br>da sala</h1>
  </div>
  <div class="campo branco" style="grid-column:7/13; grid-row:5/8; justify-content:space-between">
    <div class="t-corpo">de acerto na escolha entre buscar e redigir</div>
    <div class="etiq" style="color:var(--texto-claro)">${ag.placar.decisoes} decisões · ${ag.finalizados} pessoas</div>
  </div>`

const telaCategorias = ag => `
  <div class="campo branco" style="grid-column:1/13; grid-row:2/3; justify-content:center">
    <h1 class="disp t-subtitulo">Onde vocês foram bem, e onde escorregaram</h1>
  </div>
  <div class="campo navy" style="grid-column:1/13; grid-row:3/8; justify-content:space-between">
    <div class="linhas">
      ${ag.porCategoria.map(c => linha(c.categoria, fatias(c.acertos, c.total - c.acertos), c.total)).join('')}
    </div>
    ${CHAVE()}
  </div>`

function telaArmadilha (ag, indice) {
  const a = ag.armadilhas[indice]
  const veredito = a.gabarito === 'busca' ? 'Isso era busca' : 'Isso era redação'
  return `
    <div class="campo laranja" style="grid-column:1/6; grid-row:2/8; justify-content:space-between">
      <div class="etiq">Armadilha</div>
      <div>
        <div class="num t-marca">${a.percentualErro}%</div>
        <div class="disp t-subtitulo" style="margin-top:18px">escorregou<br>aqui</div>
      </div>
      <div class="etiq">n ${a.total} respostas</div>
    </div>
    <div class="campo navy" style="grid-column:6/13; grid-row:2/6; justify-content:space-between">
      <p class="t-corpo">${escapar(a.texto)}</p>
      <div>${barra(fatias(a.acertos, a.total - a.acertos), 'solo')}<div style="height:14px"></div>${CHAVE()}</div>
    </div>
    <div class="campo branco" style="grid-column:6/13; grid-row:6/8; justify-content:space-between">
      <div class="disp t-subtitulo">${veredito}</div>
      <p class="t-corpo" style="color:var(--texto-claro)">${escapar(a.explicacao)}</p>
    </div>`
}

const telaRelampago = ag => {
  const grupo = (nome, g, cor) => `
    <div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; margin-bottom:12px">
        <div class="disp t-subtitulo" style="color:${cor}">${nome}</div>
        <div class="num" style="font-size:clamp(30px,4.5vw,58px); color:${cor}">${g.percentual}%</div>
      </div>
      ${barra(fatias(g.acertos, g.total - g.acertos - g.expirados, g.expirados), 'solo')}
    </div>`
  return `
    <div class="campo branco" style="grid-column:1/13; grid-row:2/3; justify-content:center">
      <h1 class="disp t-subtitulo">A mesma pergunta. Só mudou o cronômetro.</h1>
    </div>
    <div class="campo navy" style="grid-column:1/13; grid-row:3/7; justify-content:space-between">
      ${grupo('Com 10 segundos', ag.relampago.cronometro, 'var(--laranja)')}
      ${grupo('Sem cronômetro', ag.relampago.controle, 'var(--branco)')}
      ${CHAVE(true)}
    </div>
    <div class="campo laranja" style="grid-column:1/13; grid-row:7/8; justify-content:center">
      <div class="disp t-subtitulo">Se veio com link, abra o link. São trinta segundos.</div>
    </div>`
}

const telaFechamento = () => `
  <div class="campo navy" style="grid-column:1/7; grid-row:2/8; justify-content:flex-end">
    <div class="disp t-titulo">O Google<br>busca.<br><span style="color:var(--lilas)">A IA<br>redige.</span></div>
  </div>
  <div class="campo branco" style="grid-column:7/13; grid-row:2/4; justify-content:center">
    <div class="disp t-subtitulo">Confiar<br>é ótimo.</div>
  </div>
  <div class="campo laranja" style="grid-column:7/13; grid-row:4/8; justify-content:center">
    <div class="disp t-titulo">Conferir é<br>obrigatório.</div>
  </div>`

// Sobe o número em vez de estampá-lo: é o momento da revelação.
function animarHeroi (alvo) {
  const no = document.getElementById('heroi')
  if (!no) return
  const inicio = performance.now()
  const passo = agora => {
    const t = Math.min(1, (agora - inicio) / 1500)
    no.textContent = `${Math.round(alvo * (1 - Math.pow(1 - t, 3)))}%`
    if (t < 1) requestAnimationFrame(passo)
  }
  requestAnimationFrame(passo)
}

function desenhar (ag) {
  const tela = document.getElementById('tela')
  if (ag.fase === 'espera') { tela.innerHTML = cabeca(ag, 'sala de espera') + telaEspera(ag); return }
  if (ag.fase === 'respondendo') { tela.innerHTML = cabeca(ag, 'respondendo') + telaRespondendo(ag); return }

  const passos = montarPassos(ag)
  const indice = Math.min(ag.passoDebrief, passos.length - 1)
  const passo = passos[indice]
  const desenhos = {
    placar: () => telaPlacar(ag),
    categorias: () => telaCategorias(ag),
    armadilha: () => telaArmadilha(ag, passo.indice),
    relampago: () => telaRelampago(ag),
    fechamento: () => telaFechamento()
  }
  tela.innerHTML = cabeca(ag, `${indice + 1} / ${passos.length}`) + desenhos[passo.tipo]()
  if (passo.tipo === 'placar') animarHeroi(ag.placar.percentual)
}

// Este módulo é importado pelo telão (que desenha), pelo painel (que só quer
// `montarPassos`) e pelos testes (onde não há `document`). Só o telão tem
// `#tela` — é o que autoriza abrir o EventSource daqui.
const raiz = typeof document !== 'undefined' && document.getElementById('tela')
if (raiz) {
  const chave = new URLSearchParams(location.search).get('k') ?? ''
  let ultimoPasso = null
  const fonte = new EventSource(`/stream/painel?k=${encodeURIComponent(chave)}`)
  fonte.addEventListener('estado', evento => {
    const ag = JSON.parse(evento.data)
    // Redesenhar o placar a cada evento reiniciaria a animação do número.
    const assinatura = `${ag.fase}:${ag.passoDebrief}`
    const mudouDePasso = assinatura !== ultimoPasso
    ultimoPasso = assinatura
    if (ag.fase === 'revelado' && !mudouDePasso) return
    desenhar(ag)
  })
  fonte.onerror = () => { raiz.innerHTML = '<div class="campo navy" style="grid-column:1/13; grid-row:1/8; justify-content:center"><div class="disp t-subtitulo">Reconectando…</div></div>' }
}
