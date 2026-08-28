// historico.js — revisar sessões passadas
const chave = new URLSearchParams(location.search).get('k') ?? ''
const $ = id => document.getElementById(id)
const comChave = rota => `${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(chave)}`
const escapar = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let sessoes = []
let selecionada = null

const quando = iso => new Date(iso).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
})

const larguras = segs => {
  const total = segs.reduce((s, x) => s + x.valor, 0)
  return total === 0 ? segs.map(() => 0) : segs.map(s => (s.valor / total) * 100)
}

function barra (segs) {
  const l = larguras(segs)
  return `<div class="trilho">${segs.map((s, i) => s.valor === 0 ? '' :
    `<div class="parte ${s.classe}" style="flex:0 0 ${l[i]}%">${l[i] >= 14 ? s.valor : ''}</div>`).join('')}</div>`
}

const linha = (nome, acertos, erros, n, expirados = 0) => `
  <div class="linha">
    <div class="nome">${escapar(nome)}</div>
    ${barra([
      { classe: 'p-acerto', valor: acertos },
      { classe: 'p-erro', valor: erros },
      { classe: 'p-expirou', valor: expirados }
    ])}
    <div class="etiq" style="text-align:right; color:var(--lilas)">n ${n}</div>
  </div>`

const cartao = (valor, nome, classe) => `
  <div class="campo ${classe}" style="padding:16px 18px">
    <div class="num" style="font-size:38px">${valor}</div>
    <div class="etiq" style="margin-top:8px${classe === 'branco' ? '; color:var(--texto-claro)' : ''}">${nome}</div>
  </div>`

function desenharLista () {
  $('lista').innerHTML = sessoes.map(s => `
    <button type="button" class="sessao${s.id === selecionada ? ' selecionada' : ''}" data-id="${s.id}">
      <span class="quando">${escapar(s.titulo)}</span>
      <span class="pct">${s.percentual}%</span>
      <span class="sub">${quando(s.criada_em)} · ${s.participantes} pessoas · ${s.finalizados} concluíram · ${s.decisoes} decisões</span>
    </button>`).join('')
  for (const b of $('lista').querySelectorAll('.sessao')) {
    b.addEventListener('click', () => abrir(Number(b.dataset.id)))
  }
}

async function abrir (id) {
  selecionada = id
  desenharLista()
  $('detalhe').innerHTML = '<div class="etiq" style="color:var(--lilas)">carregando…</div>'
  const r = await fetch(comChave(`/api/painel/sessoes/${id}`))
  if (!r.ok) { $('detalhe').innerHTML = '<div class="etiq" style="color:var(--laranja)">não foi possível ler esta sessão</div>'; return }
  const d = await r.json()
  const rel = d.relampago

  $('detalhe').innerHTML = `
    <h2>${escapar(d.titulo)}</h2>
    <div class="etiq" style="color:var(--lilas); margin:-8px 0 16px">${quando(d.criadaEm)}</div>
    <div class="cartoes" style="margin-bottom:22px">
      ${cartao(`${d.placar.percentual}%`, 'de acerto', 'laranja')}
      ${cartao(d.finalizados, 'concluíram', 'branco')}
      ${cartao(d.placar.decisoes, 'decisões', 'teal')}
    </div>
    <div class="etiq" style="color:var(--lilas); margin-bottom:12px">previsão de ${d.previsaoParticipantes} · ${d.numQuestoesAtivas} questões · trava de ${d.segundosTrava}s</div>

    <h2 style="margin-top:26px">Por categoria</h2>
    ${d.porCategoria.map(c => linha(c.categoria, c.acertos, c.total - c.acertos, c.total)).join('') || '<div class="etiq" style="color:var(--lilas)">sem respostas</div>'}

    <h2 style="margin-top:26px">Onde mais escorregaram</h2>
    ${d.armadilhas.map(a => `
      <div style="border-left:3px solid var(--laranja); padding-left:16px; margin-bottom:16px">
        <div class="etiq" style="color:var(--laranja)">${a.percentualErro}% de erro · n ${a.total} · era ${a.gabarito === 'busca' ? 'busca' : 'redação'}</div>
        <p style="font-size:15px; line-height:1.4; margin:8px 0 0">${escapar(a.texto)}</p>
      </div>`).join('') || '<div class="etiq" style="color:var(--lilas)">amostra pequena demais</div>'}

    <h2 style="margin-top:26px">Pergunta relâmpago</h2>
    ${linha('Com cronômetro', rel.cronometro.acertos, rel.cronometro.total - rel.cronometro.acertos - rel.cronometro.expirados, rel.cronometro.total, rel.cronometro.expirados)}
    ${linha('Sem cronômetro', rel.controle.acertos, rel.controle.total - rel.controle.acertos - rel.controle.expirados, rel.controle.total, rel.controle.expirados)}
    <div class="etiq" style="color:var(--lilas-claro); margin-top:12px">
      ${rel.cronometro.percentual}% com pressa · ${rel.controle.percentual}% sem
      ${rel.cronometro.expirados ? ` · ${rel.cronometro.expirados} não responderam a tempo` : ''}
    </div>

    <div class="chave" style="margin-top:22px">
      <span><i class="quadrado" style="background:var(--branco)"></i>Acertou</span>
      <span><i class="quadrado" style="background:var(--laranja)"></i>Escorregou</span>
      <span><i class="quadrado" style="background:var(--lilas)"></i>Não respondeu a tempo</span>
    </div>`
}

async function carregar () {
  const r = await fetch(comChave('/api/painel/sessoes'))
  if (!r.ok) { $('resumo').textContent = 'chave inválida'; return }
  sessoes = await r.json()
  if (!sessoes.length) {
    $('resumo').textContent = 'nenhuma sessão com participantes ainda'
    $('detalhe').innerHTML = '<div class="etiq" style="color:var(--lilas)">as sessões aparecem aqui depois que alguém responder. Atenção: zerar uma rodada apaga o histórico dela.</div>'
    return
  }
  const pessoas = sessoes.reduce((s, x) => s + x.finalizados, 0)
  const decisoes = sessoes.reduce((s, x) => s + x.decisoes, 0)
  const acertos = sessoes.reduce((s, x) => s + x.acertos, 0)
  $('resumo').textContent =
    `${sessoes.length} sessões · ${pessoas} pessoas · ${decisoes} decisões · ${decisoes ? Math.round(acertos / decisoes * 100) : 0}% de acerto no total`
  desenharLista()
  abrir(sessoes[0].id)
}

$('linkPainel').href = comChave('/painel.html')
carregar()
