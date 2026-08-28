// modal.js — diálogos do sistema. Substitui confirm()/alert() do navegador,
// que ignoram a identidade visual e não permitem gate de digitação.
const escapar = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function montar () {
  let dlg = document.getElementById('modal')
  if (dlg) return dlg
  dlg = document.createElement('dialog')
  dlg.id = 'modal'
  document.body.appendChild(dlg)
  return dlg
}

// Devolve uma promessa que resolve true (confirmou) ou false (cancelou).
// `digitar` exige que a pessoa escreva a palavra antes de poder confirmar —
// o gate para o que não tem volta.
export function confirmar ({
  titulo, texto = '', detalhe = '', rotuloConfirmar = 'Confirmar',
  rotuloCancelar = 'Cancelar', perigo = false, digitar = null
}) {
  const dlg = montar()
  dlg.className = perigo ? 'perigo' : ''
  dlg.innerHTML = `
    <form method="dialog">
      <div class="etiq modal-etiq">${perigo ? 'Atenção' : 'Confirmar'}</div>
      <h2 class="disp">${escapar(titulo)}</h2>
      ${texto ? `<p>${escapar(texto)}</p>` : ''}
      ${detalhe ? `<p class="modal-detalhe">${escapar(detalhe)}</p>` : ''}
      ${digitar ? `
        <label class="modal-gate">
          <span class="etiq">digite <strong>${escapar(digitar)}</strong> para liberar</span>
          <input id="modalDigitar" autocomplete="off" spellcheck="false">
        </label>` : ''}
      <div class="modal-acoes">
        <button value="nao" class="acao">${escapar(rotuloCancelar)}</button>
        <button value="sim" id="modalOk" class="acao ${perigo ? 'fantasma' : 'principal'}"
          ${digitar ? 'disabled' : ''}>${escapar(rotuloConfirmar)}</button>
      </div>
    </form>`

  return new Promise(resolve => {
    const ok = dlg.querySelector('#modalOk')
    const campo = dlg.querySelector('#modalDigitar')
    if (campo) {
      campo.addEventListener('input', () => { ok.disabled = campo.value.trim() !== digitar })
    }
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'sim'), { once: true })
    dlg.showModal()
    ;(campo ?? dlg.querySelector('button[value="nao"]')).focus()
  })
}

export function avisar ({ titulo, texto = '', detalhe = '', rotulo = 'Entendi' }) {
  const dlg = montar()
  dlg.className = ''
  dlg.innerHTML = `
    <form method="dialog">
      <div class="etiq modal-etiq">Aviso</div>
      <h2 class="disp">${escapar(titulo)}</h2>
      ${texto ? `<p>${escapar(texto)}</p>` : ''}
      ${detalhe ? `<p class="modal-detalhe">${escapar(detalhe)}</p>` : ''}
      <div class="modal-acoes">
        <button value="ok" class="acao principal">${escapar(rotulo)}</button>
      </div>
    </form>`
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(), { once: true })
    dlg.showModal()
    dlg.querySelector('button').focus()
  })
}
