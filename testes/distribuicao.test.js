import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularQuestoesAtivas, selecionarQuestoesAtivas,
  sortearAtribuicao, grupoPorOrdemChegada
} from '../src/distribuicao.js'
import { abrirBanco } from '../src/db.js'

const banco = () => abrirBanco(':memory:').prepare('SELECT * FROM questao').all()

// ---------- dimensionamento ----------

test('dimensionamento bate com a tabela da spec', () => {
  assert.equal(calcularQuestoesAtivas(20), 6)
  assert.equal(calcularQuestoesAtivas(30), 8)
  assert.equal(calcularQuestoesAtivas(45), 10)
  assert.equal(calcularQuestoesAtivas(50), 12)
})

test('dimensionamento respeita o piso de 6 e o teto de 14', () => {
  assert.equal(calcularQuestoesAtivas(1), 6)
  assert.equal(calcularQuestoesAtivas(5), 6)
  assert.equal(calcularQuestoesAtivas(200), 14)
})

test('dimensionamento sempre devolve número par', () => {
  for (let p = 1; p <= 120; p++) {
    assert.equal(calcularQuestoesAtivas(p) % 2, 0, `previsão ${p} devolveu ímpar`)
  }
})

// ---------- seleção estratificada ----------

test('a seleção devolve k questões, metade de cada gabarito', () => {
  for (const k of [6, 8, 10, 12, 14]) {
    const sel = selecionarQuestoesAtivas(banco(), k)
    assert.equal(sel.length, k)
    assert.equal(sel.filter(q => q.gabarito === 'busca').length, k / 2)
    assert.equal(sel.filter(q => q.gabarito === 'redacao').length, k / 2)
  }
})

test('a seleção nunca inclui a questão relâmpago', () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(!selecionarQuestoesAtivas(banco(), 6).some(q => q.e_relampago))
  }
})

test('a seleção sempre inclui todas as essenciais', () => {
  const essenciais = banco().filter(q => q.essencial && !q.e_relampago).map(q => q.id)
  for (let i = 0; i < 50; i++) {
    const ids = selecionarQuestoesAtivas(banco(), 6).map(q => q.id)
    for (const e of essenciais) assert.ok(ids.includes(e), `faltou a essencial ${e}`)
  }
})

test('a seleção varia categorias antes de repetir uma já representada', () => {
  // O lado busca tem 5 categorias distintas; com k/2 = 5 todas devem aparecer.
  const categoriasBusca = new Set(banco().filter(q => q.gabarito === 'busca').map(q => q.categoria))
  for (let i = 0; i < 50; i++) {
    const lado = selecionarQuestoesAtivas(banco(), 10).filter(q => q.gabarito === 'busca')
    const cats = new Set(lado.map(q => q.categoria))
    assert.equal(cats.size, categoriasBusca.size, 'todas as categorias de busca deveriam estar representadas')
  }
})

test('a seleção rejeita k ímpar', () => {
  assert.throws(() => selecionarQuestoesAtivas(banco(), 7), /par/)
})

test('a seleção rejeita banco insuficiente', () => {
  const poucas = banco().filter(q => q.gabarito === 'busca').slice(0, 2)
  assert.throws(() => selecionarQuestoesAtivas(poucas, 6), /insuficiente/)
})

// ---------- rodízio ----------

test('cada participante recebe 4 questões, 2 de cada gabarito', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 10)
  for (let i = 0; i < 50; i++) {
    const a = sortearAtribuicao(ativas, {})
    assert.equal(a.length, 4)
    assert.equal(a.filter(q => q.gabarito === 'busca').length, 2)
    assert.equal(a.filter(q => q.gabarito === 'redacao').length, 2)
  }
})

test('o participante nunca recebe a mesma questão duas vezes', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6)
  for (let i = 0; i < 100; i++) {
    const ids = sortearAtribuicao(ativas, {}).map(q => q.id)
    assert.equal(new Set(ids).size, 4)
  }
})

test('com 50 participantes o rodízio mantém a diferença de uso em no máximo 1', () => {
  for (const k of [6, 10, 14]) {
    const ativas = selecionarQuestoesAtivas(banco(), k)
    const contagens = Object.fromEntries(ativas.map(q => [q.id, 0]))
    for (let p = 0; p < 50; p++) {
      for (const q of sortearAtribuicao(ativas, contagens)) contagens[q.id]++
    }
    // O equilíbrio vale dentro de cada gabarito: os lados têm demandas iguais.
    for (const gabarito of ['busca', 'redacao']) {
      const usos = ativas.filter(q => q.gabarito === gabarito).map(q => contagens[q.id])
      assert.ok(Math.max(...usos) - Math.min(...usos) <= 1,
        `k=${k} ${gabarito}: usos ${usos.join(',')}`)
    }
  }
})

test('a ordem das 4 questões varia entre participantes', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6)
  const ordens = new Set()
  for (let i = 0; i < 60; i++) ordens.add(sortearAtribuicao(ativas, {}).map(q => q.id).join('-'))
  assert.ok(ordens.size > 1, 'a ordem deveria variar entre participantes')
})

test('sortearAtribuicao rejeita rodada com menos de 2 questões de um gabarito', () => {
  const ativas = selecionarQuestoesAtivas(banco(), 6).filter(q => q.gabarito === 'busca')
  assert.throws(() => sortearAtribuicao(ativas, {}), /insuficientes/)
})

// ---------- grupo A/B ----------

test('o grupo A/B alterna por ordem de chegada e fecha 50/50 em 50 pessoas', () => {
  assert.equal(grupoPorOrdemChegada(1), 'controle')
  assert.equal(grupoPorOrdemChegada(2), 'cronometro')
  const grupos = Array.from({ length: 50 }, (_, i) => grupoPorOrdemChegada(i + 1))
  assert.equal(grupos.filter(g => g === 'cronometro').length, 25)
})

test('o grupo A/B fica em 50/50 com folga de 1 em público ímpar', () => {
  const grupos = Array.from({ length: 47 }, (_, i) => grupoPorOrdemChegada(i + 1))
  const c = grupos.filter(g => g === 'cronometro').length
  assert.ok(Math.abs(c - (47 - c)) <= 1)
})
