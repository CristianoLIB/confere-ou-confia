// questoes.js — gestão do banco de questões: validação, CRUD e CSV.
const GABARITOS = ['busca', 'redacao', 'confiro']
export const COLUNAS = ['id', 'gabarito', 'categoria', 'essencial', 'e_relampago', 'ativa', 'texto', 'explicacao']
const BOOLEANOS = ['essencial', 'e_relampago', 'ativa']
const SEPARADOR_EXPORT = ';'   // o que o Excel em pt-BR abre direto

const verdadeiro = v => /^(1|true|sim|s|x|yes)$/i.test(String(v ?? '').trim())

// Aceita o que vem da interface, do JSON ou do CSV e devolve uma questão
// no formato do banco: strings aparadas, booleanos em 0/1.
export function normalizar (bruto) {
  const q = {}
  for (const c of COLUNAS) {
    const v = bruto?.[c]
    if (BOOLEANOS.includes(c)) q[c] = (v === undefined || v === '') ? (c === 'ativa' ? 1 : 0) : (verdadeiro(v) || v === true || v === 1 ? 1 : 0)
    else q[c] = String(v ?? '').trim()
  }
  if (q.gabarito) q.gabarito = q.gabarito.toLowerCase()
  return q
}

export function validar (q) {
  const erros = []
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(q.id)) erros.push('id: use letras, números, - ou _ (até 20)')
  if (!GABARITOS.includes(q.gabarito)) erros.push(`gabarito: precisa ser ${GABARITOS.join(', ')}`)
  if (!q.categoria) erros.push('categoria: obrigatória')
  if (!q.texto) erros.push('texto: obrigatório')
  if (!q.explicacao) erros.push('explicacao: obrigatória')
  if (q.e_relampago && q.gabarito !== 'confiro') erros.push('relâmpago: o gabarito precisa ser confiro')
  if (!q.e_relampago && q.gabarito === 'confiro') erros.push('confiro só vale para a questão relâmpago')
  return erros
}

export function listar (db) {
  return db.prepare('SELECT * FROM questao ORDER BY e_relampago, gabarito, id').all()
}

export function buscar (db, id) {
  return db.prepare('SELECT * FROM questao WHERE id = ?').get(id)
}

// Só pode haver uma relâmpago ativa: é ela que todo mundo recebe na posição 5.
function outraRelampagoAtiva (db, q) {
  if (!q.e_relampago || !q.ativa) return null
  return db.prepare('SELECT id FROM questao WHERE e_relampago = 1 AND ativa = 1 AND id <> ?').get(q.id)
}

export function salvar (db, bruto, { criar = false } = {}) {
  const q = normalizar(bruto)
  const erros = validar(q)
  if (erros.length) return { ok: false, motivo: 'invalida', erros }

  const existente = buscar(db, q.id)
  if (criar && existente) return { ok: false, motivo: 'ja_existe' }
  if (!criar && !existente) return { ok: false, motivo: 'nao_encontrada' }

  const outra = outraRelampagoAtiva(db, q)
  if (outra) return { ok: false, motivo: 'invalida', erros: [`já existe uma relâmpago ativa (${outra.id}); desative-a antes`] }

  db.prepare(`
    INSERT INTO questao (id, texto, categoria, gabarito, explicacao, essencial, e_relampago, ativa)
    VALUES (@id, @texto, @categoria, @gabarito, @explicacao, @essencial, @e_relampago, @ativa)
    ON CONFLICT(id) DO UPDATE SET
      texto = excluded.texto, categoria = excluded.categoria, gabarito = excluded.gabarito,
      explicacao = excluded.explicacao, essencial = excluded.essencial,
      e_relampago = excluded.e_relampago, ativa = excluded.ativa
  `).run(q)
  return { ok: true, questao: buscar(db, q.id), criada: !existente }
}

export function apagar (db, id) {
  if (!buscar(db, id)) return { ok: false, motivo: 'nao_encontrada' }
  const usos = db.prepare('SELECT COUNT(*) c FROM rodada_questao WHERE questao_id = ?').get(id).c
  if (usos > 0) return { ok: false, motivo: 'em_uso', usos }
  db.prepare('DELETE FROM questao WHERE id = ?').run(id)
  return { ok: true }
}

// ---------- CSV ----------

const aspear = v => `"${String(v ?? '').replace(/"/g, '""')}"`

export function paraCsv (questoes) {
  const linhas = [COLUNAS.map(aspear).join(SEPARADOR_EXPORT)]
  for (const q of questoes) linhas.push(COLUNAS.map(c => aspear(q[c])).join(SEPARADOR_EXPORT))
  return '﻿' + linhas.join('\r\n') + '\r\n'
}

// Separador: o que aparecer mais na primeira linha, fora de aspas.
function detectarSeparador (texto) {
  const primeira = texto.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '')
  const pv = (primeira.match(/;/g) ?? []).length
  const v = (primeira.match(/,/g) ?? []).length
  return pv >= v ? ';' : ','
}

// RFC 4180: campo entre aspas pode ter separador, quebra de linha e aspas dobradas.
export function analisarCsv (texto, sep = detectarSeparador(texto)) {
  texto = texto.replace(/^﻿/, '')
  const linhas = []
  let linha = []; let campo = ''; let entreAspas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++ } else entreAspas = false
      } else campo += c
      continue
    }
    if (c === '"') entreAspas = true
    else if (c === sep) { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas.filter(l => l.some(v => v.trim() !== ''))
}

export function deCsv (texto) {
  const [cabecalho, ...corpo] = analisarCsv(texto)
  if (!cabecalho) return { questoes: [], erros: ['arquivo vazio'] }
  const nomes = cabecalho.map(h => h.trim().toLowerCase())
  const faltando = ['id', 'gabarito', 'texto', 'explicacao'].filter(c => !nomes.includes(c))
  if (faltando.length) return { questoes: [], erros: [`cabeçalho sem as colunas: ${faltando.join(', ')}`] }
  const questoes = corpo.map(valores => Object.fromEntries(nomes.map((n, i) => [n, valores[i] ?? ''])))
  return { questoes, erros: [] }
}

// Tudo ou nada: se uma linha falhar, nenhuma entra. Relata os erros por linha.
export function importarCsv (db, texto) {
  const { questoes, erros: errosCabecalho } = deCsv(texto)
  if (errosCabecalho.length) return { ok: false, erros: errosCabecalho.map(e => ({ linha: 1, erros: [e] })) }

  const normalizadas = questoes.map(normalizar)
  const erros = []
  const idsVistos = new Set()
  const relampagosAtivos = []
  normalizadas.forEach((q, i) => {
    const linha = i + 2
    const e = validar(q)
    if (idsVistos.has(q.id)) e.push(`id repetido no arquivo: ${q.id}`)
    idsVistos.add(q.id)
    if (q.e_relampago && q.ativa) relampagosAtivos.push(q.id)
    if (e.length) erros.push({ linha, erros: e })
  })
  if (relampagosAtivos.length > 1) erros.push({ linha: 0, erros: [`mais de uma relâmpago ativa no arquivo: ${relampagosAtivos.join(', ')}`] })
  if (erros.length) return { ok: false, erros }

  // Relâmpago ativa no banco que não está no arquivo, se o arquivo traz outra.
  if (relampagosAtivos.length === 1) {
    const noBanco = db.prepare('SELECT id FROM questao WHERE e_relampago = 1 AND ativa = 1 AND id <> ?').get(relampagosAtivos[0])
    if (noBanco && !idsVistos.has(noBanco.id)) {
      return { ok: false, erros: [{ linha: 0, erros: [`o banco já tem a relâmpago ativa ${noBanco.id}; inclua-a no arquivo como inativa ou desative-a antes`] }] }
    }
  }

  const resultado = { ok: true, inseridas: 0, atualizadas: 0 }
  db.transaction(() => {
    for (const q of normalizadas) {
      const existia = Boolean(buscar(db, q.id))
      db.prepare(`
        INSERT INTO questao (id, texto, categoria, gabarito, explicacao, essencial, e_relampago, ativa)
        VALUES (@id, @texto, @categoria, @gabarito, @explicacao, @essencial, @e_relampago, @ativa)
        ON CONFLICT(id) DO UPDATE SET
          texto = excluded.texto, categoria = excluded.categoria, gabarito = excluded.gabarito,
          explicacao = excluded.explicacao, essencial = excluded.essencial,
          e_relampago = excluded.e_relampago, ativa = excluded.ativa
      `).run(q)
      if (existia) resultado.atualizadas++; else resultado.inseridas++
    }
  })()
  return resultado
}
