// script.js - Versión definitiva con RPC para reservas recurrentes
// Mejorado: sin emojis problemáticos, colores de respaldo y corrección de zona horaria en móviles

let supabaseClient;
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];        // ahora cada slot: { inicioMin, finMinutos }
let preciosConfig = [];
let clientes = [];
let currentCanchaId = null;
let currentFecha = null;
let horaInicioActual = null;
let horaFinActual = null;

// ==================== RESERVAS RECURRENTES ====================
let recurrentes = [];
let editingRecurrenteId = null;
let currentCancelRecur = null;

// --- Utilidades de fechas (UTC) ---
function formatDateToISO(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function parseISODate(dateStr) {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month-1, day));
}

function getTodayUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

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
    const elem = document.getElementById('hora-inicio');
    if (elem) elem.value = formatAMPM(horaInicioActual);
}
function updateHoraFinDisplay() {
    const elem = document.getElementById('hora-fin');
    if (elem) elem.value = formatAMPM(horaFinActual);
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
    await setupCommonControls();
    await cargarCanchas();
    await cargarPrecios();
    await cargarReservas();
    renderizarTabla('public');
    attachDoubleClick('public');
    console.log('Vista pública inicializada');
}

export async function initAdminView(supabase) {
    supabaseClient = supabase;
    await setupCommonControls();
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
    
    const btnNueva = document.getElementById('btn-nueva-recurrencia');
    if (btnNueva) btnNueva.onclick = () => mostrarModalRecurrencia();
    const btnGenerar = document.getElementById('btn-generar-ahora');
    if (btnGenerar) btnGenerar.onclick = () => generarReservasAhora();
    const btnMarcar = document.getElementById('btn-marcar-ausencias');
    if (btnMarcar) btnMarcar.onclick = () => marcarAusenciasAutomaticas();
    const btnGuardar = document.getElementById('guardar-recurrencia');
    if (btnGuardar) btnGuardar.onclick = () => guardarRecurrencia();
    const btnCancelar = document.getElementById('cancelar-recurrencia');
    if (btnCancelar) btnCancelar.onclick = () => cerrarModalRecurrencia();
    
    const btnConfirmarCancel = document.getElementById('confirmar-cancelacion');
    if (btnConfirmarCancel) btnConfirmarCancel.onclick = () => confirmarCancelacionSemana();
    const btnCancelarCancel = document.getElementById('cancelar-cancelacion');
    if (btnCancelarCancel) btnCancelarCancel.onclick = () => cerrarModalCancelacion();
}

async function setupCommonControls() {
    const hoy = new Date();
    const year = hoy.getFullYear();
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    const day = String(hoy.getDate()).padStart(2, '0');
    fechaActual = `${year}-${month}-${day}`;
    const fechaInput = document.getElementById('fecha');
    if (fechaInput) fechaInput.value = fechaActual;
    if (fechaInput) {
        fechaInput.addEventListener('change', async () => {
            fechaActual = fechaInput.value;
            await cargarReservas();
            renderizarTabla(tipoVistaActual());
        });
    }
    const btnAnterior = document.getElementById('btn-anterior');
    if (btnAnterior) btnAnterior.onclick = () => cambiarFecha(-1);
    const btnSiguiente = document.getElementById('btn-siguiente');
    if (btnSiguiente) btnSiguiente.onclick = () => cambiarFecha(1);
    const btnHoy = document.getElementById('btn-hoy');
    if (btnHoy) {
        btnHoy.onclick = async () => {
            fechaActual = `${year}-${month}-${day}`;
            if (fechaInput) fechaInput.value = fechaActual;
            await cargarReservas();
            renderizarTabla(tipoVistaActual());
        };
    }
    const granularidad = document.getElementById('granularidad');
    if (granularidad) {
        granularidad.addEventListener('change', () => {
            generarSlots();
            renderizarTabla(tipoVistaActual());
        });
    }
    startKeepAlive();
}

function tipoVistaActual() {
    return document.getElementById('modal-reserva') !== null ? 'admin' : 'public';
}

async function cambiarFecha(delta) {
    const [year, month, day] = fechaActual.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + delta);
    const newYear = date.getFullYear();
    const newMonth = String(date.getMonth() + 1).padStart(2, '0');
    const newDay = String(date.getDate()).padStart(2, '0');
    fechaActual = `${newYear}-${newMonth}-${newDay}`;
    const fechaInput = document.getElementById('fecha');
    if (fechaInput) fechaInput.value = fechaActual;
    await cargarReservas();
    renderizarTabla(tipoVistaActual());
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
    const { data, error } = await supabaseClient
        .from('reservas')
        .select('*')
        .eq('fecha', fechaActual)
        .neq('estado_asistencia', 'cancelado_con_aviso');
    if (error) console.error(error);
    else reservas = data;
}

// ==================== RESERVAS RECURRENTES ====================
async function cargarClientesParaRecurrentes() {
    const { data, error } = await supabaseClient.from('clientes').select('id, nombre');
    if (!error && data) {
        const select = document.getElementById('recur-cliente');
        if (select) {
            select.innerHTML = '<option value="">(Sin cliente)</option>';
            data.forEach(c => {
                select.innerHTML += `<option value="${c.id}">${c.nombre}</option>`;
            });
        }
    }
}

async function cargarCanchasParaRecurrentes() {
    const { data, error } = await supabaseClient.from('canchas').select('id, nombre').order('orden');
    if (!error && data) {
        const select = document.getElementById('recur-canchas');
        if (select) {
            select.innerHTML = '';
            data.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.nombre;
                select.appendChild(opt);
            });
        }
    }
}

function calcularProximaFecha(recur, hoyUTC) {
    const skipDates = recur.skip_dates ? JSON.parse(recur.skip_dates) : [];
    for (let i = 0; i <= 365; i++) {
        const testDate = new Date(hoyUTC);
        testDate.setUTCDate(hoyUTC.getUTCDate() + i);
        let diaSemanaJS = testDate.getUTCDay();
        let mapping = {0:6,1:0,2:1,3:2,4:3,5:4,6:5};
        if (mapping[diaSemanaJS] === recur.dia_semana) {
            const fechaStr = formatDateToISO(testDate);
            if (!skipDates.includes(fechaStr)) {
                return testDate;
            }
        }
    }
    return null;
}

async function cargarRecurrentes() {
    const { data, error } = await supabaseClient.from('reservas_recurrentes').select('*').order('id');
    const tbody = document.querySelector('#tabla-recurrentes tbody');
    if (error) {
        console.error('Error cargando recurrentes:', error);
        if (tbody) tbody.innerHTML = '<tr><td colspan="11">Error al cargar las recurrencias.</td></tr>';
        if (window.updateRecurrentesBadge) window.updateRecurrentesBadge(false);
        return;
    }
    recurrentes = data;
    if (!tbody) return;
    tbody.innerHTML = '';
    if (recurrentes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11">No hay reservas recurrentes registradas.</td></tr>';
        if (window.updateRecurrentesBadge) window.updateRecurrentesBadge(false);
        return;
    }
    
    const hoyUTC = getTodayUTC();
    let tieneActivas = false;
    
    for (let r of recurrentes) {
        if (r.activo) tieneActivas = true;
        const row = tbody.insertRow();
        row.insertCell(0).innerText = r.id;
        let clienteNombre = '';
        if (r.cliente_id) {
            const { data: cli } = await supabaseClient.from('clientes').select('nombre').eq('id', r.cliente_id).single();
            clienteNombre = cli?.nombre || '';
        }
        row.insertCell(1).innerText = clienteNombre || '(Sin cliente)';
        const dias = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
        row.insertCell(2).innerText = dias[r.dia_semana];
        row.insertCell(3).innerText = `${r.hora_inicio.slice(0,5)} - ${r.hora_fin.slice(0,5)}`;
        let canchaNombres = [];
        const ids = JSON.parse(r.cancha_ids);
        for (let cid of ids) {
            const { data: can } = await supabaseClient.from('canchas').select('nombre').eq('id', cid).single();
            if (can) canchaNombres.push(can.nombre);
        }
        row.insertCell(4).innerText = canchaNombres.join(', ');
        row.insertCell(5).innerText = `S/ ${r.adelanto_semanal}`;
        row.insertCell(6).innerText = `${r.fecha_inicio} - ${r.fecha_fin || 'indefinido'}`;
        row.insertCell(7).innerText = r.activo ? 'Activo' : 'Inactivo';
        const proxFecha = calcularProximaFecha(r, hoyUTC);
        row.insertCell(8).innerText = proxFecha ? proxFecha.toLocaleDateString('es-CL') : 'No disponible';
        let lost = [];
        if (r.lost_advance_dates) lost = JSON.parse(r.lost_advance_dates);
        const perdidoTotal = lost.length * r.adelanto_semanal;
        row.insertCell(9).innerText = `S/ ${perdidoTotal.toFixed(2)}`;
        
        const cellAcciones = row.insertCell(10);
        const btnEditar = document.createElement('button');
        btnEditar.innerText = 'Editar';
        btnEditar.className = 'btn-accion';
        btnEditar.style.margin = '2px';
        btnEditar.style.padding = '4px 8px';
        btnEditar.style.cursor = 'pointer';
        btnEditar.onclick = () => editarRecurrencia(r);
        const btnEliminar = document.createElement('button');
        btnEliminar.innerText = 'Eliminar';
        btnEliminar.className = 'btn-accion';
        btnEliminar.onclick = () => eliminarRecurrencia(r.id);
        const btnCancelar = document.createElement('button');
        btnCancelar.innerText = 'Cancelar Semana';
        btnCancelar.className = 'btn-accion';
        btnCancelar.onclick = () => abrirModalCancelacionSemana(r);
        const btnAsistencia = document.createElement('button');
        btnAsistencia.innerText = 'Asistencia';
        btnAsistencia.className = 'btn-accion';
        btnAsistencia.onclick = () => verAsistenciaRecurrencia(r.id);
        cellAcciones.appendChild(btnEditar);
        cellAcciones.appendChild(btnEliminar);
        cellAcciones.appendChild(btnCancelar);
        cellAcciones.appendChild(btnAsistencia);
    }
    if (window.updateRecurrentesBadge) window.updateRecurrentesBadge(tieneActivas);
}

function abrirModalCancelacionSemana(recur) {
    currentCancelRecur = recur;
    const modal = document.getElementById('modal-cancelar-semana');
    if (!modal) return;
    const fechaInput = document.getElementById('cancel-fecha');
    if (fechaInput) fechaInput.value = formatDateToISO(getTodayUTC());
    const avisoCheck = document.getElementById('cancel-aviso');
    const noticeHours = recur.notice_hours || 24;
    if (avisoCheck && avisoCheck.nextSibling) {
        avisoCheck.nextSibling.textContent = ` Avisó con anticipación (>= ${noticeHours} horas)`;
    }
    modal.style.display = 'flex';
}

function cerrarModalCancelacion() {
    const modal = document.getElementById('modal-cancelar-semana');
    if (modal) modal.style.display = 'none';
    currentCancelRecur = null;
}

async function confirmarCancelacionSemana() {
    if (!currentCancelRecur) return;
    const recur = currentCancelRecur;
    const fechaStr = document.getElementById('cancel-fecha')?.value;
    const avisoConTiempo = document.getElementById('cancel-aviso')?.checked || false;
    if (!fechaStr) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        alert('Fecha inválida (use YYYY-MM-DD)');
        return;
    }
    const fecha = parseISODate(fechaStr);
    if (!fecha) {
        alert('Fecha inválida');
        return;
    }

    const hoyUTC = getTodayUTC();
    if (fecha < hoyUTC) {
        alert("No se puede cancelar una fecha pasada.");
        return;
    }

    let diaSemanaJS = fecha.getUTCDay();
    let mapping = {0:6,1:0,2:1,3:2,4:3,5:4,6:5};
    if (mapping[diaSemanaJS] !== recur.dia_semana) {
        alert(`La fecha debe ser ${['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][recur.dia_semana]}`);
        return;
    }
    const ahoraUTC = new Date();
    const [hora, minuto] = recur.hora_inicio.split(':');
    const fechaEventoUTC = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), parseInt(hora), parseInt(minuto)));
    const horasRestantes = (fechaEventoUTC - ahoraUTC) / (1000 * 3600);
    const noticeHours = recur.notice_hours || 24;
    
    let skipDates = recur.skip_dates ? JSON.parse(recur.skip_dates) : [];
    let lostDates = recur.lost_advance_dates ? JSON.parse(recur.lost_advance_dates) : [];
    
    if (avisoConTiempo && horasRestantes < noticeHours) {
        if (!confirm(`Faltan menos de ${noticeHours} horas para la reserva. Si continúa, el adelanto se perderá. ¿Desea cancelar igualmente?`)) {
            return;
        }
        if (!lostDates.includes(fechaStr)) lostDates.push(fechaStr);
        skipDates = skipDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        await supabaseClient.from('reservas').delete().eq('recurrente_id', recur.id).eq('fecha', fechaStr);
        alert('Semana cancelada SIN aviso suficiente. Adelanto perdido.');
    } 
    else if (avisoConTiempo) {
        if (!skipDates.includes(fechaStr)) skipDates.push(fechaStr);
        lostDates = lostDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        
        const { error: updateError } = await supabaseClient
            .from('reservas')
            .update({ estado_asistencia: 'cancelado_con_aviso' })
            .eq('recurrente_id', recur.id)
            .eq('fecha', fechaStr);
        
        if (updateError) {
            console.warn('No se pudo actualizar estado de la reserva (quizás aún no fue generada):', updateError);
        }
        alert('Semana cancelada con aviso. Adelanto conservado y reserva marcada como cancelada con aviso.');
    } 
    else {
        if (!lostDates.includes(fechaStr)) lostDates.push(fechaStr);
        skipDates = skipDates.filter(d => d !== fechaStr);
        await supabaseClient.from('reservas_recurrentes').update({
            skip_dates: JSON.stringify(skipDates),
            lost_advance_dates: JSON.stringify(lostDates)
        }).eq('id', recur.id);
        await supabaseClient.from('reservas').delete().eq('recurrente_id', recur.id).eq('fecha', fechaStr);
        alert('Semana cancelada SIN aviso. Adelanto perdido.');
    }
    
    await cargarRecurrentes();
    cerrarModalCancelacion();
}

async function verAsistenciaRecurrencia(recurId) {
    alert('Funcionalidad de asistencia en desarrollo. Por ahora use la aplicación de escritorio.');
}

function mostrarModalRecurrencia(recur = null) {
    editingRecurrenteId = recur ? recur.id : null;
    const modal = document.getElementById('modal-recurrencia');
    if (!modal) return;
    document.getElementById('modal-title').innerText = recur ? 'Editar Recurrencia' : 'Nueva Recurrencia';
    const clienteSelect = document.getElementById('recur-cliente');
    if (clienteSelect) clienteSelect.value = recur?.cliente_id || '';
    const diaSelect = document.getElementById('recur-dia');
    if (diaSelect) diaSelect.value = recur?.dia_semana || '0';
    const horaInicio = document.getElementById('recur-hora-inicio');
    if (horaInicio) horaInicio.value = recur?.hora_inicio?.slice(0,5) || '16:00';
    const horaFin = document.getElementById('recur-hora-fin');
    if (horaFin) horaFin.value = recur?.hora_fin?.slice(0,5) || '19:00';
    const responsable = document.getElementById('recur-responsable');
    if (responsable) responsable.value = recur?.responsable || '';
    const adelanto = document.getElementById('recur-adelanto');
    if (adelanto) adelanto.value = recur?.adelanto_semanal || 0;
    const fechaInicio = document.getElementById('recur-fecha-inicio');
    if (fechaInicio) fechaInicio.value = recur?.fecha_inicio || formatDateToISO(getTodayUTC());
    const fechaFin = document.getElementById('recur-fecha-fin');
    if (fechaFin) fechaFin.value = recur?.fecha_fin || '';
    const activo = document.getElementById('recur-activo');
    if (activo) activo.checked = recur?.activo !== false;
    const policySelect = document.getElementById('recur-advance-policy');
    if (policySelect) policySelect.value = recur?.advance_policy || 'perdida_sin_aviso';
    const notice = document.getElementById('recur-notice-hours');
    if (notice) notice.value = recur?.notice_hours || 24;
    
    const idsSeleccionados = recur ? JSON.parse(recur.cancha_ids) : [];
    const selectCanchas = document.getElementById('recur-canchas');
    if (selectCanchas) {
        for (let i = 0; i < selectCanchas.options.length; i++) {
            selectCanchas.options[i].selected = idsSeleccionados.includes(parseInt(selectCanchas.options[i].value));
        }
    }
    modal.style.display = 'flex';
}

function cerrarModalRecurrencia() {
    const modal = document.getElementById('modal-recurrencia');
    if (modal) modal.style.display = 'none';
    editingRecurrenteId = null;
}

async function regenerarReservasRecurrente(recurrenciaId) {
    try {
        const { data, error } = await supabaseClient.rpc('regenerar_reservas_recurrentes', {
            p_recurrencia_id: recurrenciaId
        });
        if (error) throw error;
        console.log(`Regeneradas ${data} reservas para recurrencia ${recurrenciaId}`);
        return true;
    } catch (err) {
        console.error('Error al regenerar reservas:', err);
        alert('No se pudo regenerar automáticamente. Las reservas se generarán en la próxima ejecución del temporizador (cada 6 horas).');
        return false;
    }
}

async function guardarRecurrencia() {
    const cliente_id = document.getElementById('recur-cliente')?.value || null;
    const dia_semana = parseInt(document.getElementById('recur-dia')?.value || '0');
    const hora_inicio = document.getElementById('recur-hora-inicio')?.value;
    const hora_fin = document.getElementById('recur-hora-fin')?.value;
    const responsable = document.getElementById('recur-responsable')?.value.trim();
    if (!responsable) { alert('Responsable requerido'); return; }
    const adelanto_semanal = parseFloat(document.getElementById('recur-adelanto')?.value || 0);
    const fecha_inicio = document.getElementById('recur-fecha-inicio')?.value;
    const fecha_fin = document.getElementById('recur-fecha-fin')?.value || null;
    const activo = document.getElementById('recur-activo')?.checked || false;
    const advance_policy = document.getElementById('recur-advance-policy')?.value || 'perdida_sin_aviso';
    const notice_hours = parseInt(document.getElementById('recur-notice-hours')?.value || 24);
    const cancha_ids = Array.from(document.querySelectorAll('#recur-canchas option:checked')).map(opt => parseInt(opt.value));
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
    
    let recurrenciaId = editingRecurrenteId;
    let error;
    if (editingRecurrenteId) {
        const { error: err } = await supabaseClient.from('reservas_recurrentes').update(data).eq('id', editingRecurrenteId);
        error = err;
    } else {
        const { data: inserted, error: err } = await supabaseClient.from('reservas_recurrentes').insert(data).select('id');
        error = err;
        if (!error && inserted && inserted.length > 0) {
            recurrenciaId = inserted[0].id;
        }
    }
    if (error) {
        alert('Error: ' + error.message);
    } else {
        cerrarModalRecurrencia();
        await cargarRecurrentes();
        if (recurrenciaId) {
            await regenerarReservasRecurrente(recurrenciaId);
        }
        alert('Recurrencia guardada. Las reservas futuras se han regenerado.');
    }
}

function editarRecurrencia(recur) {
    mostrarModalRecurrencia(recur);
}

async function eliminarRecurrencia(id) {
    if (!confirm('¿Eliminar esta recurrencia? También se eliminarán las reservas futuras generadas.')) return;
    const { error } = await supabaseClient.from('reservas_recurrentes').delete().eq('id', id);
    if (error) {
        alert('Error: ' + error.message);
    } else {
        await supabaseClient.from('reservas').delete().eq('recurrente_id', id).gte('fecha', formatDateToISO(getTodayUTC()));
        await cargarRecurrentes();
        alert('Recurrencia eliminada');
    }
}

async function generarReservasAhora() {
    try {
        const { data, error } = await supabaseClient.rpc('generar_todas_reservas_recurrentes');
        if (error) throw error;
        alert(`Se generaron ${data} nuevas reservas recurrentes.`);
        await cargarRecurrentes();
    } catch (err) {
        console.error(err);
        alert('Esta función requiere una función RPC en Supabase (generar_todas_reservas_recurrentes). Por ahora, usa el botón en la app de escritorio.');
    }
}

async function marcarAusenciasAutomaticas() {
    try {
        const { data, error } = await supabaseClient.rpc('marcar_ausencias_automaticas');
        if (error) throw error;
        alert(`Se marcaron ${data} ausencias automáticas.`);
        await cargarRecurrentes();
    } catch (err) {
        console.error(err);
        alert('Esta función requiere una función RPC en Supabase (marcar_ausencias_automaticas). Por ahora, usa el botón en la app de escritorio.');
    }
}

// ==================== Tabla de horarios (CORREGIDO para móviles) ====================
function horaToMinutes(horaStr) {
    const [h, m] = horaStr.split(':').map(Number);
    return h * 60 + m;
}

function generarSlots() {
    const minutosSlot = parseInt(document.getElementById('granularidad')?.value || 30);
    slots = [];
    let hora = 6, min = 0;
    while (hora < 23 || (hora === 23 && min === 0)) {
        const inicioMin = hora * 60 + min;
        let finHora = hora;
        let finMin = min + minutosSlot;
        if (finMin >= 60) {
            finHora += Math.floor(finMin / 60);
            finMin = finMin % 60;
        }
        const finMinutos = finHora * 60 + finMin;
        slots.push({ inicioMin, finMinutos });
        min += minutosSlot;
        if (min >= 60) {
            hora += Math.floor(min / 60);
            min = min % 60;
        }
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
    if (!container) return;
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
        const inicioHora = Math.floor(slot.inicioMin / 60);
        const inicioMin = slot.inicioMin % 60;
        const finHora = Math.floor(slot.finMinutos / 60);
        const finMin = slot.finMinutos % 60;
        const tdHora = document.createElement('td');
        tdHora.textContent = `${formatearHoraAMPM(inicioHora, inicioMin)} - ${formatearHoraAMPM(finHora, finMin)}`;
        tdHora.style.fontWeight = 'bold';
        row.appendChild(tdHora);
        for (let cancha of canchas) {
            const reservaEnSlot = reservas.find(r => {
                if (r.cancha_id !== cancha.id) return false;
                const rInicio = horaToMinutes(r.hora_inicio);
                const rFin = horaToMinutes(r.hora_fin);
                return (slot.inicioMin < rFin && slot.finMinutos > rInicio);
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
                    contenido += `<br><small>Pagado: S/${pagado.toFixed(2)}</small>`;
                    if (deuda > 0) contenido += `<br><small>Deuda: S/${deuda.toFixed(2)}</small>`;
                }
                celda.className = clase;
                celda.innerHTML = contenido;
                celda.dataset.reservaId = reservaEnSlot.id;
            } else {
                celda.className = 'celda-libre';
                celda.innerHTML = 'Libre';
                celda.dataset.canchaId = cancha.id;
                celda.dataset.slotStartMin = slot.inicioMin;
                celda.dataset.slotEndMin = slot.finMinutos;
            }
            // Colores de respaldo
            if (celda.classList.contains('celda-libre')) celda.style.backgroundColor = '#E8F5E9';
            else if (celda.classList.contains('celda-ocupada')) celda.style.backgroundColor = '#FFEBEE';
            else if (celda.classList.contains('celda-pagado')) celda.style.backgroundColor = '#C8E6C9';
            else if (celda.classList.contains('celda-deuda-adelanto')) celda.style.backgroundColor = '#FFF9C4';
            else if (celda.classList.contains('celda-deuda-sin-adelanto')) celda.style.backgroundColor = '#FFCDD2';
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
    if (!container) return;
    container.addEventListener('dblclick', async (e) => {
        let celda = e.target.closest('td');
        if (!celda || celda.cellIndex === 0) return;
        if (celda.classList.contains('celda-libre')) {
            if (vista === 'admin') {
                currentCanchaId = parseInt(celda.dataset.canchaId);
                // Construir fecha a partir de los minutos almacenados
                const startMin = parseInt(celda.dataset.slotStartMin);
                const endMin = parseInt(celda.dataset.slotEndMin);
                const todayDate = new Date(fechaActual + 'T00:00:00');
                const startDate = new Date(todayDate);
                startDate.setHours(0, 0, 0, 0);
                startDate.setMinutes(startMin);
                const endDate = new Date(todayDate);
                endDate.setHours(0, 0, 0, 0);
                endDate.setMinutes(endMin);
                currentFecha = fechaActual;
                const fechaReservaInput = document.getElementById('fecha-reserva');
                if (fechaReservaInput) fechaReservaInput.value = currentFecha;
                horaInicioActual = new Date(startDate);
                horaFinActual = new Date(endDate);
                updateHoraInicioDisplay();
                updateHoraFinDisplay();
                const cancha = canchas.find(c => c.id === currentCanchaId);
                const tipoSelect = document.getElementById('tipo-reserva');
                if (tipoSelect) {
                    tipoSelect.innerHTML = '';
                    if (cancha && cancha.tipo === 'futbol') {
                        tipoSelect.innerHTML = `
                            <option value="individual">Individual (solo esta cancha)</option>
                            <option value="media12">Media cancha (Fútbol 1+2)</option>
                            <option value="media34">Media cancha (Fútbol 3+4)</option>
                            <option value="completa">Cancha completa (Fútbol 1+2+3+4)</option>
                        `;
                    } else {
                        tipoSelect.innerHTML = `<option value="individual">Individual (solo esta cancha)</option>`;
                    }
                }
                const clienteSelect = document.getElementById('cliente-id');
                if (clienteSelect) {
                    clienteSelect.innerHTML = '<option value="">Sin cliente</option>';
                    clientes.forEach(c => {
                        clienteSelect.innerHTML += `<option value="${c.id}">${c.nombre}${c.precio_especial_hora > 0 ? ` (Precio esp. S/${c.precio_especial_hora}/h)` : ''}</option>`;
                    });
                }
                // Configurar botones de hora
                const btnInicioMas30 = document.getElementById('inicio-mas30');
                if (btnInicioMas30) btnInicioMas30.onclick = () => setHoraInicio(ajustarHora(horaInicioActual, 30));
                const btnInicioMenos30 = document.getElementById('inicio-menos30');
                if (btnInicioMenos30) btnInicioMenos30.onclick = () => setHoraInicio(ajustarHora(horaInicioActual, -30));
                const btnInicioAm = document.getElementById('inicio-am');
                if (btnInicioAm) btnInicioAm.onclick = () => {
                    let newH = horaInicioActual.getHours() % 12;
                    if (newH === 0) newH = 0;
                    let newDate = new Date(horaInicioActual);
                    newDate.setHours(newH, horaInicioActual.getMinutes());
                    setHoraInicio(newDate);
                };
                const btnInicioPm = document.getElementById('inicio-pm');
                if (btnInicioPm) btnInicioPm.onclick = () => {
                    let newH = (horaInicioActual.getHours() % 12) + 12;
                    let newDate = new Date(horaInicioActual);
                    newDate.setHours(newH, horaInicioActual.getMinutes());
                    setHoraInicio(newDate);
                };
                const btnFinMas30 = document.getElementById('fin-mas30');
                if (btnFinMas30) btnFinMas30.onclick = () => setHoraFin(ajustarHora(horaFinActual, 30));
                const btnFinMenos30 = document.getElementById('fin-menos30');
                if (btnFinMenos30) btnFinMenos30.onclick = () => setHoraFin(ajustarHora(horaFinActual, -30));
                const btnFinAm = document.getElementById('fin-am');
                if (btnFinAm) btnFinAm.onclick = () => {
                    let newH = horaFinActual.getHours() % 12;
                    if (newH === 0) newH = 0;
                    let newDate = new Date(horaFinActual);
                    newDate.setHours(newH, horaFinActual.getMinutes());
                    setHoraFin(newDate);
                };
                const btnFinPm = document.getElementById('fin-pm');
                if (btnFinPm) btnFinPm.onclick = () => {
                    let newH = (horaFinActual.getHours() % 12) + 12;
                    let newDate = new Date(horaFinActual);
                    newDate.setHours(newH, horaFinActual.getMinutes());
                    setHoraFin(newDate);
                };
                const adelantoInput = document.getElementById('adelanto');
                if (adelantoInput) adelantoInput.value = '0';
                const responsableInput = document.getElementById('responsable');
                if (responsableInput) responsableInput.value = '';
                const telefonoInput = document.getElementById('telefono');
                if (telefonoInput) telefonoInput.value = '';
                const observacionesInput = document.getElementById('observaciones');
                if (observacionesInput) observacionesInput.value = '';
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
    const tipo = document.getElementById('tipo-reserva')?.value;
    const clienteId = document.getElementById('cliente-id')?.value || null;
    const fecha = document.getElementById('fecha-reserva')?.value;
    if (!horaInicioActual || !horaFinActual) return;
    if (horaFinActual <= horaInicioActual) {
        const costoLabel = document.getElementById('costo-estimado');
        if (costoLabel) costoLabel.innerText = 'S/ 0.00 (hora fin inválida)';
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
    const costoLabel = document.getElementById('costo-estimado');
    if (costoLabel) costoLabel.innerText = `S/ ${costo.toFixed(2)}`;
}

function mostrarModalReserva() {
    const modal = document.getElementById('modal-reserva');
    if (modal) modal.style.display = 'flex';
}

function configurarModalDinamico() {
    const guardarBtn = document.getElementById('guardar-reserva');
    if (guardarBtn) guardarBtn.onclick = guardarReservaGrupo;
    const cancelarBtn = document.getElementById('cancelar-reserva');
    if (cancelarBtn) cancelarBtn.onclick = () => { document.getElementById('modal-reserva').style.display = 'none'; };
    const tipoSelect = document.getElementById('tipo-reserva');
    if (tipoSelect) tipoSelect.addEventListener('change', () => actualizarCostoEstimadoModal());
    const clienteSelect = document.getElementById('cliente-id');
    if (clienteSelect) clienteSelect.addEventListener('change', () => actualizarCostoEstimadoModal());
}

async function guardarReservaGrupo() {
    const responsable = document.getElementById('responsable')?.value.trim();
    if (!responsable) { alert('Ingrese el nombre del responsable'); return; }
    const tipo = document.getElementById('tipo-reserva')?.value;
    const adelantoTotal = parseFloat(document.getElementById('adelanto')?.value || 0);
    const metodo = document.getElementById('metodo_pago')?.value;
    const observaciones = document.getElementById('observaciones')?.value || '';
    const clienteId = document.getElementById('cliente-id')?.value || null;
    const fechaStr = document.getElementById('fecha-reserva')?.value;
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
        const modal = document.getElementById('modal-reserva');
        if (modal) modal.style.display = 'none';
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
                console.warn('Keep-alive falló:', error.message);
            } else {
                console.log('Keep-alive exitoso -', new Date().toLocaleString());
            }
        } catch (err) {
            console.error('Error en keep-alive:', err);
        }
    }
    ping();
    setInterval(ping, KEEP_ALIVE_INTERVAL_MS);
}
