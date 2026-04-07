// script.js
let supabaseClient;
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];
let preciosConfig = [];

export async function initPublicView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
    await cargarPrecios();
    await cargarReservas(false);
    renderizarTabla('public');
    attachDoubleClick('public');
}

export async function initAdminView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
    await cargarPrecios();
    await cargarReservas(true);
    renderizarTabla('admin');
    attachDoubleClick('admin');
}

function setupCommonControls() {
    const fechaInput = document.getElementById('fecha');
    fechaInput.value = fechaActual;
    fechaInput.addEventListener('change', () => {
        fechaActual = fechaInput.value;
        cargarReservas(tipoVistaActual() === 'admin').then(() => renderizarTabla(tipoVistaActual()));
    });
    document.getElementById('btn-anterior').onclick = () => cambiarFecha(-1);
    document.getElementById('btn-siguiente').onclick = () => cambiarFecha(1);
    document.getElementById('btn-hoy').onclick = () => {
        fechaActual = new Date().toISOString().slice(0,10);
        fechaInput.value = fechaActual;
        cargarReservas(tipoVistaActual() === 'admin').then(() => renderizarTabla(tipoVistaActual()));
    };
    document.getElementById('granularidad').addEventListener('change', () => {
        generarSlots();
        renderizarTabla(tipoVistaActual());
    });
}

function tipoVistaActual() {
    return window.location.pathname.includes('admin') ? 'admin' : 'public';
}

function cambiarFecha(delta) {
    const date = new Date(fechaActual);
    date.setDate(date.getDate() + delta);
    fechaActual = date.toISOString().slice(0,10);
    document.getElementById('fecha').value = fechaActual;
    cargarReservas(tipoVistaActual() === 'admin').then(() => renderizarTabla(tipoVistaActual()));
}

async function cargarCanchas() {
    const { data, error } = await supabaseClient
        .from('canchas')
        .select('id, nombre, tipo')
        .order('orden');
    if (error) console.error(error);
    else canchas = data;
}

async function cargarPrecios() {
    const { data, error } = await supabaseClient
        .from('configuracion_precios')
        .select('*');
    if (error) console.error(error);
    else preciosConfig = data;
}

async function cargarReservas(adminMode) {
    let query = supabaseClient
        .from('reservas')
        .select('*')
        .eq('fecha', fechaActual);
    const { data, error } = await query;
    if (error) console.error(error);
    else reservas = data;
}

function generarSlots() {
    const minutosSlot = parseInt(document.getElementById('granularidad').value);
    slots = [];
    let hora = 6;
    let min = 0;
    while (hora < 23 || (hora === 23 && min === 0)) {
        slots.push({ hora, min });
        min += minutosSlot;
        if (min >= 60) {
            hora += Math.floor(min / 60);
            min = min % 60;
        }
        if (hora >= 24) break;
    }
}

function obtenerTarifaPorHora(tipoCancha, hora) {
    const diaInicio = 6, diaFin = 18;
    const rango = (hora >= diaInicio && hora < diaFin) ? 'dia' : 'noche';
    const precio = preciosConfig.find(p => p.tipo_cancha === tipoCancha && p.rango_nombre === rango);
    return precio ? precio.precio_por_hora : 0;
}

async function calcularCostoEsperado(canchaId, fecha, horaIni, horaFin) {
    const cancha = canchas.find(c => c.id === canchaId);
    if (!cancha) return 0;
    const tipo = cancha.tipo;
    const horaIniDate = new Date(`${fecha}T${horaIni}`);
    const horaFinDate = new Date(`${fecha}T${horaFin}`);
    const duracionHoras = (horaFinDate - horaIniDate) / (1000 * 3600);
    const tarifa = obtenerTarifaPorHora(tipo, horaIniDate.getHours());
    return tarifa * duracionHoras;
}

async function renderizarTabla(vista) {
    generarSlots();
    const container = document.getElementById('horario-container');
    if (!canchas.length || !slots.length) {
        container.innerHTML = '<p>Cargando...</p>';
        return;
    }
    const table = document.createElement('table');
    // Cabecera: nombres de canchas
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
        const start = `${slot.hora.toString().padStart(2,'0')}:${slot.min.toString().padStart(2,'0')}`;
        let endMin = slot.min + parseInt(document.getElementById('granularidad').value);
        let endH = slot.hora;
        if (endMin >= 60) {
            endH += Math.floor(endMin / 60);
            endMin = endMin % 60;
        }
        const end = `${endH.toString().padStart(2,'0')}:${endMin.toString().padStart(2,'0')}`;
        const tdHora = document.createElement('td');
        tdHora.textContent = `${start} - ${end}`;
        tdHora.style.fontWeight = 'bold';
        row.appendChild(tdHora);

        for (let cancha of canchas) {
            const slotStart = new Date(`${fechaActual}T${slot.hora.toString().padStart(2,'0')}:${slot.min.toString().padStart(2,'0')}:00`);
            const minutosSlot = parseInt(document.getElementById('granularidad').value);
            const slotEnd = new Date(slotStart.getTime() + minutosSlot * 60000);
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
                    const costo = await calcularCostoEsperado(reservaEnSlot.cancha_id, reservaEnSlot.fecha, reservaEnSlot.hora_inicio, reservaEnSlot.hora_fin);
                    const deuda = costo - pagado;
                    if (deuda <= 0.01) clase = 'celda-pagado';
                    else if (reservaEnSlot.adelanto > 0) clase = 'celda-deuda-adelanto';
                    else clase = 'celda-deuda-sin-adelanto';
                    contenido += `<br><small>💰 Pagado: S/${pagado.toFixed(2)}</small>`;
                    if (deuda > 0) contenido += `<br><small>⚠️ Deuda: S/${deuda.toFixed(2)}</small>`;
                } else {
                    // Vista pública: no mostrar montos, solo responsable y horario
                    contenido = `${reservaEnSlot.responsable}<br><small>${reservaEnSlot.hora_inicio.slice(0,5)}-${reservaEnSlot.hora_fin.slice(0,5)}</small>`;
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
        if (!celda) return;
        if (celda.cellIndex === 0) return; // columna de hora
        if (celda.classList.contains('celda-libre')) {
            if (vista === 'public') {
                mostrarModalReserva(celda.dataset.canchaId, celda.dataset.slotStart, celda.dataset.slotEnd);
            } else {
                alert('Para crear reservas usa la aplicación de escritorio.');
            }
        } else {
            const reservaId = celda.dataset.reservaId;
            if (reservaId) {
                if (vista === 'admin') {
                    mostrarDetalleReservaAdmin(reservaId);
                } else {
                    const reserva = reservas.find(r => r.id == reservaId);
                    alert(`Reservado por: ${reserva.responsable}\nHorario: ${reserva.hora_inicio.slice(0,5)} - ${reserva.hora_fin.slice(0,5)}`);
                }
            }
        }
    });
}

function mostrarModalReserva(canchaId, slotStartISO, slotEndISO) {
    const modal = document.getElementById('modal-reserva');
    modal.style.display = 'flex';
    const guardarBtn = document.getElementById('guardar-reserva');
    const cancelarBtn = document.getElementById('cancelar-reserva');
    const responsableInput = document.getElementById('responsable');
    const telefonoInput = document.getElementById('telefono');
    const adelantoInput = document.getElementById('adelanto');
    const metodoPagoSelect = document.getElementById('metodo_pago');
    const observacionesInput = document.getElementById('observaciones');

    // Limpiar valores previos
    responsableInput.value = '';
    telefonoInput.value = '';
    adelantoInput.value = '0';
    metodoPagoSelect.value = 'efectivo';
    observacionesInput.value = '';

    const nuevaReservaHandler = async () => {
        const responsable = responsableInput.value.trim();
        if (!responsable) {
            alert('Ingrese el nombre del responsable');
            return;
        }
        const adelanto = parseFloat(adelantoInput.value) || 0;
        const metodo = metodoPagoSelect.value;
        const startDate = new Date(slotStartISO);
        const endDate = new Date(slotEndISO);
        const fechaStr = startDate.toISOString().slice(0,10);
        const horaInicioStr = startDate.toTimeString().slice(0,8);
        const horaFinStr = endDate.toTimeString().slice(0,8);
        
        // Determinar monto_efectivo o monto_yape según el método
        let montoEfectivo = 0, montoYape = 0;
        if (metodo === 'efectivo') montoEfectivo = adelanto;
        else montoYape = adelanto;
        
        const { data, error } = await supabaseClient
            .from('reservas')
            .insert({
                fecha: fechaStr,
                hora_inicio: horaInicioStr,
                hora_fin: horaFinStr,
                responsable: responsable,
                cancha_id: parseInt(canchaId),
                observaciones: observacionesInput.value,
                adelanto: adelanto,
                monto_efectivo: montoEfectivo,
                monto_yape: montoYape,
                monto_pagado: adelanto,
                metodo_pago: metodo,
                tipo_uso: 'futbol'
            });
        if (error) {
            alert('Error al guardar: ' + error.message);
        } else {
            alert('Reserva registrada correctamente. Gracias por tu adelanto.');
            modal.style.display = 'none';
            await cargarReservas(tipoVistaActual() === 'admin');
            renderizarTabla(tipoVistaActual());
        }
    };
    guardarBtn.onclick = nuevaReservaHandler;
    cancelarBtn.onclick = () => {
        modal.style.display = 'none';
    };
}

function mostrarDetalleReservaAdmin(reservaId) {
    alert('Para gestionar pagos y editar, usa la aplicación de escritorio.');
}
