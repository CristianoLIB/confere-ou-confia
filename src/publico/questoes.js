// questoes.js — gestão do banco de questões
const chave = new URLSearchParams(location.search).get('k') ?? ''
const $ = id => document.getElementById(id)
const comChave = rota => `${rota}${rota.includes('?') ? '&' : '?'}k=${encodeURIComponent(chave)}`
const escapar = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

let lista = []
let selecionada = null   // id em edição, ou null para nova

async function chamar (rota, opcoes = {}) {
  const r = await fetch(comChave(rota), opcoes)
  let corpo = null
  try { corpo = await r.json() } catch { /* sem corpo */ }
  return { ok: r.ok, status: r.status, corpo }
}

function retorno (texto, classe) {
  const no = $('retorno'); no.textContent = texto; no.className = classe
}

function resumo () {
  const ativas = lista.filter(q => q.ativa)
  const n = g => ativas.filter(q => q.gabarito === g && !q.e_relampago).length
  const rel = ativas.filter(q => q.e_relampago).length
  $('resumo').textContent =
    `${ativas.length} ativas de ${lista.length} · ${n('busca')} busca · ${n('redacao')} redação · ${rel} relâmpago` +
    (rel !== 1 ? ' — atenção: precisa haver exatamente uma relâmpago ativa' : '')
}

function desenharLista () {
  $('lista').innerHTML = lista.map(q => `
    <button type="button" class="item${q.ativa ? '' : ' inativa'}${q.id === selecionada ? ' selecionada' : ''}" data-id="${escapar(q.id)}">
      <span class="id">${escapar(q.id)}</span>
      <span class="meta">
        <span class="marca m-${q.gabarito}">${q.e_relampago ? 'relâmpago' : q.gabarito}</span>
        ${q.essencial ? '<span class="marca m-essencial">essencial</span>' : ''}
      </span>
      <span class="meta">
        <span class="etiq" style="opacity:.7">${escapar(q.categoria)}</span>
        <span class="texto">${escapar(q.texto)}</span>
      </span>
    </button>`).join('')
  for (const b of $('lista').querySelectorAll('.item')) {
    b.addEventListener('click', () => editar(b.dataset.id))
  }
  resumo()
}

function preencher (q) {
  const f = $('form')
  f.id.value = q?.id ?? ''
  f.id.readOnly = Boolean(q)
  f.gabarito.value = q?.gabarito ?? 'busca'
  f.categoria.value = q?.categoria ?? ''
  f.texto.value = q?.texto ?? ''
  f.explicacao.value = q?.explicacao ?? ''
  f.essencial.checked = Boolean(q?.essencial)
  f.e_relampago.checked = Boolean(q?.e_relampago)
  f.ativa.checked = q ? Boolean(q.ativa) : true
  $('tituloForm').textContent = q ? `Editando ${q.id}` : 'Nova questão'
  $('apagar').hidden = !q
  retorno('', '')
}

function editar (id) {
  selecionada = id
  preencher(lista.find(q => q.id === id))
  desenharLista()
}

function nova () {
  selecionada = null
  preencher(null)
  desenharLista()
  $('form').id.focus()
}

async function carregar () {
  const { ok, corpo } = await chamar('/api/painel/questoes')
  if (!ok) { $('resumo').textContent = 'chave inválida'; return }
  lista = corpo
  desenharLista()
}

$('form').addEventListener('submit', async evento => {
  evento.preventDefault()
  const f = $('form')
  const dados = {
    id: f.id.value.trim(), gabarito: f.gabarito.value, categoria: f.categoria.value,
    texto: f.texto.value, explicacao: f.explicacao.value,
    essencial: f.essencial.checked, e_relampago: f.e_relampago.checked, ativa: f.ativa.checked
  }
  const { ok, corpo } = selecionada
    ? await chamar(`/api/painel/questoes/${encodeURIComponent(selecionada)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) })
    : await chamar('/api/painel/questoes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados) })
  if (!ok) {
    const msg = corpo?.motivo === 'ja_existe' ? `já existe uma questão com o id ${dados.id}` : (corpo?.erros ?? ['falhou']).join('\n')
    retorno(msg, 'erro'); return
  }
  await carregar()
  editar(corpo.id)
  retorno(selecionada ? 'salvo' : 'criada', 'ok')
})

$('apagar').addEventListener('click', async () => {
  if (!selecionada || !confirm(`Apagar ${selecionada}? Não dá para desfazer.`)) return
  const { ok, corpo } = await chamar(`/api/painel/questoes/${encodeURIComponent(selecionada)}`, { method: 'DELETE' })
  if (!ok) {
    retorno(corpo?.motivo === 'em_uso'
      ? `${selecionada} já foi usada em ${corpo.usos} rodada(s) e não pode ser apagada. Desmarque "ativa" e salve: ela sai das próximas rodadas sem perder o histórico.`
      : 'falhou', 'erro')
    return
  }
  await carregar()
  nova()
  retorno('apagada', 'ok')
})

$('nova').addEventListener('click', nova)

$('arquivo').addEventListener('change', async () => {
  const arquivo = $('arquivo').files[0]
  if (!arquivo) return
  const texto = await arquivo.text()
  $('arquivo').value = ''
  if (!confirm(`Importar ${arquivo.name}? Questões com id já existente serão atualizadas.`)) return
  const { ok, corpo } = await chamar('/api/painel/questoes/importar', { method: 'POST', headers: { 'content-type': 'text/csv' }, body: texto })
  if (!ok) {
    const linhas = (corpo?.erros ?? []).map(e => `${e.linha ? `linha ${e.linha}: ` : ''}${e.erros.join('; ')}`)
    retorno(`nada foi importado:\n${linhas.join('\n') || 'falhou'}`, 'erro'); return
  }
  await carregar()
  retorno(`importado: ${corpo.inseridas} nova(s), ${corpo.atualizadas} atualizada(s)`, 'ok')
})

$('exportar').href = comChave('/api/painel/questoes.csv')
$('linkPainel').href = comChave('/painel.html')
preencher(null)
carregar()
