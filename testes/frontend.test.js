import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { abrirBanco } from '../src/db.js'
import { montarPassos, larguraSegmentos } from '../src/publico/telao.js'

const PUBLICO = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src', 'publico')
const ler = arquivo => fs.readFileSync(path.join(PUBLICO, arquivo), 'utf8')

// ---------- participante ----------

test('a tela do participante não embute gabarito nem explicação', () => {
  const fonte = ler('quiz.html') + ler('quiz.js')
  const questoes = abrirBanco(':memory:').prepare('SELECT texto, explicacao FROM questao').all()
  for (const q of questoes) {
    assert.ok(!fonte.includes(q.explicacao), 'uma explicação está embutida na tela do quiz')
    assert.ok(!fonte.includes(q.texto), 'um enunciado está embutido na tela do quiz')
  }
})

test('a tela do participante não chama nenhuma rota do painel', () => {
  const fonte = ler('quiz.js')
  assert.ok(!fonte.includes('/api/painel'))
  assert.ok(!fonte.includes('/stream/painel'))
})

test('nenhum módulo do servidor identifica ou bloqueia por IP', () => {
  const SRC = path.dirname(PUBLICO)
  for (const arquivo of fs.readdirSync(SRC).filter(a => a.endsWith('.js'))) {
    const fonte = fs.readFileSync(path.join(SRC, arquivo), 'utf8')
    assert.ok(!/req\.ip|remoteAddress|x-forwarded-for/i.test(fonte),
      `${arquivo} usa o IP do participante, e a spec proíbe: na reunião online cada um vem de uma rede, mas a trava é o token, nunca o IP`)
  }
})

test('as cinco telas existem e declaram a folha compartilhada', () => {
  for (const arquivo of ['quiz.html', 'telao.html', 'painel.html', 'questoes.html', 'historico.html']) {
    assert.match(ler(arquivo), /comum\.css/, `${arquivo} não carrega comum.css`)
  }
})

test('a paleta é a da marca, e não o par verde/vermelho reprovado', () => {
  const css = ler('comum.css')
  assert.match(css, /--navy:\s*#29235c/)
  assert.match(css, /--laranja:\s*#ff8000/)
  assert.match(css, /--teal:\s*#169194/)
  assert.ok(!/#0ca30c/i.test(css), 'o verde reprovado no gate de daltonismo voltou')
  assert.ok(!/#d03b3b/i.test(css), 'o vermelho reprovado no gate de daltonismo voltou')
})

test('nada de canto arredondado nem sombra difusa: a composição é chapada', () => {
  const css = ler('comum.css')
  assert.ok(!/border-radius/.test(css), 'canto arredondado não pertence a esta composição')
  for (const sombra of css.match(/box-shadow:[^;]+/g) ?? []) {
    // Cada sombra da lista precisa ter desfoque zero: "x y 0 cor" ou "inset 0 0 0 2px".
    for (const uma of sombra.replace('box-shadow:', '').split(',')) {
      if (/none/.test(uma)) continue
      const partes = uma.trim().replace(/^inset\s+/, '').split(/\s+/)
      assert.equal(partes[2], '0', `sombra com desfoque em "${uma.trim()}" — o relevo é bloco de aresta dura`)
    }
  }
})

test('a tela do participante cabe na janela do celular sem rolar', () => {
  const html = ler('quiz.html')
  assert.match(html, /100dvh/, 'altura dinâmica: 100vh conta a área atrás da barra de endereço')
  assert.match(html, /body\s*\{[^}]*overflow:\s*hidden/, 'o corpo não rola')
  assert.match(ler('quiz.js'), /enunciado-caixa/, 'o enunciado é quem rola, se precisar')
})

test('os títulos do quiz têm tamanho fluido: palavra larga não vaza em tela estreita', () => {
  const fonte = ler('quiz.js')
  const fixos = fonte.match(/class="(?:disp|num)"[^>]*style="[^"]*font-size:\d+px/g) ?? []
  assert.deepEqual(fixos, [], 'título com font-size fixo em px: use disp-xl/l/m/s ou num-xl/l')
  assert.match(ler('comum.css'), /\.disp\s*\{[^}]*overflow-wrap:\s*anywhere/, 'a rede de segurança precisa existir')
})

test('o quiz se recupera de sessão órfã em vez de repetir a mesma questão', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /function reentrar/, 'precisa existir um caminho de reentrada')
  // 401 (sessão órfã) e 503 (rodada trocada/ausente) não podem cair no ramo
  // que apenas redesenha: isso é o loop infinito.
  assert.match(fonte, /401/, 'o 401 precisa ser tratado explicitamente')
  assert.match(fonte, /estado\.rodada/, 'o cliente precisa acompanhar qual rodada está observando')
})

test('o subtítulo do botão é legível e não empurra os botões para empilhar', () => {
  const css = ler('comum.css')
  const nota = css.match(/\.opcao \.nota\s*\{[^}]*\}/)[0]
  const tamanho = Number(nota.match(/font-size:\s*(\d+)px/)[1])
  assert.ok(tamanho >= 15, `subtítulo com ${tamanho}px é pequeno demais para leitura`)
  assert.match(nota, /line-height/, 'precisa de entrelinha quando quebra em duas linhas')
  // Com a nota maior, a base do botão encolhe na tela estreita para os dois
  // continuarem lado a lado até 320px.
  const estreita = css.slice(css.indexOf('@media (max-width: 420px)'))
  assert.match(estreita, /flex-basis:\s*12\dpx/, 'sem base menor, 320px empilha')
})

test('os campos não encolhem: numa coluna que rola, o texto vazaria da cor de fundo', () => {
  const css = ler('comum.css')
  const campo = css.match(/^\.campo\s+\{[^}]*\}/m)[0]
  assert.match(campo, /flex-shrink:\s*0/,
    'sem isto o flex esmaga as caixas do resultado e o feedback sai para fora do azul')
  // Quem precisa absorver o espaço sobrescreve depois.
  assert.match(css, /\.enunciado-caixa\s*\{[^}]*flex:\s*1 1 auto/,
    'o enunciado ainda precisa encolher e rolar')
})

test('o fechamento do telão fala com quem está lendo', () => {
  const fonte = ler('telao.js')
  assert.ok(!/resultado de cada um/.test(fonte), 'a frase antiga falava sobre as pessoas, não com elas')
  assert.match(fonte, /o seu resultado está na sua tela/)
})

test('a sala de espera explica a dinâmica antes de começar', () => {
  const fonte = ler('quiz.js')
  const espera = fonte.slice(fonte.indexOf("estado.fase === 'espera'"), fonte.indexOf('const questao = pendente()'))
  assert.match(espera, /Como vai ser/)
  assert.match(espera, /class="passos"/)
  assert.equal((espera.match(/<li>/g) ?? []).length, 3, 'três passos: curto o bastante para caber')
  // O tutorial diz o tempo real da trava, não um número inventado.
  assert.match(espera, /estado\.segundosTrava/)
  // A relâmpago não é anunciada antes: a chamada com o raio é a surpresa.
  assert.ok(!/relâmpago/i.test(espera), 'antecipar a relâmpago estraga o efeito e contamina o A/B')
  assert.match(ler('comum.css'), /\.passos li::before/, 'os passos são numerados por CSS')
})

test('o QR fica na tela durante a dinâmica, para quem chega atrasado', () => {
  const fonte = ler('telao.js')
  const respondendo = fonte.slice(fonte.indexOf('const telaRespondendo'), fonte.indexOf('const telaPlacar'))
  assert.match(respondendo, /qr\.svg/, 'sem isso o retardatário não tem como entrar')
  assert.match(respondendo, /Chegou agora/)
  assert.match(respondendo, /location\.host/, 'o link escrito acompanha o QR')
})

test('o QR é quadrado nas duas telas em que aparece', () => {
  const css = ler('telao.css')
  assert.match(css, /\.cartaz \.qr-caixa/, 'a caixa absorve o espaço')
  assert.match(css, /\.cartaz \.qr \{[^}]*aspect-ratio: 1/)
  assert.match(css, /\.cartaz \.qr \{[^}]*max-height: 100%/, 'sem o teto de altura a imagem estica')
  // Uma regra solta depois desta desfazia o limite: não pode voltar.
  const depois = css.slice(css.indexOf('.cartaz .qr {'))
  assert.ok(!/^\.qr \{/m.test(depois), 'regra .qr solta sobrescreveria o limite de altura')
})

test('o botão travado perde o relevo', () => {
  const css = ler('comum.css')
  const travado = css.match(/\.opcao:disabled\s*\{[^}]*\}/)
  assert.ok(travado, 'falta o estado :disabled do botão')
  assert.match(travado[0], /box-shadow:\s*none/, 'travado não é apertável, então não pode parecer levantado')
})

test('o quiz carimba a entrega de toda questão, não só do relâmpago', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /\/api\/entregar/)
  const trecho = fonte.slice(Math.max(0, fonte.indexOf('/api/entregar') - 400), fonte.indexOf('/api/entregar'))
  assert.ok(!/eRelampago[^\n]*\)\s*\{[^}]*$/.test(trecho),
    'entregar precisa valer para toda questão: é o que arma a trava')
})

test('o aviso da trava fala com o participante a cada questão', () => {
  assert.match(ler('quiz.js'), /liberam em/, 'o participante precisa saber por que os botões estão mortos')
})

test('só o grupo do cronômetro lê o aviso dos 10 segundos', () => {
  const fonte = ler('quiz.js')
  const preparacao = fonte.slice(fonte.indexOf('function desenharPreparacao'))
  assert.match(preparacao, /comCronometro/,
    'a tela de preparação precisa ramificar por grupo — o aviso de tempo é o próprio tratamento do A/B')
})

// ---------- telão ----------

const agregadoFalso = (armadilhas = 3) => ({
  fase: 'revelado', passoDebrief: 0,
  conectados: 48, respondendo: 4, finalizados: 44,
  placar: { decisoes: 176, acertos: 132, percentual: 75 },
  porCategoria: [{ categoria: 'sintese de material proprio', total: 40, acertos: 36, percentual: 90 }],
  armadilhas: Array.from({ length: armadilhas }, (_, i) => ({
    id: `Q${i}`, texto: 't', gabarito: 'busca', explicacao: 'e', total: 18, acertos: 6, percentualErro: 67
  })),
  relampago: {
    cronometro: { total: 24, acertos: 12, expirados: 3, percentual: 50 },
    controle: { total: 24, acertos: 19, expirados: 0, percentual: 79 }
  }
})

test('o debrief tem placar, categorias, uma tela por armadilha, o A/B e o fechamento', () => {
  const passos = montarPassos(agregadoFalso(3))
  assert.deepEqual(passos.map(p => p.tipo),
    ['placar', 'categorias', 'armadilha', 'armadilha', 'armadilha', 'relampago', 'fechamento'])
})

test('sem armadilhas suficientes o debrief encurta sozinho', () => {
  assert.deepEqual(montarPassos(agregadoFalso(0)).map(p => p.tipo),
    ['placar', 'categorias', 'relampago', 'fechamento'])
})

test('os segmentos da barra somam 100% e o vão nunca some', () => {
  const larguras = larguraSegmentos([{ valor: 12 }, { valor: 5 }, { valor: 1 }])
  assert.equal(Math.round(larguras.reduce((s, l) => s + l, 0)), 100)
  assert.ok(larguras.every(l => l > 0))
})

test('barra com um segmento só ocupa a largura inteira', () => {
  assert.deepEqual(larguraSegmentos([{ valor: 9 }]), [100])
})

test('barra sem dado nenhum não vira NaN', () => {
  assert.deepEqual(larguraSegmentos([]), [])
  assert.deepEqual(larguraSegmentos([{ valor: 0 }, { valor: 0 }]), [0, 0])
})

test('a sala de espera do telão mostra o QR junto com a URL', () => {
  const fonte = ler('telao.js')
  const espera = fonte.slice(fonte.indexOf('const telaEspera'), fonte.indexOf('const telaRespondendo'))
  assert.match(espera, /\/qr\.svg/, 'o QR precisa estar na tela de espera')
  assert.match(espera, /location\.host/, 'a URL escrita continua ao lado do QR')
})

test('o telão não embute a chave do painel no código', () => {
  const fonte = ler('telao.js') + ler('telao.html')
  assert.ok(!/ADMIN_KEY|chave-de-teste/.test(fonte), 'a chave deve vir da URL, nunca embutida')
})

// ---------- painel ----------

test('o painel prevê o número de questões antes de criar a rodada', async () => {
  const { calcularQuestoesAtivas } = await import('../src/distribuicao.js')
  assert.match(ler('painel.js'), /calcularQuestoesAtivas/, 'o painel precisa mostrar a previsão antes de confirmar')
  assert.equal(calcularQuestoesAtivas(45), 10)
})

test('o painel avisa que não deve ser compartilhado', () => {
  assert.match(ler('painel.html'), /não compartilhe|nao compartilhe/i)
})

test('o painel manda a trava ao criar a rodada', () => {
  assert.match(ler('painel.js'), /segundosTrava/)
})

// ---------- encerrar para todos ----------

test('cada tela reage à fase encerrado', () => {
  assert.match(ler('telao.js'), /'encerrado'/, 'o telão vai para o fechamento')
  assert.match(ler('painel.html'), /Encerrar para todos/)
  assert.match(ler('painel.js'), /fase: 'encerrado'/)
  assert.match(ler('painel.js'), /inclusive de quem não terminou/, 'o host precisa saber o que encerrar faz')
})

test('ENCERRAMENTO SILENCIOSO: revelar não tira a pergunta de quem ainda responde', () => {
  const fonte = ler('quiz.js')
  const desenhar = fonte.slice(fonte.indexOf('async function desenhar'), fonte.indexOf('function ouvirEstado'))
  // A tela de "Revelando" só pode aparecer depois de checar se sobrou pergunta.
  const ondeResponde = desenhar.indexOf("estado.fase === 'revelado'))")
  const ondeEspera = desenhar.indexOf("marcador.textContent = 'Revelando'")
  assert.ok(ondeResponde > 0 && ondeEspera > ondeResponde,
    'quem tem pergunta pendente continua respondendo mesmo depois de revelar')
})

test('o resultado distingue quem não respondeu de quem errou', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /semResposta/)
  assert.match(fonte, /'Não respondeu'/)
  assert.match(fonte, /ficaram sem resposta/, 'o placar pessoal precisa dizer que sobrou pergunta em branco')
})

test('resposta recusada por fase não pode avançar a tela como se tivesse gravado', () => {
  assert.match(ler('quiz.js'), /motivo === 'fase_invalida'/,
    'sem isso a pessoa passa pelas perguntas achando que respondeu')
})

// ---------- gestão de questões ----------

test('a gestão de questões fala com as rotas certas e nunca embute a chave', () => {
  const fonte = ler('questoes.js')
  for (const rota of ['/api/painel/questoes', '/api/painel/questoes.csv', '/api/painel/questoes/importar']) {
    assert.ok(fonte.includes(rota), `falta ${rota}`)
  }
  assert.ok(!/ADMIN_KEY|chave-de-teste/.test(fonte))
  assert.match(fonte, /'text\/csv'/, 'o CSV sobe como texto cru')
})

test('o painel leva à gestão de questões', () => {
  assert.match(ler('painel.js'), /questoes\.html/)
})

// ---------- gate da revelação ----------

test('o participante espera o fim da apresentação para ver o placar pessoal', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /resultadoLiberado/, 'o cliente precisa respeitar o gate')
  assert.match(fonte, /saindo|daqui a pouco/, 'e avisar que o resultado dele vem depois')
})

test('o painel mostra ao host se o placar pessoal ainda está represado', () => {
  assert.match(ler('painel.js'), /resultadoLiberado/)
  assert.match(ler('painel.html'), /gateTexto/)
})

// ---------- histórico ----------

test('a página de histórico fala com as rotas de sessões', () => {
  const fonte = ler('historico.js')
  assert.match(fonte, /\/api\/painel\/sessoes/)
  assert.ok(!/ADMIN_KEY|Nael/.test(fonte), 'a chave vem da URL')
  assert.match(fonte, /zerar uma rodada apaga o histórico/, 'o risco precisa estar dito na tela')
})

test('o painel leva ao histórico', () => {
  assert.match(ler('painel.js'), /historico\.html/)
})

// ---------- telão ----------

test('o telão mostra o enunciado da armadilha em corpo grande', () => {
  assert.match(ler('telao.js'), /t-enunciado/)
  assert.match(ler('telao.css'), /\.t-enunciado[^}]*font-size/)
})

test('a tela do relâmpago se identifica e usa barras maiores', () => {
  const fonte = ler('telao.js')
  assert.match(fonte, /A pergunta relâmpago/)
  assert.match(fonte, /'gorda'/)
  assert.match(ler('telao.css'), /\.trilho\.gorda/)
})

test('o fechamento agradece', () => {
  assert.match(ler('telao.js'), /Muito obrigado/)
})

test('a legenda do placar fica junto da porcentagem, no mesmo campo', () => {
  const placar = ler('telao.js')
  const tela = placar.slice(placar.indexOf('const telaPlacar'), placar.indexOf('const telaCategorias'))
  const campoHeroi = tela.slice(tela.indexOf('t-heroi'), tela.indexOf('</div>', tela.indexOf('t-legenda-heroi')))
  assert.match(campoHeroi, /t-legenda-heroi/, 'a frase precisa estar no mesmo campo da porcentagem')
})

// ---------- diálogos padronizados ----------

test('nenhuma tela usa confirm() ou alert() do navegador', () => {
  for (const arquivo of ['painel.js', 'questoes.js', 'historico.js', 'quiz.js', 'telao.js']) {
    const fonte = ler(arquivo)
    assert.ok(!/(^|[^.\w])confirm\s*\(/.test(fonte), `${arquivo} ainda usa confirm() nativo`)
    assert.ok(!/(^|[^.\w])alert\s*\(/.test(fonte), `${arquivo} ainda usa alert() nativo`)
  }
})

test('o modal compartilhado existe e é usado pelas telas de administração', () => {
  const modal = ler('modal.js')
  assert.match(modal, /export function confirmar/)
  assert.match(modal, /export function avisar/)
  assert.match(modal, /showModal/, 'usa <dialog> nativo, que já trata foco e Escape')
  for (const arquivo of ['painel.js', 'questoes.js']) {
    assert.match(ler(arquivo), /from '\/modal\.js'/, `${arquivo} não importa o modal`)
  }
})

test('o modal escapa o conteúdo que injeta', () => {
  assert.match(ler('modal.js'), /const escapar/, 'títulos e textos vêm de dados, precisam ser escapados')
})

// ---------- arquivar e o gate do zerar ----------

test('o painel oferece arquivar e explica a diferença para zerar', () => {
  assert.match(ler('painel.html'), /Arquivar e abrir nova/)
  assert.match(ler('painel.html'), /guarda esta sessão no histórico/)
  assert.match(ler('painel.js'), /\/api\/painel\/arquivar/)
})

test('zerar com gente dentro exige digitar para liberar', () => {
  const fonte = ler('painel.js')
  const bloco = fonte.slice(fonte.indexOf("$('zerar')"))
  assert.match(bloco, /digitar: 'ZERAR'/, 'o caminho sem volta precisa do gate de digitação')
  assert.match(bloco, /perigo: true/)
  assert.match(bloco, /não tem volta/)
  assert.match(bloco, /use Arquivar/, 'o modal precisa apontar a alternativa não destrutiva')
})

test('apagar questão também passa pelo gate de digitação', () => {
  const fonte = ler('questoes.js')
  const bloco = fonte.slice(fonte.indexOf("$('apagar')"))
  assert.match(bloco, /digitar: selecionada/)
  assert.match(bloco, /perigo: true/)
})

// ---------- ritmo e chamada do relâmpago ----------

test('a tela de preparação avança sozinha, sem depender do clique', () => {
  const fonte = ler('quiz.js')
  const bloco = fonte.slice(fonte.indexOf('function desenharPreparacao'), fonte.indexOf('function desenharResultado'))
  assert.match(bloco, /Começa em/, 'precisa contar para o participante')
  assert.match(bloco, /estado\.preparado = true/, 'e avançar sozinha')
  assert.ok(!/id="pronto"|addEventListener\('click'/.test(bloco), 'não pode depender de um botão')
})

test('a chamada anuncia a pergunta relâmpago por escrito', () => {
  assert.match(ler('quiz.js'), /Pergunta<br>Relâmpago!/, 'o rótulo da chamada precisa nomear a pergunta')
})

test('a chamada do relâmpago existe, é configurável e não come o cronômetro', () => {
  const fonte = ler('quiz.js')
  assert.match(fonte, /function tocarChamada/)
  assert.match(fonte, /'nenhuma'/, 'precisa poder ser desligada')
  assert.match(fonte, /tocarChamada\(\)\.then\(entregar\)/,
    'a entrega, que inicia o cronômetro, só acontece depois da animação')
})

test('a chamada respeita quem pediu menos movimento', () => {
  assert.match(ler('comum.css'), /prefers-reduced-motion[\s\S]*?\.chamada/, 'precisa ter alternativa sem animação')
})

test('o painel ajusta o ritmo sem recriar a rodada', () => {
  assert.match(ler('painel.html'), /Botões travados \(s\)/)
  assert.match(ler('painel.html'), /Aviso do relâmpago \(s\)/)
  assert.match(ler('painel.html'), /Chamada do relâmpago/)
  assert.match(ler('painel.js'), /\/api\/painel\/ajustes/)
  assert.match(ler('painel.html'), /não precisa recriar a rodada/)
})

// ---------- RTQuiz é a plataforma, o título é da rodada ----------

test('as telas se chamam RTQuiz, sem o tema fixo no código', () => {
  for (const arquivo of ['quiz.html', 'telao.html', 'painel.html', 'questoes.html', 'historico.html']) {
    const fonte = ler(arquivo)
    assert.match(fonte, /RTQuiz/, `${arquivo} não menciona a plataforma`)
    // O placeholder do campo é a única aparição legítima do tema numa tela.
    const semPlaceholder = fonte.replace(/placeholder="[^"]*"/g, '')
    assert.ok(!/Confere ou Confia/.test(semPlaceholder),
      `${arquivo} ainda tem o tema fixo — ele agora vem da rodada`)
  }
  assert.ok(!/Confere ou Confia/.test(ler('telao.js')), 'o telão lê o título da rodada')
})

test('o título da rodada chega ao cabeçalho do quiz e do telão', () => {
  assert.match(ler('quiz.js'), /cabecaTitulo\.textContent = estado\.titulo/)
  assert.match(ler('telao.js'), /ajustes\?\.titulo/)
})

test('trocar o título ao vivo atualiza o quiz sem redesenhar a questão', () => {
  const fonte = ler('quiz.js')
  const ouvinte = fonte.slice(fonte.indexOf('function ouvirEstado'))
  assert.match(ouvinte, /cabecaTitulo\.textContent/,
    'o cabeçalho precisa acompanhar sem passar por desenhar(), que reiniciaria a trava')
})

test('o painel edita o título junto com o ritmo', () => {
  assert.match(ler('painel.html'), /Título desta dinâmica/)
  assert.match(ler('painel.js'), /titulo: \$\('titulo'\)\.value/)
})

test('o histórico identifica a sessão pelo tema, não só pela data', () => {
  assert.match(ler('historico.js'), /escapar\(s\.titulo\)/)
})
