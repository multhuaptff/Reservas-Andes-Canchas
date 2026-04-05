// script.js
let supabaseClient;

// Variables comunes
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];

export async function initPublicView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
    await cargarReservas(false);
    renderizarTabla('public');
    attachDoubleClick('public');
}

export async function initAdminView(supabase) {
    supabaseClient = supabase;
    setupCommonControls();
    await cargarCanchas();
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
        .select('id, nombre')
        .order('orden', { ascending: true });
    if (error) console.error('Error cargando canchas:', error);
    else canchas = data;
}

async function cargarReservas(esAdmin = false) {
    const tabla = esAdmin ? 'reservas' : 'reservas_publicas';
    const { data, error } = await supabaseClient
        .from(tabla)
        .select('*')
        .eq('fecha', fechaActual);
    if (error) console.error(`Error cargando reservas desde ${tabla}:`, error);
    else reservas = data;
    console.log(`Reservas cargadas para ${fechaActual}:`, reservas);
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

function renderizarTabla(vista) {
    generarSlots();
    const container = document.getElementById('horario-container');
    if (!canchas.length || !slots.length) {
        container.innerHTML = '<p>Cargando...</p>';
        return;
    }
    const table = document.createElement('table');
    // Cabecera
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    for (let slot of slots) {
        const start = `${slot.hora.toString().padStart(2,'0')}:${slot.min.toString().padStart(2,'0')}`;
        let endMin = slot.min + parseInt(document.getElementById('granularidad').value);
        let endH = slot.hora;
        if (endMin >= 60) {
            endH += Math.floor(endMin / 60);
            endMin = endMin % 60;
        }
        const end = `${endH.toString().padStart(2,'0')}:${endMin.toString().padStart(2,'0')}`;
        const th = document.createElement('th');
        th.textContent = `${start} - ${end}`;
        headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let cancha of canchas) {
        const row = document.createElement('tr');
        const tdCancha = document.createElement('td');
        tdCancha.textContent = cancha.nombre;
        tdCancha.style.fontWeight = 'bold';
        row.appendChild(tdCancha);
        for (let slot of slots) {
            const slotStart = new Date(`${fechaActual}T${slot.hora.toString().padStart(2,'0')}:${slot.min.toString().padStart(2,'0')}:00`);
            const slotEnd = new Date(slotStart.getTime() + parseInt(document.getElementById('granularidad').value) * 60000);
            const reservaEnSlot = reservas.find(r => {
                const rStart = new Date(`${r.fecha}T${r.hora_inicio}`);
                const rEnd = new Date(`${r.fecha}T${r.hora_fin}`);
                return r.cancha_id === cancha.id && slotStart < rEnd && slotEnd > rStart;
            });
            const celda = document.createElement('td');
            if (reservaEnSlot) {
                let clase = 'celda-ocupada';
                if (vista === 'admin') {
                    const pagado = (reservaEnSlot.monto_efectivo || 0) + (reservaEnSlot.monto_yape || 0) + (reservaEnSlot.adelanto || 0);
                    // Simplificamos: si pagado > 0, asumimos pagado (sin calcular costo real)
                    if (pagado > 0) clase = 'celda-pagado';
                    else if (reservaEnSlot.adelanto > 0) clase = 'celda-deuda-adelanto';
                    else clase = 'celda-deuda-sin-adelanto';
                }
                celda.className = clase;
                let contenido = `${reservaEnSlot.responsable}<br><small>${reservaEnSlot.hora_inicio.slice(0,5)}-${reservaEnSlot.hora_fin.slice(0,5)}</small>`;
                if (vista === 'admin' && reservaEnSlot.monto_efectivo !== undefined) {
                    contenido += `<br><small>💰 Pagado: S/${(reservaEnSlot.monto_efectivo+reservaEnSlot.monto_yape+reservaEnSlot.adelanto).toFixed(2)}</small>`;
                }
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
        if (celda.classList.contains('celda-libre')) {
            if (vista === 'public') {
                mostrarModalReserva(celda.dataset.canchaId, celda.dataset.slotStart, celda.dataset.slotEnd);
            } else {
                alert('Función de creación rápida para admin (puedes implementarla)');
            }
        } else if (celda.classList.contains('celda-ocupada') || celda.classList.contains('celda-pagado') || celda.classList.contains('celda-deuda-adelanto') || celda.classList.contains('celda-deuda-sin-adelanto')) {
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
    const observacionesInput = document.getElementById('observaciones');

    const nuevaReservaHandler = async () => {
        const responsable = responsableInput.value.trim();
        if (!responsable) {
            alert('Ingrese el nombre del responsable');
            return;
        }
        const startDate = new Date(slotStartISO);
        const endDate = new Date(slotEndISO);
        const fechaStr = startDate.toISOString().slice(0,10);
        const horaInicioStr = startDate.toTimeString().slice(0,8);
        const horaFinStr = endDate.toTimeString().slice(0,8);
        const { error } = await supabaseClient
            .from('reservas')
            .insert({
                fecha: fechaStr,
                hora_inicio: horaInicioStr,
                hora_fin: horaFinStr,
                responsable: responsable,
                cancha_id: parseInt(canchaId),
                observaciones: observacionesInput.value,
                adelanto: 0,
                monto_efectivo: 0,
                monto_yape: 0,
                monto_pagado: 0,
                tipo_uso: 'futbol'
            });
        if (error) {
            alert('Error al guardar: ' + error.message);
        } else {
            alert('Reserva solicitada correctamente. Espera confirmación del administrador.');
            modal.style.display = 'none';
            responsableInput.value = '';
            telefonoInput.value = '';
            observacionesInput.value = '';
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
    alert('Función de edición de reserva para admin pendiente de implementar');
}
