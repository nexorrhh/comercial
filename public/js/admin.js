async function cargarUsuarios() {
  const usuarios = await api('GET', '/api/usuarios');
  document.getElementById('tbody-usuarios').innerHTML = usuarios.map((u) => `
    <tr>
      <td>${escapeHtml(u.username)}</td>
      <td>${escapeHtml(u.nombre_completo)}</td>
      <td>${escapeHtml(u.rol)}</td>
      <td>${u.activo ? 'Sí' : 'No'}</td>
      <td>
        <button class="secundario" data-toggle="${u.id}" data-activo="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>
        <button class="secundario" data-clave="${u.id}">Cambiar contraseña</button>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('PUT', `/api/usuarios/${btn.dataset.toggle}`, { activo: btn.dataset.activo === '1' ? 0 : 1 });
      cargarUsuarios();
    });
  });

  document.querySelectorAll('[data-clave]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nueva = prompt('Nueva contraseña para este usuario:');
      if (!nueva) return;
      await api('PUT', `/api/usuarios/${btn.dataset.clave}`, { password: nueva });
      alert('Contraseña actualizada.');
    });
  });
}

async function crearUsuario() {
  const errorEl = document.getElementById('error-usuario');
  errorEl.textContent = '';
  try {
    await api('POST', '/api/usuarios', {
      username: document.getElementById('u-username').value.trim(),
      nombre_completo: document.getElementById('u-nombre').value.trim(),
      password: document.getElementById('u-password').value,
      rol: document.getElementById('u-rol').value,
    });
    document.getElementById('u-username').value = '';
    document.getElementById('u-nombre').value = '';
    document.getElementById('u-password').value = '';
    cargarUsuarios();
  } catch (e) {
    errorEl.textContent = e.message;
  }
}

async function cargarCatalogos() {
  const { categorias, cotizadores } = await api('GET', '/api/catalogos');
  document.getElementById('lista-categorias').innerHTML = categorias.map((c) => `<span class="pill pill-nc" style="margin:2px;">${escapeHtml(c.nombre)}</span>`).join(' ');
  document.getElementById('lista-cotizadores').innerHTML = cotizadores.map((c) => `<span class="pill pill-nc" style="margin:2px;">${escapeHtml(c.iniciales)}${c.nombre_completo ? ' · ' + escapeHtml(c.nombre_completo) : ''}</span>`).join(' ');
}

async function iniciar() {
  await cargarUsuarios();
  await cargarCatalogos();

  document.getElementById('btn-crear-usuario').addEventListener('click', crearUsuario);
  document.getElementById('btn-crear-categoria').addEventListener('click', async () => {
    const nombre = document.getElementById('nueva-categoria').value.trim();
    if (!nombre) return;
    await api('POST', '/api/catalogos/categorias', { nombre });
    document.getElementById('nueva-categoria').value = '';
    cargarCatalogos();
  });
  document.getElementById('btn-crear-cotizador').addEventListener('click', async () => {
    const iniciales = document.getElementById('nuevo-cotizador-iniciales').value.trim();
    if (!iniciales) return;
    await api('POST', '/api/catalogos/cotizadores', {
      iniciales,
      nombre_completo: document.getElementById('nuevo-cotizador-nombre').value.trim(),
    });
    document.getElementById('nuevo-cotizador-iniciales').value = '';
    document.getElementById('nuevo-cotizador-nombre').value = '';
    cargarCatalogos();
  });
}

iniciar();
