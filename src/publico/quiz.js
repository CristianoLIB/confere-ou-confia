// quiz.js — a tela do participante
const tela = document.getElementById('tela')
const marcador = document.getElementById('marcador')
const cabecaTitulo = document.getElementById('titulo')

const estado = {
  rodada: null, rotulo: '', fase: 'espera', resultadoLiberado: false,
  segundosTrava: 4, segundosRelampago: 10, segundosPreparacao: 5, animacaoRelampago: 'raio',
  titulo: 'RTQuiz',
  questoes: [], respondidas: new Set(), enviando: false, preparado: false,
  mostradaEm: 0, cronometro: null, trava: null, preparo: null, resultado: null, reentrando: false
}

// 401: o participante sumiu do servidor (o host zerou a rodada ou criou outra).
// 503: não há rodada aberta. Em ambos, insistir na sessão velha é o que
// prendia o participante repetindo a mesma questão.
const SESSAO_PERDIDA = [401, 503]

const escapar = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const LUPA = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ff8000" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4.6-4.6"></path></svg>'
const CANETA = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#169194" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"></path><path d="M13.5 6.5l4 4"></path></svg>'
const CHECK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#29235c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>'
const ELO = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#29235c" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg>'
const RAIO = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#ff8000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z"></path></svg>'
const RELOGIO = '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 2.5"></path><path d="M9 2h6"></path></svg>'
const seta = cor => `<span class="marca" style="background: ${cor}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${cor === '#ff8000' ? '#1d1846' : '#ffffff'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg></span>`

const botao = (valor, icone, cor, rotulo, nota, travado) => `
  <button class="opcao" data-escolha="${valor}"${travado ? ' disabled' : ''}>
    <span class="topo">${icone}${seta(cor)}</span>
    <span class="texto"><span class="rotulo">${rotulo}</span><span class="nota">${nota}</span></span>
  </button>`

const enviarJson = (url, corpo) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {})
})

async function entrar () {
  const r = await enviarJson('/api/entrar')
  if (!r.ok) {
    tela.innerHTML = '<div class="campo navy" style="flex:1; justify-content:center"><p style="color:var(--lilas-claro); font-size:16px; font-weight:500">A dinâmica ainda não abriu, as entradas foram fechadas, ou ela já encerrou.</p></div>'
    return false
  }
  const d = await r.json()
  Object.assign(estado, {
    rodada: d.rodada, rotulo: d.rotulo, fase: d.fase, resultadoLiberado: d.resultadoLiberado,
    segundosTrava: d.segundosTrava, segundosRelampago: d.segundosRelampago,
    segundosPreparacao: d.segundosPreparacao, animacaoRelampago: d.animacaoRelampago,
    titulo: d.titulo,
    questoes: d.questoes, respondidas: new Set(d.jaRespondidas),
    // Sessão nova: o que era da anterior não vale mais.
    preparado: false, resultado: null
  })
  return true
}

// Refaz a inscrição e redesenha do zero. Guardado por uma trava para não
// entrar em cascata quando várias chamadas falharem juntas.
async function reentrar () {
  if (estado.reentrando) return
  estado.reentrando = true
  pararTemporizadores()
  estado.enviando = false
  const ok = await entrar()
  estado.reentrando = false
  if (ok) await desenhar()
}

const pendente = () => estado.questoes.find(q => !estado.respondidas.has(q.id))

function pararTemporizadores () {
  if (estado.cronometro) { clearInterval(estado.cronometro); estado.cronometro = null }
  if (estado.trava) { clearInterval(estado.trava); estado.trava = null }
  if (estado.preparo) { clearInterval(estado.preparo); estado.preparo = null }
}

const RAIO_SVG = '<svg viewBox="0 0 24 24" fill="#1d1846" aria-hidden="true"><path d="M13.5 1L4 14h6.2L9.4 23 20 9.6h-6.9L13.5 1z"/></svg>'

// Anuncia o relâmpago cobrindo a tela por um instante. Resolve quando some,
// e só então a pergunta aparece — a animação não pode comer o cronômetro.
function tocarChamada () {
  const modo = estado.animacaoRelampago
  if (modo === 'nenhuma') return Promise.resolve()
  const capa = document.createElement('div')
  capa.className = `chamada ${modo}`
  capa.innerHTML = `<div class="clarao"></div>${RAIO_SVG}<div class="rotulo">Pergunta<br>Relâmpago!</div>`
  document.body.appendChild(capa)
  return new Promise(resolve => {
    setTimeout(() => { capa.remove(); resolve() }, 1250)
  })
}

async function responder (questao, escolha) {
  if (estado.enviando || estado.respondidas.has(questao.id)) return
  estado.enviando = true
  pararTemporizadores()
  for (const b of tela.querySelectorAll('button.opcao')) b.disabled = true
  try {
    const r = await enviarJson('/api/responder', {
      questaoId: questao.id, escolha, msParaResponder: Date.now() - estado.mostradaEm
    })
    // 425: chegou antes da trava do servidor. Redesenha a mesma questão.
    if (SESSAO_PERDIDA.includes(r.status)) { await reentrar(); return }
    if (r.status === 425) { estado.enviando = false; desenhar(); return }
    if (r.status === 400 && (await r.clone().json().catch(() => ({}))).motivo === 'fase_invalida') {
      // A dinâmica fechou entre o clique e a chegada: nada a gravar.
      estado.enviando = false; desenhar(); return
    }
    if (r.ok || r.status === 409 || r.status === 400) estado.respondidas.add(questao.id)
  } catch {
    estado.enviando = false
    for (const b of tela.querySelectorAll('button.opcao')) b.disabled = false
    return
  }
  estado.enviando = false
  desenhar()
}

// A trava é do servidor; aqui ela só é visível. Sem o aviso, os botões mortos
// pareceriam travamento do sistema em vez de regra da dinâmica.
function armarTrava () {
  const total = estado.segundosTrava * 1000
  const inicio = Date.now()
  const faixa = document.getElementById('aviso')
  const linha = document.getElementById('linha')
  const passo = () => {
    const falta = Math.max(0, total - (Date.now() - inicio))
    linha.style.width = `${((total - falta) / total) * 100}%`
    faixa.textContent = `Leia a situação · liberam em ${Math.ceil(falta / 1000)}s`
    if (falta === 0) {
      pararTemporizadores()
      faixa.parentElement.remove()
      for (const b of tela.querySelectorAll('button.opcao')) b.disabled = false
      estado.mostradaEm = Date.now()
    }
  }
  passo()
  estado.trava = setInterval(passo, 80)
}

function iniciarCronometro (questao) {
  const conta = document.getElementById('conta')
  const faixa = document.getElementById('faixaTempo')
  const fim = Date.now() + estado.segundosRelampago * 1000
  const passo = () => {
    const falta = Math.max(0, Math.ceil((fim - Date.now()) / 1000))
    conta.textContent = `${falta}s`
    faixa.className = falta <= 3 ? 'campo laranja' : 'campo branco'
    // Manda a escolha do eixo; o servidor decide se estourou. Ele é a autoridade.
    if (falta === 0) { pararTemporizadores(); responder(questao, 'confio') }
  }
  passo()
  estado.cronometro = setInterval(passo, 200)
}

function desenharQuestao (questao) {
  const numero = estado.questoes.filter(q => !q.eRelampago).findIndex(q => q.id === questao.id) + 1
  marcador.textContent = questao.eRelampago ? 'Relâmpago' : `Situação ${numero} de 4`
  const travado = !questao.eRelampago && estado.segundosTrava > 0
  const comTempo = questao.eRelampago && questao.comCronometro

  const opcoes = questao.eRelampago
    ? botao('confio', CHECK, '#29235c', 'Confio', 'uso do jeito que veio', false) +
      botao('confiro', ELO, '#29235c', 'Confiro', 'abro o link antes', false)
    : botao('busca', LUPA, '#ff8000', 'Busca', 'vá à fonte', travado) +
      botao('redacao', CANETA, '#169194', 'Redação', 'a IA resolve', travado)

  tela.innerHTML = `
    ${comTempo ? '<div class="campo branco" id="faixaTempo" style="flex-direction:row; align-items:baseline; justify-content:space-between; padding-top:14px; padding-bottom:14px"><span class="etiq">tempo</span><span class="num num-l" id="conta"></span></div>' : ''}
    <div class="campo navy enunciado-caixa">
      <p class="enunciado">${escapar(questao.texto)}</p>
    </div>
    <div class="acoes">
      ${travado ? '<div class="aviso"><span class="etiq" id="aviso"></span><div class="trilha"><i id="linha" style="width:0"></i></div></div>' : ''}
      <div class="opcoes">${opcoes}</div>
    </div>`

  for (const b of tela.querySelectorAll('button.opcao')) {
    b.addEventListener('click', () => responder(questao, b.dataset.escolha))
  }

  const entregar = () => {
    // Carimba a entrega de TODA questão: é o que arma a trava no servidor,
    // e no relâmpago é o que inicia o cronômetro.
    enviarJson('/api/entregar', { questaoId: questao.id })
      .then(r => { if (SESSAO_PERDIDA.includes(r.status)) reentrar() })
      .catch(() => { /* rede caiu; o participante tenta de novo ao responder */ })
    estado.mostradaEm = Date.now()
    if (travado) armarTrava()
    if (comTempo) iniciarCronometro(questao)
  }

  // No relâmpago a chamada vem primeiro; o cronômetro só começa depois dela.
  if (questao.eRelampago) tocarChamada().then(entregar)
  else entregar()
}

// Avança sozinha: depender do clique fazia cada um chegar ao relâmpago num
// momento diferente, e a duração é ajustável no painel.
function desenharPreparacao (relampago) {
  marcador.textContent = 'Prepare-se'
  const comCronometro = relampago.comCronometro
  const total = Math.max(1, estado.segundosPreparacao)
  tela.innerHTML = `
    <div class="campo navy" style="flex:1; justify-content:flex-end">
      <div class="etiq" style="color:var(--lilas)">Última</div>
      <div class="disp disp-xl" style="margin-top:14px">Mais<br>uma,<br><span style="color:var(--laranja)">e acabou.</span></div>
    </div>
    ${comCronometro ? `
    <div class="campo laranja" style="flex-direction:row; align-items:center; gap:14px">
      ${RELOGIO}
      <span class="disp disp-s">Esta tem ${estado.segundosRelampago} segundos<br>para responder.</span>
    </div>` : ''}
    <div class="acoes">
      <div class="aviso">
        <span class="etiq" id="aviso">Começa em ${total}s</span>
        <div class="trilha"><i id="linha" style="width:0"></i></div>
      </div>
    </div>`

  const inicio = Date.now()
  const passo = () => {
    const falta = Math.max(0, total * 1000 - (Date.now() - inicio))
    document.getElementById('linha').style.width = `${((total * 1000 - falta) / (total * 1000)) * 100}%`
    document.getElementById('aviso').textContent = `Começa em ${Math.ceil(falta / 1000)}s`
    if (falta === 0) {
      pararTemporizadores()
      estado.preparado = true
      desenhar()
    }
  }
  passo()
  estado.preparo = setInterval(passo, 80)
}

function desenharResultado () {
  marcador.textContent = 'Resultado'
  const r = estado.resultado
  tela.innerHTML = `
    <div class="campo laranja" style="flex-direction:row; align-items:flex-end; justify-content:space-between; padding-top:30px; padding-bottom:26px">
      <div class="disp disp-m">Você<br>acertou</div>
      <div class="num num-xl">${r.acertos}<span class="num-l">/${r.total}</span></div>
    </div>
    ${r.itens.filter(i => !i.eRelampago && i.semResposta).length ? `
    <div class="campo navy" style="flex-direction:row; align-items:center; gap:12px; padding-top:14px; padding-bottom:14px">
      <i class="quadrado" style="background:var(--lilas)"></i>
      <span class="etiq" style="color:var(--lilas-claro)">${r.itens.filter(i => !i.eRelampago && i.semResposta).length} pergunta(s) ficaram sem resposta</span>
    </div>` : ''}
    ${r.itens.map(i => {
      // Três estados, não dois: quem não chegou a responder não errou.
      const cor = i.correta ? '#ffffff' : (i.semResposta ? '#8b87ad' : '#ff8000')
      const veredito = i.correta ? 'Acertou' : (i.semResposta ? 'Não respondeu' : 'Escorregou')
      return `
      <div class="campo navy">
        <div style="display:flex; align-items:center; gap:10px">
          <i class="quadrado" style="background:${cor}"></i>
          <span class="etiq" style="color:${cor}">${veredito}</span>
        </div>
        <p style="font-size:15px; line-height:1.42; margin:12px 0 8px; font-weight:500">${escapar(i.texto)}</p>
        <p style="font-size:14px; line-height:1.42; margin:0; color:var(--lilas)">${escapar(i.explicacao)}</p>
      </div>`
    }).join('')}
    <div class="campo branco">
      <div class="disp disp-m">Confiar é ótimo.<br><span style="color:var(--laranja)">Conferir é obrigatório.</span></div>
    </div>`
}

async function desenhar () {
  pararTemporizadores()
  cabecaTitulo.textContent = estado.titulo || 'RTQuiz'
  marcador.textContent = estado.rotulo

  if (estado.fase === 'espera') {
    // A espera é o único momento em que dá para explicar as regras sem
    // atrapalhar: durante as perguntas o cronômetro corre.
    const trava = estado.segundosTrava > 0
      ? `Os botões liberam <strong>${estado.segundosTrava} segundos</strong> depois. Dá tempo de ler com calma.`
      : 'Leia a situação inteira antes de decidir.'
    tela.innerHTML = `
      <div class="campo navy">
        <div class="disp disp-l">Você está<br><span style="color:var(--laranja)">dentro.</span></div>
        <p style="font-size:15px; color:var(--lilas-claro); margin:14px 0 0; font-weight:500">${escapar(estado.rotulo)} · aguarde o início</p>
      </div>
      <div class="passos">
        <div class="campo branco passo">
          <span class="n">1</span>
          <span class="t"><strong>Quatro situações</strong> do dia a dia, uma por vez.</span>
        </div>
        <div class="campo teal passo">
          <span class="n">2</span>
          <span class="t">Em cada uma: <strong>buscar na fonte</strong> ou <strong>deixar com a IA</strong>?</span>
        </div>
        <div class="campo laranja passo">
          <span class="n">3</span>
          <span class="t">${trava}</span>
        </div>
      </div>
      <div class="campo navy etiq" style="color:var(--lilas)">ninguém vê o resultado até o final</div>`
    return
  }

  // O fechamento do debrief (ou o encerramento) é o corte definitivo: quem
  // não terminou fica com o que respondeu, o resto marcado como em branco.
  if (estado.resultadoLiberado) {
    if (!estado.resultado) {
      const r = await fetch('/api/meu-resultado')
      if (SESSAO_PERDIDA.includes(r.status)) { reentrar(); return }
      if (!r.ok) { tela.innerHTML = '<div class="campo navy" style="flex:1"></div>'; return }
      estado.resultado = await r.json()
    }
    desenharResultado()
    return
  }

  const questao = pendente()

  // Revelar é encerramento silencioso: o telão vai para o debrief, mas quem
  // ainda tem pergunta pela frente continua respondendo sem ser interrompido.
  if (questao && (estado.fase === 'respondendo' || estado.fase === 'revelado')) {
    if (questao.eRelampago && !estado.preparado && estado.segundosPreparacao > 0) {
      desenharPreparacao(questao); return
    }
    desenharQuestao(questao)
    return
  }

  if (estado.fase === 'revelado') {
    marcador.textContent = 'Revelando'
    tela.innerHTML = `
      <div class="campo navy" style="flex:1; justify-content:flex-end">
        <div class="etiq" style="color:var(--lilas)">Olhe para o telão</div>
        <div class="disp disp-l" style="margin-top:14px">O resultado<br>da sala está<br><span style="color:var(--laranja)">saindo.</span></div>
        <p style="font-size:16px; color:var(--lilas-claro); margin:22px 0 0; font-weight:500">O seu aparece aqui daqui a pouco.</p>
      </div>
      <div class="campo laranja etiq">aguarde o fim da apresentação</div>`
    return
  }

  tela.innerHTML = `
    <div class="campo navy" style="flex:1; justify-content:flex-end">
      <div class="disp disp-l">Respostas<br>registradas.</div>
      <p style="font-size:16px; color:var(--lilas-claro); margin:22px 0 0; font-weight:500">Ninguém sabe o resultado ainda. Nem você.</p>
    </div>
    <div class="campo teal etiq">aguarde a revelação</div>`
}

function ouvirEstado () {
  const fonte = new EventSource('/stream')
  fonte.addEventListener('estado', evento => {
    const d = JSON.parse(evento.data)
    // Rodada trocada: as questões em memória são de outra rodada. Reinscrever.
    if (estado.rodada !== null && d.rodada !== estado.rodada) { reentrar(); return }
    const mudou = d.fase !== estado.fase || d.resultadoLiberado !== estado.resultadoLiberado
    estado.fase = d.fase
    estado.resultadoLiberado = d.resultadoLiberado
    estado.segundosRelampago = d.segundosRelampago
    estado.segundosTrava = d.segundosTrava
    estado.segundosPreparacao = d.segundosPreparacao
    estado.animacaoRelampago = d.animacaoRelampago
    estado.titulo = d.titulo
    // O cabeçalho pode acompanhar na hora: mexer nele não reinicia a trava
    // nem o cronômetro, ao contrário de redesenhar a tela inteira.
    cabecaTitulo.textContent = estado.titulo || 'RTQuiz'
    // Só redesenha na virada de fase: no meio de uma questão, redesenhar
    // reiniciaria a trava e o cronômetro.
    if (mudou) desenhar()
  })
}

if (await entrar()) { await desenhar(); ouvirEstado() }
