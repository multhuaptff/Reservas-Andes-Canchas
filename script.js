// script.js - Versión definitiva con formato 12h AM/PM, keep-alive y reservas recurrentes (mejorada)
let supabaseClient;
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];
let preciosConfig = [];
let clientes = [];
let currentCanchaId = null;
let currentFecha = null;
let horaInicioActual = null;
let horaFinActual = null;

// ==================== RESERVAS RECURRENTES ====================
let recurrentes = [];
let editingRecurrenteId = null;
let currentCancelRecur = null;  // para el modal de cancelación

// --- Conversión y formato de horas ---
function stringToDate(horaStr) {
    const [h, m] = horaStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

function dateToTimeString(date) {
    return `${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
}

// Formato 12h (ej: 8:00 PM)
function formatAMPM(date) {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    let ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    let minutesStr = minutes < 10 ? '0'+minutes : minutes;
    return `${hours}:${minutesStr} ${ampm}`;
}

function updateHoraInicioDisplay() {
    document.getElementById('hora-inicio').value = formatAMPM(horaInicioActual);
}
function updateHoraFinDisplay() {
    document.getElementById('hora-fin').value = formatAMPM(horaFinActual);
}
function ajustarHora(date, minutos) {
    return new Date(date.getTime() + minutos * 60000);
}
function setHoraInicio(date) {
    horaInicioActual = date;
    updateHoraInicioDisplay();
    actualizarCostoEstimadoModal();
}
function setHoraFin(date) {
    horaFinActual = date;
    updateHoraFinDisplay();
    actualizarCostoEstimadoModal();
}

// --- Tarifas y costos ---
function obtenerTarifaPorHora(tipoCancha, hora) {
    const diaInicio = 6, diaFin = 18;
    const rango = (hora >= diaInicio && hora < diaFin) ? 'dia' : 'noche';
    const precio = preciosConfig.find(p => p.tipo_cancha === tipoCancha && p.rango_nombre === rango);
    return precio ? precio.precio_por_hora : 0;
}

async function calcularCostoPorTramos(tipoCancha, fecha, horaIniDate, horaFinDate) {
    const inicio = horaIniDate.getHours() + horaIniDate.getMinutes() / 60;
    const fin = horaFinDate.getHours() + horaFinDate.getMinutes() / 60;
    const cambio = 18;
    let costo = 0;
    if (inicio < cambio && fin > cambio) {
        let duracionDia = cambio - inicio;
        let tarifaDia = obtenerTarifaPorHora(tipoCancha, inicio);
        costo += duracionDia * tarifaDia;
        let duracionNoche = fin - cambio;
        let tarifaNoche = obtenerTarifaPorHora(tipoCancha, cambio);
        costo += duracionNoche * tarifaNoche;
    } else {
        let duracion = fin - inicio;
        let tarifa = obtenerTarifaPorHora(tipoCancha, inicio);
        costo = duracion * tarifa;
    }
    return costo;
}

async function calcularCostoEsperado(canchaId, clienteId, fecha, horaIniDate, horaFinDate) {
    if (clienteId) {
        const cliente = clientes.find(c => c.id == clienteId);
        if (cliente && cliente.precio_especial_hora > 0) {
            const duracion = (horaFinDate - horaIniDate) / 3600000;
            return cliente.precio_especial_hora * duracion;
        }
    }
    const cancha = canchas.find(c => c.id === canchaId);
    if (!cancha) return 0;
    return await calcularCostoPorTramos(cancha.tipo, fecha, horaIniDate, horaFinDate);
}

async function calcularCostoEspecial(tipoEspecial, fecha, horaIniDate, horaFinDate) {
    return await calcularCostoPorTramos(tipoEspecial, fecha, horaIniDate, horaFinDate);
}

function obtenerCanchasPorNombres(nombres) {
    return canchas.filter(c => nombres.includes(c.nombre)).map(c => c.id);
}

async function verificarConflictos(canchaIds, fecha, horaIniDate, horaFinDate) {
    const horaInicioStr = dateToTimeString(horaIniDate);
    const horaFinStr = dateToTimeString(horaFinDate);
    const { data, error } = await supabaseClient
        .from('reservas')
        .select('cancha_id')
        .eq('fecha', fecha)
        .filter('hora_inicio', 'lt', horaFinStr)
        .filter('hora_fin', 'gt', horaInicioStr)
        .in('cancha_id', canchaIds);
    if (error) throw error;
    return data.length > 0;
}

// --- Inicialización de vistas ---
export async function initPublicView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
    await cargarPrecios();
    await cargarReservas();
    renderizarTabla('public');
    attachDoubleClick('public');
    console.log('Vista pública inicializada');
}

export async function initAdminView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
    await cargarPrecios();
    await cargarClientes();
    await cargarReservas();
    renderizarTabla('admin');
    attachDoubleClick('admin');
    configurarModalDinamico();
    console.log('Vista administrador inicializada');
}

export async function initRecurrentesView(supabase) {
    supabaseClient = supabase;
    await cargarClientesParaRecurrentes();
    await cargarCanchasParaRecurrentes();
    await cargarRecurrentes();
    
    document.getElementById('btn-nueva-recurrencia').onclick = () => mostrarModalRecurrencia();
    document.getElementById('btn-generar-ahora').onclick = () => generarReservasAhora();
    document.getElementById('btn-marcar-ausencias').onclick = () => marcarAusenciasAutomaticas();
    document.getElementById('guardar-recurrencia').onclick = () => guardarRecurrencia();
    document.getElementById('cancelar-recurrencia').onclick = () => cerrarModalRecurrencia();
    
    // Configurar modal de cancelación
    document.getElementById('confirmar-cancelacion').onclick = () => confirmarCancelacionSemana();
    document.getElementById('cancelar-cancelacion').onclick = () => cerrarModalCancelacion();
}

function setupCommonControls() {
    const hoy = new Date();
    const year = hoy.getFullYear();
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    const day = String(hoy.getDate()).padStart(2, '0');
    fechaActual = `${year}-${month}-${day}`;
    const fechaInput = document.getElementById('fecha');
    fechaInput.value = fechaActual;
    fechaInput.addEventListener('change', () => {
        fechaActual = fechaInput.value;
        cargarReservas().then(() => renderizarTabla(tipoVistaActual()));
    });
    document.getElementById('btn-anterior').onclick = () => cambiarFecha(-1);
    document.getElementById('btn-siguiente').onclick = () => cambiarFecha(1);
    document.getElementById('btn-hoy').onclick = () => {
        fechaActual = `${year}-${month}-${day}`;
        fechaInput.value = fechaActual;
        cargarReservas().then(() => renderizarTabla(tipoVistaActual()));
    };
    document.getElementById('granularidad').addEventListener('change', () => {
        generarSlots();
        renderizarTabla(tipoVistaActual());
    });

    startKeepAlive();
}

function tipoVistaActual() {
    return document.getElementById('modal-reserva') !== null ? 'admin' : 'public';
}

function cambiarFecha(delta) {
    const [year, month, day] = fechaActual.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + delta);
    const newYear = date.getFullYear();
    const newMonth = String(date.getMonth() + 1).padStart(2, '0');
    const newDay = String(date.getDate()).padStart(2, '0');
    fechaActual = `${newYear}-${newMonth}-${newDay}`;
    document.getElementById('fecha').value = fechaActual;
    cargarReservas().then(() => renderizarTabla(tipoVistaActual()));
}

async function cargarCanchas() {
    const { data, error } = await supabaseClient.from('canchas').select('id, nombre, tipo').order('orden');
    if (error) console.error(error);
    else canchas = data;
}

async function cargarPrecios() {
    const { data, error } = await supabaseClient.from('configuracion_precios').select('*');
    if (error) console.error(error);
    else preciosConfig = data;
}

async function cargarClientes() {
    const { data, error } = await supabaseClient.from('clientes').select('id, nombre, precio_especial_hora');
    if (error) console.error(error);
    else clientes = data;
}

async function cargarReservas() {
    const { data, error } = await supabaseClient.from('reservas').select('*').eq('fecha', fechaActual);
    if (error) console.error(error);
    else reservas = data;
}

// ==================== RESERVAS RECURRENTES: funciones auxiliares ====================
async function cargarClientesParaRecurrentes() {
    const { data, error } = await supabaseClient.from('clientes').select('id, nombre');
    if (!error && data) {
        const select = document.getElementById('recur-cliente');
        select.innerHTML = '<option value="">(Sin cliente)</option>';
        data.forEach(c => {
            select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
        });
    }
}

async function cargarCanchasParaRecurrentes() {
    const { data, error } = await supabaseClient.from('canchas').select('id, nombre').order('orden');
    if (!error && data) {
        const select = document.getElementById('recur-canchas');
        select.innerHTML = '';
        data.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = c.nombre;
            select.appendChild(opt);
        });
    }
}

// Función para calcular próxima fecha efectiva de una recurrencia
function calcularProximaFecha(recur, hoy) {
    const skipDates = recur.skip_dates ? JSON.parse(recur.skip_dates) : [];
    for (let i = 0; i <= 60; i++) {
        const testDate = new Date(hoy);
        testDate.setDate(hoy.getDate() + i);
        if (testDate.getDay() === (recur.dia_semana === 6 ? 0 : recur.dia_semana + 1)) { // convertir a getDay()
            const fechaStr = testDate.toISOString().slice(0,10);
            if (!skipDates.includes(fechaStr)) {
                return testDate;
            }
        }
    }
    return null;
}

async function cargarRecurrentes() {
    const { data, error } = await supabaseClient.from('reservas_recurrentes').select('*').order('id');
    if (error) {
        console.error('Error cargando recurrentes:', error);
        const tbody = document.querySelector('#tabla-recurrentes tbody');
        tbody.innerHTML = '<tr><td colspan="11">Error al cargar las recurrencias.</td></tr>';
        return;
    }
    recurrentes = data;
    const tbody = document.querySelector('#tabla-recurrentes tbody');
    tbody.innerHTML = '';
    if (recurrentes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11">No hay reservas recurrentes registradas.</td></tr>';
        if (window.updateRecurrentesBadge) window.updateRecurrentesBadge(false);
        return;
    }
    
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    let tieneActivas = false;
    
    for (let r of recurrentes) {
        if (r.activo) tieneActivas = true;
        const row = tbody.insertRow();
        
        // ID
        row.insertCell(0).innerText = r.id;
        // Cliente
        let clienteNombre = '';
        if (r.cliente_id) {
            const { data: cli } = await supabaseClient.from('clientes').select('nombre').eq('id', r.cliente_id).single();
            clienteNombre = cli?.nombre || '';
        }
        row.insertCell(1).innerText = clienteNombre || '(Sin cliente)';
        // Día
        const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
        row.insertCell(2).innerText = dias[r.dia_semana];
        // Horario
        row.insertCell(3).innerText = `${r.hora_inicio.slice(0,5)} - ${r.hora_fin.slice(0,5)}`;
        // Canchas
        let canchaNombres = [];
        const ids = JSON.parse(r.cancha_ids);
        for (let cid of ids) {
            const { data: can } = await supabaseClient.from('canchas').select('nombre').eq('id', cid).single();
            if (can) canchaNombres.push(can.nombre);
        }
        row.insertCell(4).innerText = canchaNombres.join(', ');
        // Adelanto semanal
        row.insertCell(5).innerText = `S/ ${r.adelanto_semanal}`;
        // Vigencia
        row.insertCell(6).innerText = `${r.fecha_inicio} - ${r.fecha_fin || 'indefinido'}`;
        // Activo
        row.insertCell(7).innerText = r.activo ? '✅ Activo' : '❌ Inactivo';
        
        // Próxima fecha
        const proxFecha = calcularProximaFecha(r, hoy);
        row.insertCell(8).innerText = proxFecha ? proxFecha.toLocaleDateString('es-CL') : 'No disponible';
        
        // Adelanto perdido acumulado
        let lost = [];
        if (r.lost_advance_dates) lost = JSON.parse(r.lost_advance_dates);
        const perdidoTotal = lost.length * r.adelanto_semanal;
        row.insertCell(9).innerText = `S/ ${perdidoTotal.toFixed(2)}`;
        
        // Botones de acción
        const cellAcciones = row.insertCell(10);
        const btnEditar = document.createElement('button');
        btnEditar.innerText = '✏️';
        btnEditar.className = 'btn-accion';
        btnEditar.style.margin = '2px';
        btnEditar.style.padding = '4px 8px';
        btnEditar.style.cursor = 'pointer';
        btnEditar.title = 'Editar recurrencia';
        btnEditar.onclick = () => editarRecurrencia(r);
        
        const btnEliminar = document.createElement('button');
        btnEliminar.innerText = '🗑️';
        btnEliminar.className = 'btn-accion';
        btnEliminar.style.margin = '2px';
        btnEliminar.style.padding = '4px 8px';
        btnEliminar.style.cursor = 'pointer';
        btnEliminar.title = 'Eliminar recurrencia';
        btnEliminar.onclick = () => eliminarRecurrencia(r.id);
        
        const btnCancelar = document.createElement('button');
        btnCancelar.innerText = '⛔';
        btnCancelar.className = 'btn-accion';
        btnCancelar.style.margin = '2px';
        btnCancelar.style.padding = '4px 8px';
        btnCancelar.style.cursor = 'pointer';
        btnCancelar.title = 'Cancelar semana específica';
        btnCancelar.onclick = () => abrirModalCancelacionSemana(r);
        
        const btnAsistencia = document.createElement('button');
        btnAsistencia.innerText = '📋';
        btnAsistencia.className = 'btn-accion';
        btnAsistencia.style.margin = '2px';
        btnAsistencia.style.padding = '4px 8px';
        btnAsistencia.style.cursor = 'pointer';
        btnAsistencia.title = 'Ver/registrar asistencia';
        btnAsistencia.onclick = () => verAsistenciaRecurrencia(r.id);
        
        cellAcciones.appendChild(btnEditar);
        cellAcciones.appendChild(btnEliminar);
        cellAcciones.appendChild(btnCancelar);
        cellAcciones.appendChild(btnAsistencia);
    }
    
    if (window.updateRecurrentesBadge) window.updateRecurrentesBadge(tieneActivas);
}

// Mostrar modal de cancelación
function abrirModalCancelacionSemana(recur) {
    currentCancelRecur = recur;
    const modal = document.getElementById('modal-cancelar-semana');
    const fechaInput = document.getElementById('cancel-fecha');
    fechaInput.value = new Date().toISOString().slice(0,10);
    // Configurar el texto del checkbox dinámicamente
    const avisoCheck = document.getElementById('cancel-aviso');
    const noticeHours = recur.notice_hours || 24;
    avisoCheck.nextSibling.textContent = ` Avisó con anticipación (≥ ${noticeHours} horas)`;
    modal.style.display = 'flex';
}

function cerrarModalCancelacion() {
    document.getElementById('modal-cancelar-semana').style.display = 'none';
    currentCancelRecur = null;
}

async function confirmarCancelacionSemana() {
    if (!currentCancelRecur) return;
    const recur = currentCancelRecur;
    const fechaStr = document.getElementById('cancel-fecha').value;
    const avisoConTiempo = document.getElementById('cancel-aviso').checked;
    
    const fecha = new Date(fechaStr);
    if (isNaN(fecha.getTime())) {
        alert('Fecha inválida');
        return;
    }
    
    // Validar día de semana
    let diaSemanaJS = fecha.getDay();
    let mapping = { 0:6, 1:0, 2:1, 3:2, 4:3, 5:4, 6:5 };
    if (mapping[diaSemanaJS] !== recur.dia_semana) {
        alert(`La fecha debe ser ${['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][recur.dia_semana]}`);
        return;
    }
    
    // Validar horas de anticipación si avisó con tiempo
    const ahora = new Date();
    const fechaEvento = new Date(fechaStr + 'T' + recur.hora_inicio);
    const horasRestantes = (fechaEvento - ahora) / (1000 * 3600);
    const noticeHours = recur.notice_hours || 24;
    
    let skipDates = recur.skip_dates ? JSON.parse(recur.skip_dates) : [];
    let lostDates = recur.lost_advance_dates ? JSON.parse(recur.lost_advance_dates) : [];
    
    if (avisoConTiempo && horasRestantes < noticeHours) {
        if (!confirm(`Faltan menos de ${noticeHours} horas para la reserva. Si continúa, el adelanto se perderá. ¿Desea cancelar igualmente?`)) {
            return;
        }
        // Forzar como sin aviso
        if (!lostDates.includes(fechaStr)) lostDates.push(fechaStr);
        if (skipDates.includes(fechaStr)) skipDates = skipDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        alert('Semana cancelada SIN aviso. Adelanto perdido.');
    } else if (avisoConTiempo) {
        if (!skipDates.includes(fechaStr)) skipDates.push(fechaStr);
        if (lostDates.includes(fechaStr)) lostDates = lostDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        alert('Semana cancelada con aviso. Adelanto conservado.');
    } else {
        if (!lostDates.includes(fechaStr)) lostDates.push(fechaStr);
        if (skipDates.includes(fechaStr)) skipDates = skipDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        alert('Semana cancelada SIN aviso. Adelanto perdido.');
    }
    
    // Eliminar reserva existente para esa fecha
    await supabaseClient.from('reservas').delete().eq('recurrente_id', recur.id).eq('fecha', fechaStr);
    await cargarRecurrentes();
    cerrarModalCancelacion();
}

// Función para ver asistencia (pendiente de implementar completamente en web)
async function verAsistenciaRecurrencia(recurId) {
    alert('Funcionalidad de asistencia en desarrollo. Por ahora use la aplicación de escritorio.');
    // Aquí se podría abrir un modal con las reservas y permitir cambiar estado_asistencia
}

function mostrarModalRecurrencia(recur = null) {
    editingRecurrenteId = recur ? recur.id : null;
    document.getElementById('modal-title').innerText = recur ? 'Editar Recurrencia' : 'Nueva Recurrencia';
    document.getElementById('recur-cliente').value = recur?.cliente_id || '';
    document.getElementById('recur-dia').value = recur?.dia_semana || '0';
    document.getElementById('recur-hora-inicio').value = recur?.hora_inicio?.slice(0,5) || '16:00';
    document.getElementById('recur-hora-fin').value = recur?.hora_fin?.slice(0,5) || '19:00';
    document.getElementById('recur-responsable').value = recur?.responsable || '';
    document.getElementById('recur-adelanto').value = recur?.adelanto_semanal || 0;
    document.getElementById('recur-fecha-inicio').value = recur?.fecha_inicio || new Date().toISOString().slice(0,10);
    document.getElementById('recur-fecha-fin').value = recur?.fecha_fin || '';
    document.getElementById('recur-activo').checked = recur?.activo !== false;
    // Nuevos campos
    document.getElementById('recur-advance-policy').value = recur?.advance_policy || 'perdida_sin_aviso';
    document.getElementById('recur-notice-hours').value = recur?.notice_hours || 24;
    
    // Seleccionar canchas
    const idsSeleccionados = recur ? JSON.parse(recur.cancha_ids) : [];
    const selectCanchas = document.getElementById('recur-canchas');
    for (let i = 0; i < selectCanchas.options.length; i++) {
        selectCanchas.options[i].selected = idsSeleccionados.includes(parseInt(selectCanchas.options[i].value));
    }
    document.getElementById('modal-recurrencia').style.display = 'flex';
}

function cerrarModalRecurrencia() {
    document.getElementById('modal-recurrencia').style.display = 'none';
    editingRecurrenteId = null;
}

async function guardarRecurrencia() {
    const cliente_id = document.getElementById('recur-cliente').value || null;
    const dia_semana = parseInt(document.getElementById('recur-dia').value);
    const hora_inicio = document.getElementById('recur-hora-inicio').value;
    const hora_fin = document.getElementById('recur-hora-fin').value;
    const responsable = document.getElementById('recur-responsable').value.trim();
    if (!responsable) { alert('Responsable requerido'); return; }
    const adelanto_semanal = parseFloat(document.getElementById('recur-adelanto').value);
    const fecha_inicio = document.getElementById('recur-fecha-inicio').value;
    const fecha_fin = document.getElementById('recur-fecha-fin').value || null;
    const activo = document.getElementById('recur-activo').checked;
    const advance_policy = document.getElementById('recur-advance-policy').value;
    const notice_hours = parseInt(document.getElementById('recur-notice-hours').value);
    const cancha_ids = Array.from(document.getElementById('recur-canchas').selectedOptions).map(opt => parseInt(opt.value));
    if (cancha_ids.length === 0) { alert('Seleccione al menos una cancha'); return; }

    const data = {
        cliente_id: cliente_id ? parseInt(cliente_id) : null,
        dia_semana,
        hora_inicio,
        hora_fin,
        responsable,
        adelanto_semanal,
        fecha_inicio,
        fecha_fin,
        activo,
        advance_policy,
        notice_hours,
        cancha_ids: JSON.stringify(cancha_ids),
        grupo_id: editingRecurrenteId ? undefined : crypto.randomUUID()
    };
    
    let error;
    if (editingRecurrenteId) {
        const { error: err } = await supabaseClient.from('reservas_recurrentes').update(data).eq('id', editingRecurrenteId);
        error = err;
    } else {
        const { error: err } = await supabaseClient.from('reservas_recurrentes').insert(data);
        error = err;
    }
    if (error) alert('Error: ' + error.message);
    else {
        cerrarModalRecurrencia();
        await cargarRecurrentes();
        alert('Recurrencia guardada');
    }
}

function editarRecurrencia(recur) {
    mostrarModalRecurrencia(recur);
}

async function eliminarRecurrencia(id) {
    if (!confirm('¿Eliminar esta recurrencia? También se eliminarán las reservas futuras generadas.')) return;
    const { error } = await supabaseClient.from('reservas_recurrentes').delete().eq('id', id);
    if (error) alert('Error: ' + error.message);
    else {
        await supabaseClient.from('reservas').delete().eq('recurrente_id', id).gte('fecha', new Date().toISOString().slice(0,10));
        await cargarRecurrentes();
        alert('Recurrencia eliminada');
    }
}

async function generarReservasAhora() {
    alert('Esta función requiere una Edge Function en Supabase. Por ahora, usa el botón en la app de escritorio.');
}

async function marcarAusenciasAutomaticas() {
    alert('Esta función requiere una Edge Function en Supabase. Por ahora, usa el botón en la app de escritorio.');
}

// ==================== Fin de funciones de recurrentes ====================

function generarSlots() {
    const minutosSlot = parseInt(document.getElementById('granularidad').value);
    slots = [];
    let hora = 6, min = 0;
    while (hora < 23 || (hora === 23 && min === 0)) {
        slots.push({ hora, min });
        min += minutosSlot;
        if (min >= 60) { hora += Math.floor(min / 60); min = min % 60; }
        if (hora >= 24) break;
    }
}

function formatearHoraAMPM(hora, minuto) {
    let periodo = hora >= 12 ? 'PM' : 'AM';
    let hora12 = hora % 12;
    if (hora12 === 0) hora12 = 12;
    return `${hora12}:${minuto.toString().padStart(2,'0')} ${periodo}`;
}

async function renderizarTabla(vista) {
    generarSlots();
    const container = document.getElementById('horario-container');
    if (!canchas.length || !slots.length) { container.innerHTML = '<p>Cargando...</p>'; return; }
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const thEsquina = document.createElement('th');
    thEsquina.textContent = 'Hora / Cancha';
    headerRow.appendChild(thEsquina);
    for (let cancha of canchas) {
        const th = document.createElement('th');
        th.textContent = cancha.nombre;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (let slot of slots) {
        const row = document.createElement('tr');
        const startTime = new Date(`${fechaActual}T${slot.hora.toString().padStart(2,'0')}:${slot.min.toString().padStart(2,'0')}:00`);
        const minutosSlot = parseInt(document.getElementById('granularidad').value);
        const endTime = new Date(startTime.getTime() + minutosSlot * 60000);
        const endH = endTime.getHours();
        const endM = endTime.getMinutes();
        const tdHora = document.createElement('td');
        tdHora.textContent = `${formatearHoraAMPM(slot.hora, slot.min)} - ${formatearHoraAMPM(endH, endM)}`;
        tdHora.style.fontWeight = 'bold';
        row.appendChild(tdHora);
        for (let cancha of canchas) {
            const slotStart = startTime;
            const slotEnd = endTime;
            const reservaEnSlot = reservas.find(r => {
                const rStart = new Date(`${r.fecha}T${r.hora_inicio}`);
                const rEnd = new Date(`${r.fecha}T${r.hora_fin}`);
                return r.cancha_id === cancha.id && slotStart < rEnd && slotEnd > rStart;
            });
            const celda = document.createElement('td');
            if (reservaEnSlot) {
                let clase = 'celda-ocupada';
                let contenido = `${reservaEnSlot.responsable}<br><small>${reservaEnSlot.hora_inicio.slice(0,5)}-${reservaEnSlot.hora_fin.slice(0,5)}</small>`;
                if (vista === 'admin') {
                    const pagado = (reservaEnSlot.monto_efectivo || 0) + (reservaEnSlot.monto_yape || 0) + (reservaEnSlot.adelanto || 0);
                    const costo = await calcularCostoEsperado(reservaEnSlot.cancha_id, reservaEnSlot.cliente_id, reservaEnSlot.fecha,
                        stringToDate(reservaEnSlot.hora_inicio), stringToDate(reservaEnSlot.hora_fin));
                    const deuda = costo - pagado;
                    if (deuda <= 0.01) clase = 'celda-pagado';
                    else if (reservaEnSlot.adelanto > 0) clase = 'celda-deuda-adelanto';
                    else clase = 'celda-deuda-sin-adelanto';
                    contenido += `<br><small>💰 Pagado: S/${pagado.toFixed(2)}</small>`;
                    if (deuda > 0) contenido += `<br><small>⚠️ Deuda: S/${deuda.toFixed(2)}</small>`;
                }
                celda.className = clase;
                celda.innerHTML = contenido;
                celda.dataset.reservaId = reservaEnSlot.id;
            } else {
                celda.className = 'celda-libre';
                celda.innerHTML = '📌 Libre';
                celda.dataset.canchaId = cancha.id;
                celda.dataset.slotStart = slotStart.toISOString();
                celda.dataset.slotEnd = slotEnd.toISOString();
            }
            row.appendChild(celda);
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}

function attachDoubleClick(vista) {
    const container = document.getElementById('horario-container');
    container.addEventListener('dblclick', async (e) => {
        let celda = e.target.closest('td');
        if (!celda || celda.cellIndex === 0) return;
        if (celda.classList.contains('celda-libre')) {
            if (vista === 'admin') {
                currentCanchaId = parseInt(celda.dataset.canchaId);
                const startISO = celda.dataset.slotStart;
                const startDate = new Date(startISO);
                currentFecha = startDate.toISOString().slice(0,10);
                document.getElementById('fecha-reserva').value = currentFecha;

                const minutosSlot = parseInt(document.getElementById('granularidad').value);
                const endDateDefault = new Date(startDate.getTime() + minutosSlot * 60000);
                horaInicioActual = new Date(startDate);
                horaFinActual = new Date(endDateDefault);
                updateHoraInicioDisplay();
                updateHoraFinDisplay();

                const cancha = canchas.find(c => c.id === currentCanchaId);
                const tipoSelect = document.getElementById('tipo-reserva');
                tipoSelect.innerHTML = '';
                if (cancha.tipo === 'futbol') {
                    tipoSelect.innerHTML = `
                        <option value="individual">Individual (solo esta cancha)</option>
                        <option value="media12">Media cancha (Fútbol 1+2)</option>
                        <option value="media34">Media cancha (Fútbol 3+4)</option>
                        <option value="completa">Cancha completa (Fútbol 1+2+3+4)</option>
                    `;
                } else {
                    tipoSelect.innerHTML = `<option value="individual">Individual (solo esta cancha)</option>`;
                }

                const clienteSelect = document.getElementById('cliente-id');
                if (clienteSelect) {
                    clienteSelect.innerHTML = '<option value="">Sin cliente</option>';
                    clientes.forEach(c => {
                        clienteSelect.innerHTML += `<option value="${c.id}">${c.nombre}${c.precio_especial_hora > 0 ? ` (Precio esp. S/${c.precio_especial_hora}/h)` : ''}</option>`;
                    });
                }

                // Configurar botones de hora
                document.getElementById('inicio-mas30').onclick = () => setHoraInicio(ajustarHora(horaInicioActual, 30));
                document.getElementById('inicio-menos30').onclick = () => setHoraInicio(ajustarHora(horaInicioActual, -30));
                document.getElementById('inicio-am').onclick = () => {
                    let newH = horaInicioActual.getHours() % 12;
                    if (newH === 0) newH = 0;
                    let newDate = new Date(horaInicioActual);
                    newDate.setHours(newH, horaInicioActual.getMinutes());
                    setHoraInicio(newDate);
                };
                document.getElementById('inicio-pm').onclick = () => {
                    let newH = (horaInicioActual.getHours() % 12) + 12;
                    let newDate = new Date(horaInicioActual);
                    newDate.setHours(newH, horaInicioActual.getMinutes());
                    setHoraInicio(newDate);
                };
                document.getElementById('fin-mas30').onclick = () => setHoraFin(ajustarHora(horaFinActual, 30));
                document.getElementById('fin-menos30').onclick = () => setHoraFin(ajustarHora(horaFinActual, -30));
                document.getElementById('fin-am').onclick = () => {
                    let newH = horaFinActual.getHours() % 12;
                    if (newH === 0) newH = 0;
                    let newDate = new Date(horaFinActual);
                    newDate.setHours(newH, horaFinActual.getMinutes());
                    setHoraFin(newDate);
                };
                document.getElementById('fin-pm').onclick = () => {
                    let newH = (horaFinActual.getHours() % 12) + 12;
                    let newDate = new Date(horaFinActual);
                    newDate.setHours(newH, horaFinActual.getMinutes());
                    setHoraFin(newDate);
                };

                document.getElementById('adelanto').value = '0';
                document.getElementById('responsable').value = '';
                document.getElementById('telefono').value = '';
                document.getElementById('observaciones').value = '';
                await actualizarCostoEstimadoModal();
                mostrarModalReserva();
            } else {
                alert('Para reservar, contacta con el administrador.');
            }
        } else {
            const reservaId = celda.dataset.reservaId;
            if (reservaId) {
                const reserva = reservas.find(r => r.id == reservaId);
                if (reserva) {
                    let msg = `Reservado por: ${reserva.responsable}\nHorario: ${reserva.hora_inicio.slice(0,5)} - ${reserva.hora_fin.slice(0,5)}`;
                    if (vista === 'admin') {
                        msg += `\nAdelanto: S/${reserva.adelanto}\nPagado: S/${(reserva.monto_efectivo+reserva.monto_yape+reserva.adelanto).toFixed(2)}`;
                    }
                    alert(msg);
                }
            }
        }
    });
}

async function actualizarCostoEstimadoModal() {
    const tipo = document.getElementById('tipo-reserva').value;
    const clienteId = document.getElementById('cliente-id')?.value || null;
    const fecha = document.getElementById('fecha-reserva').value;
    if (!horaInicioActual || !horaFinActual) return;
    if (horaFinActual <= horaInicioActual) {
        document.getElementById('costo-estimado').innerText = 'S/ 0.00 (hora fin inválida)';
        return;
    }
    let costo = 0;
    if (tipo === 'individual') {
        costo = await calcularCostoEsperado(currentCanchaId, clienteId, fecha, horaInicioActual, horaFinActual);
    } else if (tipo === 'media12' || tipo === 'media34') {
        costo = await calcularCostoEspecial('media_cancha', fecha, horaInicioActual, horaFinActual);
        if (clienteId) {
            const cliente = clientes.find(c => c.id == clienteId);
            if (cliente && cliente.precio_especial_hora > 0) {
                const duracion = (horaFinActual - horaInicioActual) / 3600000;
                costo = cliente.precio_especial_hora * duracion;
            }
        }
    } else if (tipo === 'completa') {
        costo = await calcularCostoEspecial('completa', fecha, horaInicioActual, horaFinActual);
        if (clienteId) {
            const cliente = clientes.find(c => c.id == clienteId);
            if (cliente && cliente.precio_especial_hora > 0) {
                const duracion = (horaFinActual - horaInicioActual) / 3600000;
                costo = cliente.precio_especial_hora * duracion;
            }
        }
    }
    document.getElementById('costo-estimado').innerText = `S/ ${costo.toFixed(2)}`;
}

function mostrarModalReserva() {
    document.getElementById('modal-reserva').style.display = 'flex';
}

function configurarModalDinamico() {
    const guardarBtn = document.getElementById('guardar-reserva');
    const cancelarBtn = document.getElementById('cancelar-reserva');
    guardarBtn.onclick = guardarReservaGrupo;
    cancelarBtn.onclick = () => { document.getElementById('modal-reserva').style.display = 'none'; };
    const tipoSelect = document.getElementById('tipo-reserva');
    const clienteSelect = document.getElementById('cliente-id');
    if (tipoSelect) tipoSelect.addEventListener('change', () => actualizarCostoEstimadoModal());
    if (clienteSelect) clienteSelect.addEventListener('change', () => actualizarCostoEstimadoModal());
}

async function guardarReservaGrupo() {
    const responsable = document.getElementById('responsable').value.trim();
    if (!responsable) { alert('Ingrese el nombre del responsable'); return; }
    const tipo = document.getElementById('tipo-reserva').value;
    const adelantoTotal = parseFloat(document.getElementById('adelanto').value) || 0;
    const metodo = document.getElementById('metodo_pago').value;
    const observaciones = document.getElementById('observaciones').value;
    const clienteId = document.getElementById('cliente-id')?.value || null;
    const fechaStr = document.getElementById('fecha-reserva').value;
    const horaInicioStr = dateToTimeString(horaInicioActual);
    const horaFinStr = dateToTimeString(horaFinActual);

    if (!fechaStr) { alert('Complete fecha'); return; }
    if (horaFinActual <= horaInicioActual) { alert('La hora de fin debe ser mayor a la de inicio'); return; }

    let canchaIds = [];
    if (tipo === 'individual') canchaIds = [currentCanchaId];
    else if (tipo === 'media12') canchaIds = obtenerCanchasPorNombres(['Fútbol 1', 'Fútbol 2']);
    else if (tipo === 'media34') canchaIds = obtenerCanchasPorNombres(['Fútbol 3', 'Fútbol 4']);
    else if (tipo === 'completa') canchaIds = obtenerCanchasPorNombres(['Fútbol 1', 'Fútbol 2', 'Fútbol 3', 'Fútbol 4']);

    if (canchaIds.length === 0) { alert('No se encontraron las canchas necesarias. Verifica los nombres en Supabase.'); return; }

    try {
        const hayConflicto = await verificarConflictos(canchaIds, fechaStr, horaInicioActual, horaFinActual);
        if (hayConflicto) { alert('Una o más canchas ya están ocupadas en ese horario.'); return; }
    } catch (err) { alert('Error al verificar disponibilidad: ' + err.message); return; }

    let costoTotal = 0;
    if (tipo === 'individual') costoTotal = await calcularCostoEsperado(currentCanchaId, clienteId, fechaStr, horaInicioActual, horaFinActual);
    else if (tipo === 'media12' || tipo === 'media34') {
        costoTotal = await calcularCostoEspecial('media_cancha', fechaStr, horaInicioActual, horaFinActual);
        if (clienteId) {
            const cliente = clientes.find(c => c.id == clienteId);
            if (cliente && cliente.precio_especial_hora > 0) {
                const duracion = (horaFinActual - horaInicioActual) / 3600000;
                costoTotal = cliente.precio_especial_hora * duracion;
            }
        }
    } else if (tipo === 'completa') {
        costoTotal = await calcularCostoEspecial('completa', fechaStr, horaInicioActual, horaFinActual);
        if (clienteId) {
            const cliente = clientes.find(c => c.id == clienteId);
            if (cliente && cliente.precio_especial_hora > 0) {
                const duracion = (horaFinActual - horaInicioActual) / 3600000;
                costoTotal = cliente.precio_especial_hora * duracion;
            }
        }
    }

    if (adelantoTotal > costoTotal) { alert(`El adelanto (S/${adelantoTotal}) no puede superar el costo total (S/${costoTotal})`); return; }

    // Distribuir adelanto
    const costosIndividuales = [];
    for (let cid of canchaIds) {
        let costoInd = 0;
        if (tipo === 'individual') costoInd = costoTotal;
        else {
            const cancha = canchas.find(c => c.id === cid);
            if (cancha) costoInd = await calcularCostoPorTramos(cancha.tipo, fechaStr, horaInicioActual, horaFinActual);
        }
        costosIndividuales.push(costoInd);
    }
    const sumaCostos = costosIndividuales.reduce((a,b) => a+b, 0);
    let montosAdelanto = [];
    if (sumaCostos > 0) {
        let totalAsignado = 0;
        for (let i = 0; i < canchaIds.length - 1; i++) {
            let monto = (adelantoTotal * costosIndividuales[i]) / sumaCostos;
            monto = Math.round(monto * 100) / 100;
            montosAdelanto.push(monto);
            totalAsignado += monto;
        }
        montosAdelanto.push(adelantoTotal - totalAsignado);
    } else {
        const igual = adelantoTotal / canchaIds.length;
        for (let i = 0; i < canchaIds.length; i++) montosAdelanto.push(igual);
    }

    const grupo_id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36);
    const reservasInsert = [];
    for (let i = 0; i < canchaIds.length; i++) {
        let montoEfectivo = 0, montoYape = 0;
        if (metodo === 'efectivo') montoEfectivo = montosAdelanto[i];
        else montoYape = montosAdelanto[i];
        reservasInsert.push({
            fecha: fechaStr, hora_inicio: horaInicioStr, hora_fin: horaFinStr,
            responsable: responsable, cancha_id: canchaIds[i], observaciones: observaciones,
            adelanto: montosAdelanto[i], monto_efectivo: montoEfectivo, monto_yape: montoYape,
            monto_pagado: montosAdelanto[i], metodo_pago: metodo, tipo_uso: 'futbol',
            grupo_id: grupo_id, cliente_id: clienteId ? parseInt(clienteId) : null
        });
    }

    const { error } = await supabaseClient.from('reservas').insert(reservasInsert);
    if (error) alert('Error al guardar: ' + error.message);
    else {
        alert(`Reserva ${tipo === 'individual' ? 'individual' : 'grupal'} registrada correctamente.`);
        document.getElementById('modal-reserva').style.display = 'none';
        await cargarReservas();
        renderizarTabla('admin');
    }
}

// ==================== KEEP-ALIVE ====================
function startKeepAlive() {
    const KEEP_ALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000;
    async function ping() {
        if (!supabaseClient) return;
        try {
            const { error } = await supabaseClient
                .from('canchas')
                .select('id', { count: 'exact', head: true });
            if (error) {
                console.warn('⚠️ Keep-alive falló:', error.message);
            } else {
                console.log('✅ Keep-alive exitoso -', new Date().toLocaleString());
            }
        } catch (err) {
            console.error('❌ Error en keep-alive:', err);
        }
    }
    ping();
    setInterval(ping, KEEP_ALIVE_INTERVAL_MS);
}
