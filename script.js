// script.js
let supabaseClient;
let fechaActual = new Date().toISOString().slice(0,10);
let canchas = [];
let reservas = [];
let slots = [];
let preciosConfig = [];
let currentCanchaId = null;
let currentSlotStart = null;
let currentSlotEnd = null;

// --- Función de tarifa por hora ---
function obtenerTarifaPorHora(tipoCancha, hora) {
    const diaInicio = 6, diaFin = 18;
    const rango = (hora >= diaInicio && hora < diaFin) ? 'dia' : 'noche';
    const precio = preciosConfig.find(p => p.tipo_cancha === tipoCancha && p.rango_nombre === rango);
    return precio ? precio.precio_por_hora : 0;
}

// --- Cálculo de costo por tramos (para una cancha individual) ---
async function calcularCostoIndividual(tipoCancha, fecha, horaIniStr, horaFinStr) {
    const [hIni, mIni] = horaIniStr.split(':').map(Number);
    const [hFin, mFin] = horaFinStr.split(':').map(Number);
    let inicio = hIni + mIni / 60;
    let fin = hFin + mFin / 60;
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
        costo += duracion * tarifa;
    }
    return costo;
}

// --- Costo para tipos especiales (completa, media) ---
async function calcularCostoEspecial(tipoEspecial, fecha, horaIniStr, horaFinStr) {
    const [hIni, mIni] = horaIniStr.split(':').map(Number);
    const [hFin, mFin] = horaFinStr.split(':').map(Number);
    let inicio = hIni + mIni / 60;
    let fin = hFin + mFin / 60;
    const cambio = 18;
    let costo = 0;
    if (inicio < cambio && fin > cambio) {
        let duracionDia = cambio - inicio;
        let tarifaDia = obtenerTarifaPorHora(tipoEspecial, inicio);
        costo += duracionDia * tarifaDia;
        let duracionNoche = fin - cambio;
        let tarifaNoche = obtenerTarifaPorHora(tipoEspecial, cambio);
        costo += duracionNoche * tarifaNoche;
    } else {
        let duracion = fin - inicio;
        let tarifa = obtenerTarifaPorHora(tipoEspecial, inicio);
        costo += duracion * tarifa;
    }
    return costo;
}

// --- Obtener IDs de canchas por nombre (Fútbol 1,2,3,4) ---
function obtenerCanchasPorNombres(nombres) {
    return canchas.filter(c => nombres.includes(c.nombre)).map(c => c.id);
}

// --- Verificar conflictos para una lista de canchas ---
async function verificarConflictos(canchaIds, fecha, horaInicio, horaFin) {
    const { data, error } = await supabaseClient
        .from('reservas')
        .select('cancha_id')
        .eq('fecha', fecha)
        .filter('hora_inicio', 'lt', horaFin)
        .filter('hora_fin', 'gt', horaInicio)
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
    await cargarReservas();
    renderizarTabla('admin');
    attachDoubleClick('admin');
    configurarModalDinamico();
    console.log('Vista administrador inicializada');
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
                    let costo;
                    // Determinar tipo de cancha para calcular costo
                    const canchaObj = canchas.find(c => c.id === reservaEnSlot.cancha_id);
                    if (canchaObj) {
                        costo = await calcularCostoIndividual(canchaObj.tipo, reservaEnSlot.fecha, reservaEnSlot.hora_inicio, reservaEnSlot.hora_fin);
                    } else {
                        costo = 0;
                    }
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
                currentSlotStart = celda.dataset.slotStart;
                currentSlotEnd = celda.dataset.slotEnd;
                // Determinar opciones de tipo según la cancha seleccionada
                const cancha = canchas.find(c => c.id === currentCanchaId);
                const tipoSelect = document.getElementById('tipo-reserva');
                // Limpiar y mostrar opciones según si es fútbol o vóley
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
                // Actualizar costo estimado al cambiar tipo
                tipoSelect.addEventListener('change', actualizarCostoEstimadoModal);
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
    const startDate = new Date(currentSlotStart);
    const endDate = new Date(currentSlotEnd);
    const horaInicioStr = startDate.toTimeString().slice(0,8);
    const horaFinStr = endDate.toTimeString().slice(0,8);
    const fechaStr = startDate.toISOString().slice(0,10);
    let costo = 0;
    if (tipo === 'individual') {
        const cancha = canchas.find(c => c.id === currentCanchaId);
        if (cancha) {
            costo = await calcularCostoIndividual(cancha.tipo, fechaStr, horaInicioStr, horaFinStr);
        }
    } else if (tipo === 'media12' || tipo === 'media34') {
        costo = await calcularCostoEspecial('media_cancha', fechaStr, horaInicioStr, horaFinStr);
    } else if (tipo === 'completa') {
        costo = await calcularCostoEspecial('completa', fechaStr, horaInicioStr, horaFinStr);
    }
    document.getElementById('costo-estimado').innerText = `S/ ${costo.toFixed(2)}`;
}

function mostrarModalReserva() {
    const modal = document.getElementById('modal-reserva');
    modal.style.display = 'flex';
}

function configurarModalDinamico() {
    const guardarBtn = document.getElementById('guardar-reserva');
    const cancelarBtn = document.getElementById('cancelar-reserva');
    guardarBtn.onclick = guardarReservaGrupo;
    cancelarBtn.onclick = () => {
        document.getElementById('modal-reserva').style.display = 'none';
    };
}

async function guardarReservaGrupo() {
    const responsable = document.getElementById('responsable').value.trim();
    if (!responsable) {
        alert('Ingrese el nombre del responsable');
        return;
    }
    const tipo = document.getElementById('tipo-reserva').value;
    const adelantoTotal = parseFloat(document.getElementById('adelanto').value) || 0;
    const metodo = document.getElementById('metodo_pago').value;
    const observaciones = document.getElementById('observaciones').value;
    const startDate = new Date(currentSlotStart);
    const endDate = new Date(currentSlotEnd);
    const fechaStr = startDate.toISOString().slice(0,10);
    const horaInicioStr = startDate.toTimeString().slice(0,8);
    const horaFinStr = endDate.toTimeString().slice(0,8);
    
    // Determinar lista de canchas a reservar
    let canchaIds = [];
    if (tipo === 'individual') {
        canchaIds = [currentCanchaId];
    } else if (tipo === 'media12') {
        canchaIds = obtenerCanchasPorNombres(['Fútbol 1', 'Fútbol 2']);
    } else if (tipo === 'media34') {
        canchaIds = obtenerCanchasPorNombres(['Fútbol 3', 'Fútbol 4']);
    } else if (tipo === 'completa') {
        canchaIds = obtenerCanchasPorNombres(['Fútbol 1', 'Fútbol 2', 'Fútbol 3', 'Fútbol 4']);
    }
    
    if (canchaIds.length === 0) {
        alert('No se encontraron las canchas necesarias. Verifica los nombres en Supabase.');
        return;
    }
    
    // Verificar conflictos
    try {
        const hayConflicto = await verificarConflictos(canchaIds, fechaStr, horaInicioStr, horaFinStr);
        if (hayConflicto) {
            alert('Una o más canchas ya están ocupadas en ese horario.');
            return;
        }
    } catch (err) {
        alert('Error al verificar disponibilidad: ' + err.message);
        return;
    }
    
    // Calcular costo total esperado
    let costoTotal = 0;
    if (tipo === 'individual') {
        const cancha = canchas.find(c => c.id === currentCanchaId);
        if (cancha) costoTotal = await calcularCostoIndividual(cancha.tipo, fechaStr, horaInicioStr, horaFinStr);
    } else if (tipo === 'media12' || tipo === 'media34') {
        costoTotal = await calcularCostoEspecial('media_cancha', fechaStr, horaInicioStr, horaFinStr);
    } else if (tipo === 'completa') {
        costoTotal = await calcularCostoEspecial('completa', fechaStr, horaInicioStr, horaFinStr);
    }
    
    if (adelantoTotal > costoTotal) {
        alert(`El adelanto (S/${adelantoTotal}) no puede superar el costo total (S/${costoTotal})`);
        return;
    }
    
    // Distribuir adelanto entre las canchas (proporcional al costo individual de cada una)
    const costosIndividuales = [];
    for (let cid of canchaIds) {
        const cancha = canchas.find(c => c.id === cid);
        let costoInd = 0;
        if (cancha) {
            costoInd = await calcularCostoIndividual(cancha.tipo, fechaStr, horaInicioStr, horaFinStr);
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
        // Si no hay costos (caso raro), repartir equitativamente
        const igual = adelantoTotal / canchaIds.length;
        for (let i = 0; i < canchaIds.length; i++) montosAdelanto.push(igual);
    }
    
    // Generar grupo_id único
    const grupo_id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36);
    
    // Crear reservas
    const reservasInsert = [];
    for (let i = 0; i < canchaIds.length; i++) {
        let montoEfectivo = 0, montoYape = 0;
        if (metodo === 'efectivo') montoEfectivo = montosAdelanto[i];
        else montoYape = montosAdelanto[i];
        
        reservasInsert.push({
            fecha: fechaStr,
            hora_inicio: horaInicioStr,
            hora_fin: horaFinStr,
            responsable: responsable,
            cancha_id: canchaIds[i],
            observaciones: observaciones,
            adelanto: montosAdelanto[i],
            monto_efectivo: montoEfectivo,
            monto_yape: montoYape,
            monto_pagado: montosAdelanto[i],
            metodo_pago: metodo,
            tipo_uso: 'futbol',
            grupo_id: grupo_id,
            cliente_id: null
        });
    }
    
    // Insertar en lote
    const { data, error } = await supabaseClient
        .from('reservas')
        .insert(reservasInsert);
    
    if (error) {
        alert('Error al guardar: ' + error.message);
    } else {
        alert(`Reserva ${tipo === 'individual' ? 'individual' : 'grupal'} registrada correctamente.`);
        document.getElementById('modal-reserva').style.display = 'none';
        await cargarReservas();
        renderizarTabla('admin');
    }
}
