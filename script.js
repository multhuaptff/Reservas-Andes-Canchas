// script.js
let supabaseClient;
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];
let preciosConfig = [];

// --- Función de tarifa por hora ---
function obtenerTarifaPorHora(tipoCancha, hora) {
    const diaInicio = 6, diaFin = 18;
    const rango = (hora >= diaInicio && hora < diaFin) ? 'dia' : 'noche';
    const precio = preciosConfig.find(p => p.tipo_cancha === tipoCancha && p.rango_nombre === rango);
    return precio ? precio.precio_por_hora : 0;
}

// --- Cálculo de costo por tramos (corregido) ---
async function calcularCostoEsperado(canchaId, fecha, horaIniStr, horaFinStr) {
    const cancha = canchas.find(c => c.id === canchaId);
    if (!cancha) return 0;
    const tipo = cancha.tipo;
    const [hIni, mIni] = horaIniStr.split(':').map(Number);
    const [hFin, mFin] = horaFinStr.split(':').map(Number);
    let inicio = hIni + mIni / 60;
    let fin = hFin + mFin / 60;
    const cambio = 18; // 18:00
    let costo = 0;
    if (inicio < cambio && fin > cambio) {
        let duracionDia = cambio - inicio;
        let tarifaDia = obtenerTarifaPorHora(tipo, inicio);
        costo += duracionDia * tarifaDia;
        let duracionNoche = fin - cambio;
        let tarifaNoche = obtenerTarifaPorHora(tipo, cambio);
        costo += duracionNoche * tarifaNoche;
    } else {
        let duracion = fin - inicio;
        let tarifa = obtenerTarifaPorHora(tipo, inicio);
        costo += duracion * tarifa;
    }
    return costo;
}

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
    await cargarReservas();
    renderizarTabla('admin');
    attachDoubleClick('admin');
    console.log('Vista administrador inicializada');
}

function setupCommonControls() {
    // Obtener fecha actual en zona local (YYYY-MM-DD)
    const hoy = new Date();
    const year = hoy.getFullYear();
    const month = String(hoy.getMonth() + 1).padStart(2, '0');
    const day = String(hoy.getDate()).padStart(2, '0');
    fechaActual = `${year}-${month}-${day}`;
    
    const fechaInput = document.getElementById('fecha');
    fechaInput.value = fechaActual;
    
    fechaInput.addEventListener('change', () => {
        fechaActual = fechaInput.value;
        cargarReservas(tipoVistaActual() === 'admin').then(() => renderizarTabla(tipoVistaActual()));
    });
    document.getElementById('btn-anterior').onclick = () => cambiarFecha(-1);
    document.getElementById('btn-siguiente').onclick = () => cambiarFecha(1);
    document.getElementById('btn-hoy').onclick = () => {
        fechaActual = `${year}-${month}-${day}`;
        fechaInput.value = fechaActual;
        cargarReservas(tipoVistaActual() === 'admin').then(() => renderizarTabla(tipoVistaActual()));
    };
    document.getElementById('granularidad').addEventListener('change', () => {
        generarSlots();
        renderizarTabla(tipoVistaActual());
    });
}

function tipoVistaActual() {
    // Forzar detección: si existe el modal, asumimos admin
    const isAdmin = document.getElementById('modal-reserva') !== null;
    console.log('Vista detectada:', isAdmin ? 'admin' : 'public');
    return isAdmin ? 'admin' : 'public';
}

function cambiarFecha(delta) {
    const date = new Date(fechaActual);
    date.setDate(date.getDate() + delta);
    fechaActual = date.toISOString().slice(0,10);
    document.getElementById('fecha').value = fechaActual;
    cargarReservas().then(() => renderizarTabla(tipoVistaActual()));
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

async function cargarReservas() {
    const { data, error } = await supabaseClient
        .from('reservas')
        .select('*')
        .eq('fecha', fechaActual);
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

function formatearHoraAMPM(hora, minuto) {
    let periodo = hora >= 12 ? 'PM' : 'AM';
    let hora12 = hora % 12;
    if (hora12 === 0) hora12 = 12;
    return `${hora12.toString().padStart(2,' ')}:${minuto.toString().padStart(2,'0')} ${periodo}`;
}

async function renderizarTabla(vista) {
    generarSlots();
    const container = document.getElementById('horario-container');
    if (!canchas.length || !slots.length) {
        container.innerHTML = '<p>Cargando...</p>';
        return;
    }
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
                    const costo = await calcularCostoEsperado(reservaEnSlot.cancha_id, reservaEnSlot.fecha, reservaEnSlot.hora_inicio, reservaEnSlot.hora_fin);
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
    if (!container) {
        console.error('No se encontró #horario-container');
        return;
    }
    container.addEventListener('dblclick', async (e) => {
        let celda = e.target.closest('td');
        if (!celda) return;
        if (celda.cellIndex === 0) return; // columna de hora
        
        console.log('Doble clic en celda', celda.className, vista);
        
        if (celda.classList.contains('celda-libre')) {
            if (vista === 'admin') {
                console.log('Mostrando modal para reserva');
                mostrarModalReserva(celda.dataset.canchaId, celda.dataset.slotStart, celda.dataset.slotEnd);
            } else {
                alert('Para reservar, contacta con el administrador o llama al local.');
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
    console.log('Evento de doble clic asignado');
}

function mostrarModalReserva(canchaId, slotStartISO, slotEndISO) {
    const modal = document.getElementById('modal-reserva');
    if (!modal) {
        console.error('Modal no encontrado. ¿Estás en admin.html?');
        alert('Error: No se encontró el formulario de reserva. Asegúrate de estar en admin.html');
        return;
    }
    modal.style.display = 'flex';
    const guardarBtn = document.getElementById('guardar-reserva');
    const cancelarBtn = document.getElementById('cancelar-reserva');
    const responsableInput = document.getElementById('responsable');
    const telefonoInput = document.getElementById('telefono');
    const adelantoInput = document.getElementById('adelanto');
    const metodoPagoSelect = document.getElementById('metodo_pago');
    const observacionesInput = document.getElementById('observaciones');

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
            alert('Reserva registrada correctamente.');
            modal.style.display = 'none';
            await cargarReservas();
            renderizarTabla('admin');
        }
    };
    guardarBtn.onclick = nuevaReservaHandler;
    cancelarBtn.onclick = () => {
        modal.style.display = 'none';
    };
}
