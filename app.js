// El mismo app.js corre en dos lugares: el dashboard local del owner y el
// link compartido (GitHub Pages), donde el HTML generado trae
// data-mode="viewer" y no existen los controles de owner (fecha, Actualizar,
// Publicar, Usuarios) - por eso esas referencias pueden ser null.
const VIEWER_MODE = document.documentElement.dataset.mode === "viewer";

const excludeDescargaInput = document.getElementById("exclude-descarga");
const onlyFbsInput = document.getElementById("only-fbs");
const dateInput = document.getElementById("date");
const searchInput = document.getElementById("search");
const sellerListEl = document.getElementById("seller-list");
const liveToggleBtn = document.getElementById("only-live-eta");
const statusFilterEl = document.getElementById("status-filter");
const sortEl = document.getElementById("sort");
const refreshBtn = document.getElementById("refresh");
const statusLine = document.getElementById("status-line");
const summaryLine = document.getElementById("summary-line");
const cargoSummaryEl = document.getElementById("cargo-summary");
const resultsEl = document.getElementById("results");
const vista1SearchInput = document.getElementById("vista1-search");
const vista1ResultsEl = document.getElementById("vista1-results");
const avanceSearchInput = document.getElementById("avance-search");
const avanceResultsEl = document.getElementById("avance-results");
const cumplSearchInput = document.getElementById("cumpl-search");
const cumplFilterEl = document.getElementById("cumpl-filter");
const cumplSortEl = document.getElementById("cumpl-sort");
const cumplResultsEl = document.getElementById("cumpl-results");
const downloadCumplCsvBtn = document.getElementById("download-cumpl-csv");
const analysisSearchInput = document.getElementById("analysis-search");
const analysisResultsEl = document.getElementById("analysis-results");
const durationSearchInput = document.getElementById("duration-search");
const durationSortEl = document.getElementById("duration-sort");
const durationResultsEl = document.getElementById("duration-results");
const sabanaSearchInput = document.getElementById("sabana-search");
const sabanaResultsEl = document.getElementById("sabana-results");
const sabanaCountEl = document.getElementById("sabana-count");
const downloadCsvBtn = document.getElementById("download-csv");
const failedSearchInput = document.getElementById("failed-search");
const downloadFailedCsvBtn = document.getElementById("download-failed-csv");
const failedGroupsEl = document.getElementById("failed-groups");
const failedResultsEl = document.getElementById("failed-results");
const amPmFilterEl = document.getElementById("ampm-filter");
const publishBtn = document.getElementById("publish");
const tabButtons = document.querySelectorAll(".tab");
const tabPanels = {};
for (const btn of tabButtons) {
  tabPanels[btn.dataset.tab] = document.getElementById(`tab-${btn.dataset.tab}`);
}
let durationSortMode = "duration-desc";
let selectedFailReason = null;

let lastData = null;
let onlyLive = false;
let sortMode = "route-order";
let amPmFilter = "all";
const activeStatuses = new Set(["pending", "completed", "failed", "skipped"]);

// Las paradas "Descarga" son vueltas del camion al centro de distribucion,
// no sellers reales - ensucian los tiempos de retiro/duracion si se cuelan
// en los analisis. getWorkingData() aplica ese filtro (si esta prendido), mas
// el filtro de turno AM/PM, a una copia de lastData; todas las pestañas leen
// de aca, nunca de lastData directamente, asi los filtros se aplican parejo
// en todos lados.
function isDescargaStop(stop) {
  // No siempre esta al principio del nombre: hay paradas tipo
  // "MARCA - FBF 9006 a Seller - Descarga Devolución (Recall) FULL" donde
  // "Descarga" queda en el medio (devoluciones al CD), ademas de las simples
  // "Descarga - 7100". Buscamos la palabra en cualquier parte del nombre.
  return (stop.seller_name || "").toLowerCase().includes("descarga");
}

// Bultos retirados que cuentan para los totales. En las paradas "Descarga"
// el chofer anota en cajas_retiradas lo que DESCARGA en el CD (lo mismo que ya
// retiro en los sellers), asi que sumarlas contaria todo dos veces.
function pickedUpQty(stop) {
  return isDescargaStop(stop) ? 0 : toNumber(stop.bultos_retirados);
}

// "FBS" es uno de los varios "programas" de retiro (los otros son SOD VEV y
// FBF); hoy es el unico bien cubierto por el archivo de Seller ID.
function isFbsStop(stop) {
  return (stop.seller_name || "").toUpperCase().includes("FBS");
}

const AM_PM_THRESHOLD_MIN = 12 * 60 + 30; // 12:30

function windowStartMinutes(stop) {
  if (!stop.window_start) return null;
  const [h, m] = stop.window_start.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function matchesAmPmFilter(stop) {
  if (amPmFilter === "all") return true;
  const mins = windowStartMinutes(stop);
  if (mins === null) return false; // sin ventana cargada, no se puede clasificar
  return amPmFilter === "am" ? mins < AM_PM_THRESHOLD_MIN : mins >= AM_PM_THRESHOLD_MIN;
}

function getWorkingData() {
  if (!lastData) return null;
  if (!excludeDescargaInput.checked && !onlyFbsInput.checked && amPmFilter === "all") return lastData;
  return {
    ...lastData,
    vehicles: lastData.vehicles.map((v) => ({
      ...v,
      routes: v.routes.map((r) => ({
        ...r,
        stops: (r.stops || []).filter(
          (s) =>
            (!excludeDescargaInput.checked || !isDescargaStop(s)) &&
            (!onlyFbsInput.checked || isFbsStop(s)) &&
            matchesAmPmFilter(s)
        ),
      })),
    })),
  };
}

if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

// Todo texto que viene de SimpliRoute (nombres, direcciones, comentarios
// libres del chofer) pasa por aca antes de entrar a innerHTML - en el link
// compartido, un texto malicioso no puede ejecutar codigo.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Cruce local contra "Titulos simpli.xlsx" (via server.py) - no siempre
// matchea (sobre todo visitas FBF/Devolucion), por eso el fallback a "-".
// Cuando matchea por nombre "pelado" (no exacto) se lo marca con un "~" y
// tooltip, para no mostrar la misma confianza que un match exacto.
function sellerIdLabel(stop) {
  if (!stop.seller_id) return "-";
  if (stop.seller_id_exact) return esc(stop.seller_id);
  return `<span title="Coincidencia aproximada por nombre (no exacta)">${esc(stop.seller_id)} ~</span>`;
}

// Misma info que sellerIdLabel pero en texto plano, para CSV (sin HTML).
function sellerIdLabelPlain(stop) {
  if (!stop.seller_id) return "";
  return stop.seller_id_exact ? stop.seller_id : `${stop.seller_id} (aprox.)`;
}

const STATUS_LABELS = {
  completed: "Completada",
  pending: "Pendiente",
  failed: "Fallida",
  skipped: "Salteada",
};

function statusBadge(status) {
  const key = (status || "pending").toLowerCase();
  const label = STATUS_LABELS[key] || status || "-";
  return `<span class="badge ${esc(key)}">${esc(label)}</span>`;
}

function matchesSearch(stop, query) {
  if (!query) return false;
  return (stop.seller_name || "").toLowerCase().includes(query);
}

function formatEta(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return esc(isoString);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// SimpliRoute no traduce la unidad de "load"/"load_2"/"load_3" via API (son
// las unidades genericas que cada cuenta configura) - las mostramos con los
// mismos nombres genericos que usa la propia app de SimpliRoute ("Carga",
// "Carga 2", "Carga 3") en vez de inventarles una unidad.
function formatLoad(stop) {
  const parts = [];
  if (stop.load) parts.push(`Carga: ${esc(stop.load)}`);
  if (stop.load_2) parts.push(`Carga 2: ${esc(stop.load_2)}`);
  if (stop.load_3) parts.push(`Carga 3: ${esc(stop.load_3)}`);
  return parts.length ? parts.join(" · ") : "-";
}

function formatWindow(stop) {
  if (!stop.window_start && !stop.window_end) return "-";
  return esc(`${(stop.window_start || "-").slice(0, 5)} - ${(stop.window_end || "-").slice(0, 5)}`);
}

function effectiveEtaDate(stop) {
  const iso = stop.current_eta || stop.estimated_time_arrival;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// "En vivo" = el camion ya salio hacia esa parada ahora mismo y todavia no
// hizo check-in (o sea, el ETA que se muestra se esta recalculando en vivo,
// no es solo la estimacion original del plan).
function isLiveEta(stop) {
  const status = (stop.status || "pending").toLowerCase();
  return status === "pending" && !!stop.on_its_way && !stop.checkin_time;
}

function pendingBeforeIn(stops, index) {
  return stops.slice(0, index).filter((s) => (s.status || "pending").toLowerCase() === "pending").length;
}

function sortStops(stops, sortMode) {
  const withIndex = stops.map((s, i) => ({ s, i }));
  if (sortMode === "eta-asc") {
    withIndex.sort((a, b) => {
      const da = effectiveEtaDate(a.s);
      const db = effectiveEtaDate(b.s);
      if (!da && !db) return a.i - b.i;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
  } else if (sortMode === "seller-asc") {
    withIndex.sort((a, b) => (a.s.seller_name || "").localeCompare(b.s.seller_name || ""));
  } else {
    withIndex.sort((a, b) => (a.s.order ?? a.i) - (b.s.order ?? b.i));
  }
  return withIndex.map((w) => w.s);
}

function bestKeyForOrdering(stops, sortMode) {
  // Usado para decidir en qué orden aparecen las tarjetas de camión/ruta.
  if (sortMode === "eta-asc") {
    const dates = stops.map(effectiveEtaDate).filter(Boolean);
    return dates.length ? Math.min(...dates.map((d) => d.getTime())) : Infinity;
  }
  if (sortMode === "seller-asc") {
    const names = stops.map((s) => s.seller_name || "").filter(Boolean).sort();
    return names[0] || "￿";
  }
  return null; // mantiene el orden original
}

function populateSellerDatalist(data) {
  const names = new Set();
  for (const vehicle of data.vehicles || []) {
    for (const route of vehicle.routes || []) {
      for (const stop of route.stops || []) {
        if (stop.seller_name) names.add(stop.seller_name);
      }
    }
  }
  sellerListEl.innerHTML = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((n) => `<option value="${esc(n)}"></option>`)
    .join("");
}

function renderRouteTable(stops, query) {
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>#</th>
        <th>Seller</th>
        <th>Seller ID</th>
        <th>Dirección</th>
        <th>Estado</th>
        <th>Ventana</th>
        <th>ETA en vivo</th>
        <th>Cerrada a las</th>
        <th>Carga 2</th>
        <th>Retirado (bultos)</th>
        <th>Faltan antes</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  stops.forEach((stop) => {
    const tr = document.createElement("tr");
    if (matchesSearch(stop, query)) tr.classList.add("highlight");
    if (isLiveEta(stop)) tr.classList.add("current-stop");

    const eta = formatEta(stop.current_eta) !== "-" ? formatEta(stop.current_eta) : formatEta(stop.estimated_time_arrival);
    const statusKey = (stop.status || "pending").toLowerCase();
    const note = statusKey === "failed" && stop.checkout_comment ? `<div class="note">${esc(stop.checkout_comment)}</div>` : "";
    const closedAt = statusKey === "completed" || statusKey === "failed" ? formatEta(stop.checkout_time) : "-";

    tr.innerHTML = `
      <td>${esc(stop.order ?? "-")}</td>
      <td>${esc(stop.seller_name || "(sin nombre)")}${isLiveEta(stop) ? " 🚚" : ""}</td>
      <td>${sellerIdLabel(stop)}</td>
      <td>${esc(stop.address || "-")}</td>
      <td>${statusBadge(stop.status)}${note}</td>
      <td>${formatWindow(stop)}</td>
      <td>${eta}</td>
      <td>${closedAt}</td>
      <td>${esc(stop.load_2 ?? "-")}</td>
      <td>${esc(stop.bultos_retirados ?? "-")}</td>
      <td>${esc(stop.pending_before)}</td>
    `;
    tbody.appendChild(tr);
  });

  return table;
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatQty(n) {
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("es-CL", { maximumFractionDigits: 1 });
}

// Carga 2 = "pedidos" vs lo efectivamente retirado, en unidades de carga (no
// en cantidad de paradas - eso ya lo cubre la barra de "Avance de retiros"
// en Analisis). Dinamico: se calcula sobre exactamente lo que queda visible
// despues de aplicar TODOS los filtros de la pestaña (buscador, chips de
// estado, "en camino ahora", mas los globales de Descarga/AM-PM) - el
// llamador (render()) ya filtro esos stops, aca solo se suma y se muestra.
function renderCargoSummary(totalOrders, retrieved) {
  if (!lastData) {
    cargoSummaryEl.innerHTML = "";
    return;
  }

  const pct = totalOrders ? Math.round((retrieved / totalOrders) * 100) : null;
  const filtersActive =
    searchInput.value.trim() ||
    onlyLive ||
    activeStatuses.size < 4 ||
    excludeDescargaInput.checked ||
    onlyFbsInput.checked ||
    amPmFilter !== "all";

  cargoSummaryEl.className = "summary-strip";
  cargoSummaryEl.innerHTML = `
    <div class="summary-tile"><div class="value">${formatQty(totalOrders)}</div><div class="label">Pedidos${filtersActive ? " (según filtros)" : " del día"} (Carga 2)</div></div>
    <div class="summary-tile sev-ok"><div class="value">${formatQty(retrieved)}</div><div class="label">Retirados efectivamente${filtersActive ? " (filtro)" : ""}</div></div>
    <div class="summary-tile ${pct !== null && pct < 80 ? "sev-warning" : "sev-ok"}"><div class="value">${pct === null ? "-" : pct + "%"}</div><div class="label">% recogido (por volumen)</div></div>
  `;
}

function render() {
  const data = getWorkingData();
  if (!data) return;

  const query = searchInput.value.trim().toLowerCase();

  resultsEl.innerHTML = "";

  let totalShown = 0;
  let liveShown = 0;
  let pendingShown = 0;
  let completedShown = 0;
  let failedShown = 0;
  let ordersShown = 0;
  let retrievedShown = 0;

  const vehicleBlocks = [];

  for (const vehicle of data.vehicles || []) {
    const routeBlocks = [];

    for (const route of vehicle.routes || []) {
      const stopsWithFlags = (route.stops || []).map((stop, idx) => ({
        ...stop,
        pending_before: pendingBeforeIn(route.stops, idx),
      }));

      // El filtro de estado siempre se aplica. El filtro "en vivo" ademas
      // achica la lista a solo las paradas con el camion en camino ahora
      // mismo (declutter). El buscador, en cambio, conserva el contexto
      // completo de la ruta (dentro de lo que dejan pasar los otros
      // filtros) y solo resalta la fila que matchea.
      let visibleStops = stopsWithFlags.filter((s) => activeStatuses.has((s.status || "pending").toLowerCase()));
      if (onlyLive) visibleStops = visibleStops.filter(isLiveEta);
      if (visibleStops.length === 0) continue;

      if (query) {
        const hasMatch = visibleStops.some((s) => matchesSearch(s, query));
        if (!hasMatch) continue;
      }

      visibleStops = sortStops(visibleStops, sortMode);
      routeBlocks.push({ route_id: route.route_id, stops: visibleStops });
    }

    if (routeBlocks.length === 0) continue;

    const allVisibleStops = routeBlocks.flatMap((r) => r.stops);
    totalShown += allVisibleStops.length;
    liveShown += allVisibleStops.filter(isLiveEta).length;
    pendingShown += allVisibleStops.filter((s) => (s.status || "pending").toLowerCase() === "pending").length;
    completedShown += allVisibleStops.filter((s) => (s.status || "").toLowerCase() === "completed").length;
    failedShown += allVisibleStops.filter((s) => (s.status || "").toLowerCase() === "failed").length;
    ordersShown += allVisibleStops.reduce((sum, s) => sum + toNumber(s.load_2), 0);
    retrievedShown += allVisibleStops
      .filter((s) => (s.status || "").toLowerCase() === "completed")
      .reduce((sum, s) => sum + pickedUpQty(s), 0);

    vehicleBlocks.push({
      vehicle_name: vehicle.vehicle_name,
      driver_name: vehicle.driver_name,
      routes: routeBlocks,
      orderKey: bestKeyForOrdering(allVisibleStops, sortMode),
    });
  }

  if (sortMode !== "route-order") {
    vehicleBlocks.sort((a, b) => {
      if (a.orderKey < b.orderKey) return -1;
      if (a.orderKey > b.orderKey) return 1;
      return 0;
    });
  }

  summaryLine.textContent = totalShown
    ? `${totalShown} parada(s) — ${pendingShown} pendiente(s) (${liveShown} con camión en camino ahora), ${completedShown} completada(s), ${failedShown} fallida(s).`
    : "";

  renderCargoSummary(ordersShown, retrievedShown);

  if (vehicleBlocks.length === 0) {
    resultsEl.innerHTML = `<div class="empty">${
      query || onlyLive || activeStatuses.size < 4
        ? "Ningún seller coincide con estos filtros."
        : "No hay rutas para esta fecha."
    }</div>`;
    return;
  }

  for (const block of vehicleBlocks) {
    const card = document.createElement("div");
    card.className = "vehicle-card";

    const title = document.createElement("h2");
    title.textContent = block.vehicle_name || "Vehículo";
    card.appendChild(title);

    const driver = document.createElement("div");
    driver.className = "driver";
    driver.textContent = block.driver_name ? `Chofer: ${block.driver_name}` : "Sin chofer asignado";
    card.appendChild(driver);

    block.routes.forEach((route, i) => {
      if (block.routes.length > 1) {
        const routeLabel = document.createElement("div");
        routeLabel.className = "route-label";
        routeLabel.textContent = `Ruta ${i + 1} de ${block.routes.length} de este vehículo hoy`;
        card.appendChild(routeLabel);
      }
      card.appendChild(renderRouteTable(route.stops, query));
    });

    resultsEl.appendChild(card);
  }
}

// ---------- Pestaña Análisis ----------

function parseLocalDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMinutes(mins) {
  const abs = Math.abs(Math.round(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function flattenAllStops(data) {
  const rows = [];
  for (const vehicle of data.vehicles || []) {
    for (const route of vehicle.routes || []) {
      for (const stop of route.stops || []) {
        rows.push({ ...stop, vehicle_name: vehicle.vehicle_name, driver_name: vehicle.driver_name });
      }
    }
  }
  return rows;
}

function renderInsightCard(container, { severity, title, description, rows, columns, emptyText }) {
  const card = document.createElement("div");
  card.className = `insight-card sev-${severity}`;

  const header = document.createElement("div");
  header.className = "insight-header";
  header.innerHTML = `<h3>${title}</h3><span class="insight-count">${rows.length}</span>`;
  card.appendChild(header);

  const desc = document.createElement("p");
  desc.className = "insight-desc";
  desc.textContent = description;
  card.appendChild(desc);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyText;
    card.appendChild(empty);
  } else {
    const table = document.createElement("table");
    table.innerHTML = `
      <thead><tr>${columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map((row) => `<tr>${columns.map((c) => `<td>${c.render(row)}</td>`).join("")}</tr>`)
        .join("")}</tbody>
    `;
    card.appendChild(table);
  }

  container.appendChild(card);
}

function renderAnalysis() {
  analysisResultsEl.innerHTML = "";
  const data = getWorkingData();
  if (!data) return;

  const query = analysisSearchInput.value.trim().toLowerCase();
  let stops = flattenAllStops(data);
  if (query) {
    stops = stops.filter((s) => (s.seller_name || "").toLowerCase().includes(query));
  }

  const now = new Date();
  const planDate = data.date;

  // 1) Ventana vencida y la parada sigue pendiente: la alerta roja que pediste.
  const overdueNoVisit = stops
    .filter((s) => (s.status || "pending").toLowerCase() === "pending")
    .map((s) => ({ ...s, windowEndDate: parseLocalDateTime(planDate, s.window_end) }))
    .filter((s) => s.windowEndDate && s.windowEndDate.getTime() < now.getTime())
    .map((s) => ({ ...s, overdueMin: (now - s.windowEndDate) / 60000 }))
    .sort((a, b) => b.overdueMin - a.overdueMin);

  // 2) Todavía pendiente, dentro de ventana, pero el ETA en vivo ya indica
  // que va a llegar después del cierre de la ventana.
  const willMissWindow = stops
    .filter((s) => (s.status || "pending").toLowerCase() === "pending" && s.current_eta)
    .map((s) => ({
      ...s,
      etaDate: new Date(s.current_eta),
      windowEndDate: parseLocalDateTime(planDate, s.window_end),
    }))
    .filter(
      (s) =>
        s.windowEndDate &&
        !Number.isNaN(s.etaDate.getTime()) &&
        s.etaDate.getTime() > s.windowEndDate.getTime() &&
        s.windowEndDate.getTime() >= now.getTime()
    )
    .map((s) => ({ ...s, lateMin: (s.etaDate - s.windowEndDate) / 60000 }))
    .sort((a, b) => b.lateMin - a.lateMin);

  // 3) Llego (check-in) mucho antes de que abriera la ventana: el otro caso
  // que pediste (ventana 12:00, camion llego 10:00).
  const earlyArrivals = stops
    .filter((s) => s.checkin_time && s.window_start)
    .map((s) => ({
      ...s,
      checkinDate: new Date(s.checkin_time),
      windowStartDate: parseLocalDateTime(planDate, s.window_start),
    }))
    .filter((s) => s.windowStartDate && s.checkinDate.getTime() < s.windowStartDate.getTime())
    .map((s) => ({ ...s, earlyMin: (s.windowStartDate - s.checkinDate) / 60000 }))
    .sort((a, b) => b.earlyMin - a.earlyMin);

  // 4) Llego (check-in) despues de cerrada la ventana.
  const lateArrivals = stops
    .filter((s) => s.checkin_time && s.window_end)
    .map((s) => ({
      ...s,
      checkinDate: new Date(s.checkin_time),
      windowEndDate: parseLocalDateTime(planDate, s.window_end),
    }))
    .filter((s) => s.windowEndDate && s.checkinDate.getTime() > s.windowEndDate.getTime())
    .map((s) => ({ ...s, lateMin: (s.checkinDate - s.windowEndDate) / 60000 }))
    .sort((a, b) => b.lateMin - a.lateMin);

  // 5) Fallidas, con el motivo que dejo el chofer.
  const failedStops = stops.filter((s) => (s.status || "").toLowerCase() === "failed");

  const total = stops.length;
  const pending = stops.filter((s) => (s.status || "pending").toLowerCase() === "pending").length;
  const completed = stops.filter((s) => (s.status || "").toLowerCase() === "completed").length;

  // El cumplimiento de ventana mide si el camion LLEGO a tiempo, no si el
  // retiro salio bien - una parada fallida en la que el chofer igual hizo
  // check-in (llego, intento, no pudo retirar) sigue siendo una visita real
  // y entra en la cuenta. Solo quedan afuera las que nunca llegaron
  // (pendientes, o fallidas sin check-in registrado).
  const visitedStops = stops.filter((s) => {
    const st = (s.status || "").toLowerCase();
    return (st === "completed" || st === "failed") && s.checkin_time;
  });
  const onTime = visitedStops.filter((s) => {
    const checkin = new Date(s.checkin_time);
    const ws = parseLocalDateTime(planDate, s.window_start);
    const we = parseLocalDateTime(planDate, s.window_end);
    if (!ws || !we) return false;
    return checkin.getTime() >= ws.getTime() && checkin.getTime() <= we.getTime();
  }).length;
  const onTimePct = visitedStops.length ? Math.round((onTime / visitedStops.length) * 100) : null;
  const failed = failedStops.length;
  const completedPct = total ? Math.round((completed / total) * 100) : 0;
  const failedPct = total ? Math.round((failed / total) * 100) : 0;

  const progress = document.createElement("div");
  progress.className = "progress-section";
  progress.innerHTML = `
    <div class="progress-header">
      <span class="title">Avance de retiros del día</span>
      <span class="value"><strong>${completed}</strong> / ${total} completados (${completedPct}%)</span>
    </div>
    <div class="progress-bar">
      <div class="progress-segment completed" style="width:${completedPct}%"></div>
      <div class="progress-segment failed" style="width:${failedPct}%"></div>
    </div>
    <div class="progress-legend">
      <span class="lg-completed">${completed} completados</span>
      <span class="lg-failed">${failed} fallidos</span>
      <span class="lg-pending">${pending} pendientes</span>
    </div>
  `;
  analysisResultsEl.appendChild(progress);

  const summary = document.createElement("div");
  summary.className = "summary-strip";
  summary.innerHTML = `
    <div class="summary-tile"><div class="value">${total}</div><div class="label">Paradas totales</div></div>
    <div class="summary-tile"><div class="value">${pending}</div><div class="label">Pendientes</div></div>
    <div class="summary-tile ${overdueNoVisit.length ? "sev-critical" : "sev-ok"}"><div class="value">${overdueNoVisit.length}</div><div class="label">Vencidas sin visitar</div></div>
    <div class="summary-tile ${onTimePct !== null && onTimePct < 80 ? "sev-warning" : "sev-ok"}" title="Sobre visitas con check-in real (completadas + fallidas), no solo las exitosas"><div class="value">${onTimePct === null ? "-" : onTimePct + "%"}</div><div class="label">Cumplimiento de ventana</div></div>
  `;
  analysisResultsEl.appendChild(summary);

  const vehicleCol = { label: "Vehículo / Chofer", render: (r) => `${esc(r.vehicle_name || "-")}<br><span style="color:var(--muted);font-size:0.75rem">${esc(r.driver_name || "-")}</span>` };
  const sellerCol = { label: "Seller", render: (r) => esc(r.seller_name || "(sin nombre)") };
  const sellerIdCol = { label: "Seller ID", render: (r) => sellerIdLabel(r) };
  const windowCol = { label: "Ventana", render: (r) => esc(`${(r.window_start || "-").slice(0, 5)} - ${(r.window_end || "-").slice(0, 5)}`) };

  renderInsightCard(analysisResultsEl, {
    severity: "critical",
    title: "🔴 Ventana vencida y sigue pendiente",
    description:
      "Ya pasó la hora de cierre de ventana comprometida con el seller y la parada no se completó. Si además dice \"sin camión en camino\", ni siquiera salió hacia allá.",
    rows: overdueNoVisit,
    emptyText: "Ninguna, por ahora.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      windowCol,
      { label: "Vencida hace", render: (r) => formatMinutes(r.overdueMin) },
      {
        label: "Camión",
        render: (r) => (r.on_its_way ? "En camino" : "Sin camión en camino"),
      },
    ],
  });

  renderInsightCard(analysisResultsEl, {
    severity: "warning",
    title: "🟠 El ETA en vivo ya indica que va a llegar tarde",
    description: "Todavía está dentro de la ventana, pero el ETA recalculado en vivo cae después del cierre.",
    rows: willMissWindow,
    emptyText: "Ninguna, por ahora.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      windowCol,
      { label: "ETA en vivo", render: (r) => formatEta(r.current_eta) },
      { label: "Se pasa por", render: (r) => formatMinutes(r.lateMin) },
    ],
  });

  renderInsightCard(analysisResultsEl, {
    severity: "info",
    title: "🔵 Llegó mucho antes de que abriera la ventana",
    description: "El check-in del chofer quedó registrado antes del inicio de la ventana comprometida con el seller.",
    rows: earlyArrivals,
    emptyText: "Ninguna.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      windowCol,
      { label: "Check-in", render: (r) => formatEta(r.checkin_time) },
      { label: "Llegó antes por", render: (r) => formatMinutes(r.earlyMin) },
    ],
  });

  renderInsightCard(analysisResultsEl, {
    severity: "warning",
    title: "🟣 Llegó después de cerrada la ventana",
    description: "El check-in del chofer quedó registrado después del cierre de la ventana comprometida.",
    rows: lateArrivals,
    emptyText: "Ninguna.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      windowCol,
      { label: "Check-in", render: (r) => formatEta(r.checkin_time) },
      { label: "Llegó tarde por", render: (r) => formatMinutes(r.lateMin) },
    ],
  });

  renderInsightCard(analysisResultsEl, {
    severity: "critical",
    title: "⚫ Fallidas",
    description: "Paradas marcadas como fallidas hoy, con el motivo que dejó el chofer.",
    rows: failedStops,
    emptyText: "Ninguna.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      { label: "Motivo", render: (r) => esc(r.checkout_comment || "(sin motivo)") },
    ],
  });
}

// ---------- Pestaña Vista 1 (árboles de cumplimiento) ----------

// Umbral que separa "un poco" de "mucho" fuera de ventana (tarde o temprano).
const V1_GAP_MIN = 30;
// Al llegar >30 min antes, se revisa si el camion siguio en el sitio al
// menos estos minutos despues de que abrio la ventana (check-out >= inicio + 20).
const V1_WAIT_AFTER_OPEN_MIN = 20;
// Minutos fijos de cada visita (estacionar, papeleo) que no se cargan a los
// bultos al calcular "minutos por bulto".
const V1_FIXED_VISIT_MIN = 20;
const V1_SIZE_BUCKETS = [
  { key: "q-0", label: "Hasta 50 pedidos", test: (q) => q <= 50 },
  { key: "q-50", label: "51 a 100 pedidos", test: (q) => q > 50 && q <= 100 },
  { key: "q-100", label: "101 a 150 pedidos", test: (q) => q > 100 && q <= 150 },
  { key: "q-150", label: "Más de 150 pedidos", test: (q) => q > 150 },
];

let vista1Selected = null;

// Clasifica cada parada una sola vez; los cuatro arboles se arman filtrando
// estas mismas filas, asi un numero nunca cuenta distinto entre arboles.
function classifyVista1Stop(stop, planDate, now) {
  const st = (stop.status || "pending").toLowerCase();
  const ws = parseLocalDateTime(planDate, stop.window_start);
  const we = parseLocalDateTime(planDate, stop.window_end);
  const checkin = stop.checkin_time ? new Date(stop.checkin_time) : null;
  const checkout = stop.checkout_time ? new Date(stop.checkout_time) : null;
  const row = {
    ...stop,
    pactado: toNumber(stop.load_2),
    retirado: pickedUpQty(stop),
    dwellMin: checkin && checkout ? (checkout - checkin) / 60000 : null,
    windowClass: null, // "cumplido" | "tarde" | "temprano" | "no_pasa" | "en_curso" | "sin_ventana"
    gapMin: null,
    waitedAfterOpen: null, // true | false | null (sin check-out aun)
  };

  if (!checkin) {
    // Pendiente con la ventana todavia abierta: aun puede cumplir, no se juzga.
    row.windowClass = st === "pending" && (!we || we > now) ? "en_curso" : "no_pasa";
    return row;
  }
  if (!ws || !we) {
    row.windowClass = "sin_ventana";
    return row;
  }
  if (checkin > we) {
    row.windowClass = "tarde";
    row.gapMin = (checkin - we) / 60000;
  } else if (checkin < ws) {
    row.windowClass = "temprano";
    row.gapMin = (ws - checkin) / 60000;
    if (checkout) row.waitedAfterOpen = (checkout - ws) / 60000 >= V1_WAIT_AFTER_OPEN_MIN;
  } else {
    row.windowClass = "cumplido";
  }
  return row;
}

function vista1Node(key, label, stops, children = [], hint = "") {
  return { key, label, stops, children, hint };
}

function vista1Metrics(stops) {
  // Retirado vs pactado solo sobre visitas ya cerradas: si el chofer sigue en
  // el seller (sin check-out) todavia no registro bultos y bajaria el %.
  const closed = stops.filter((s) => ["completed", "failed", "skipped"].includes((s.status || "").toLowerCase()));
  const pactado = closed.reduce((sum, s) => sum + s.pactado, 0);
  const retirado = closed.reduce((sum, s) => sum + s.retirado, 0);
  const withDwell = stops.filter((s) => s.dwellMin !== null);
  const avgDwell = withDwell.length ? withDwell.reduce((sum, s) => sum + s.dwellMin, 0) / withDwell.length : null;
  // Promedio ponderado: minutos de visita (sin los 20 fijos) / bultos retirados.
  const perPkgStops = withDwell.filter((s) => s.retirado > 0);
  const perPkgBultos = perPkgStops.reduce((sum, s) => sum + s.retirado, 0);
  const perPkg = perPkgBultos
    ? perPkgStops.reduce((sum, s) => sum + Math.max(s.dwellMin - V1_FIXED_VISIT_MIN, 0), 0) / perPkgBultos
    : null;
  return { count: stops.length, pactado, retirado, avgDwell, perPkg };
}

function buildVista1Trees(rows) {
  const by = (cls) => rows.filter((r) => r.windowClass === cls);
  const tarde = by("tarde");
  const temprano = by("temprano");
  const cumplido = by("cumplido");
  const noPasa = by("no_pasa");
  const tempranoMucho = temprano.filter((r) => r.gapMin > V1_GAP_MIN);
  const incumplidos = [...noPasa, ...tarde, ...temprano];
  const evaluadas = [...incumplidos, ...cumplido];

  const cumplimiento = vista1Node("c", "Visitas que ya debían pasar", evaluadas, [
    vista1Node("c-ok", "✅ Llegó a la hora", cumplido, [], "Check-in dentro de la ventana."),
    vista1Node("c-inc", "No llegó a la hora", incumplidos, [
      vista1Node("c-temp", "⏰ Llegó temprano", temprano, [
        vista1Node("c-temp-mucho", `Más de ${V1_GAP_MIN} min antes`, tempranoMucho, [
          vista1Node("c-temp-esp", `Esperó ${V1_WAIT_AFTER_OPEN_MIN} min de abierta la ventana`, tempranoMucho.filter((r) => r.waitedAfterOpen === true), [], `Su check-out fue al menos ${V1_WAIT_AFTER_OPEN_MIN} min después de que abrió la ventana.`),
          vista1Node("c-temp-noesp", "Se fue sin esperar", tempranoMucho.filter((r) => r.waitedAfterOpen === false), [], `Hizo check-out antes de cumplirse ${V1_WAIT_AFTER_OPEN_MIN} min de abierta la ventana.`),
          vista1Node("c-temp-sinco", "Todavía en el seller", tempranoMucho.filter((r) => r.waitedAfterOpen === null), [], "Hizo check-in pero aún no hace check-out."),
        ], "Check-in más de 30 min antes de que abriera la ventana."),
        vista1Node("c-temp-poco", `Menos de ${V1_GAP_MIN} min antes`, temprano.filter((r) => r.gapMin <= V1_GAP_MIN)),
      ], "Check-in antes de que abriera la ventana."),
      vista1Node("c-tarde", "🐢 Llegó tarde", tarde, [
        vista1Node("c-tarde-mucho", `Más de ${V1_GAP_MIN} min tarde`, tarde.filter((r) => r.gapMin > V1_GAP_MIN)),
        vista1Node("c-tarde-poco", `Menos de ${V1_GAP_MIN} min tarde`, tarde.filter((r) => r.gapMin <= V1_GAP_MIN)),
      ], "Check-in después de que cerró la ventana."),
      vista1Node("c-nopasa", "❌ No pasó", noPasa, [], "Se cerró la ventana y el camión nunca hizo check-in."),
    ]),
  ]);

  // Retiro 0: se prometio algo (Carga 2 > 0), la visita ya cerro y no se retiro nada.
  const retiroCero = rows.filter((r) => {
    const st = (r.status || "").toLowerCase();
    return r.pactado > 0 && r.retirado === 0 && (st === "completed" || st === "failed" || st === "skipped");
  });
  const retiroCeroTree = vista1Node("r0", "Visitas con pedidos donde no se retiró nada", retiroCero, [
    vista1Node("r0-ok", "✅ Había llegado a la hora", retiroCero.filter((r) => r.windowClass === "cumplido")),
    vista1Node("r0-inc", "No había llegado a la hora", retiroCero.filter((r) => r.windowClass !== "cumplido"), [], "Llegó temprano, tarde o no hizo check-in."),
  ]);

  const withDwell = rows.filter((r) => r.dwellMin !== null);
  const permanenciaTipo = vista1Node("pt", "Visitas terminadas", withDwell,
    V1_SIZE_BUCKETS.map((b) => vista1Node(`pt-${b.key}`, b.label, withDwell.filter((r) => b.test(r.pactado)))));

  const permanenciaCumpl = vista1Node("pc", "Visitas terminadas", withDwell, [
    vista1Node("pc-ok", "✅ Llegó a la hora", withDwell.filter((r) => r.windowClass === "cumplido")),
    vista1Node("pc-temp", "⏰ Llegó temprano", withDwell.filter((r) => r.windowClass === "temprano")),
    vista1Node("pc-tarde", "🐢 Llegó tarde", withDwell.filter((r) => r.windowClass === "tarde")),
  ]);

  return { cumplimiento, retiroCeroTree, permanenciaTipo, permanenciaCumpl, evaluadas, cumplido };
}

function vista1Pct(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : "-";
}

// Color de cada caja segun lo que significa (verde bien, amarillo temprano,
// rojo mal). Se deduce de la key del nodo para no repetirlo en cada vista1Node.
function vista1Tone(key) {
  if (/-ok$|-esp$/.test(key)) return "ok";
  if (/inc|tarde|nopasa|noesp|^r0$/.test(key)) return "bad";
  if (/temp/.test(key)) return "warn";
  return "neutral";
}

function renderVista1Tree(container, { title, description, root, showDwell }) {
  const card = document.createElement("div");
  card.className = "insight-card sev-info";
  card.innerHTML = `
    <div class="insight-header"><h3>${esc(title)}</h3></div>
    <p class="insight-desc">${esc(description)}</p>
  `;

  // Organigrama: cada caja es una rama; sus hijas cuelgan debajo con lineas.
  const buildBranch = (node, parentCount) => {
    const m = vista1Metrics(node.stops);
    const li = document.createElement("li");
    const box = document.createElement("div");
    box.className = `org-box tone-${vista1Tone(node.key)}${vista1Selected === node.key ? " selected" : ""}`;
    box.dataset.key = node.key;
    box.title = `${node.hint ? node.hint + " " : ""}Clic para ver la lista de sellers.`;
    const pctLine = parentCount === null ? "" : `<div class="org-pct">${vista1Pct(m.count, parentCount)} de la caja de arriba</div>`;
    const pickupLine = m.pactado
      ? `<div class="org-line">📦 Retiró ${formatQty(m.retirado)} de ${formatQty(m.pactado)} (${vista1Pct(m.retirado, m.pactado)})</div>`
      : "";
    const dwellLine = showDwell && m.avgDwell !== null
      ? `<div class="org-line">⏱ ${formatMinutes(m.avgDwell)} promedio en el seller</div>` +
        (m.perPkg !== null ? `<div class="org-line" title="Descontando ${V1_FIXED_VISIT_MIN} min fijos por visita">≈ ${Math.round(m.perPkg * 60)} s por bulto</div>` : "")
      : "";
    box.innerHTML = `
      <div class="org-title">${esc(node.label)}</div>
      <div class="org-count">${m.count}</div>
      ${pctLine}${pickupLine}${dwellLine}
    `;
    li.appendChild(box);
    if (node.children.length) {
      const ul = document.createElement("ul");
      node.children.forEach((child) => ul.appendChild(buildBranch(child, m.count)));
      li.appendChild(ul);
    }
    return li;
  };

  const chart = document.createElement("div");
  chart.className = "org";
  const rootUl = document.createElement("ul");
  rootUl.appendChild(buildBranch(root, null));
  chart.appendChild(rootUl);

  const nodesByKey = {};
  const index = (node) => {
    nodesByKey[node.key] = node;
    node.children.forEach(index);
  };
  index(root);

  chart.addEventListener("click", (e) => {
    const box = e.target.closest(".org-box");
    if (!box) return;
    vista1Selected = vista1Selected === box.dataset.key ? null : box.dataset.key;
    renderVista1();
  });

  const scroll = document.createElement("div");
  scroll.className = "org-scroll";
  scroll.appendChild(chart);
  card.appendChild(scroll);

  const selected = nodesByKey[vista1Selected];
  if (selected) card.appendChild(renderVista1Detail(selected));

  container.appendChild(card);
}

const V1_CLASS_LABELS = {
  cumplido: "Cumplido",
  tarde: "Tarde",
  temprano: "Temprano",
  no_pasa: "No pasa",
  en_curso: "En curso",
  sin_ventana: "Sin ventana",
};

function renderVista1Detail(node) {
  const wrap = document.createElement("div");
  wrap.className = "tree-detail";
  const title = document.createElement("div");
  title.className = "tree-detail-title";
  title.textContent = `Detalle: ${node.label} (${node.stops.length})`;
  wrap.appendChild(title);

  if (node.stops.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay paradas en esta rama.";
    wrap.appendChild(empty);
    return wrap;
  }

  const rows = [...node.stops].sort((a, b) => (b.gapMin ?? -1) - (a.gapMin ?? -1));
  const table = document.createElement("table");
  table.innerHTML = `
    <thead><tr>
      <th>Seller</th><th>Seller ID</th><th>Vehículo / Chofer</th><th>Estado</th><th>Ventana</th>
      <th>Check-in</th><th>Check-out</th><th>Cumplimiento</th><th>Permanencia</th><th>Pactado</th><th>Retirado</th>
    </tr></thead>
    <tbody>${rows
      .map((r) => {
        const gap = r.gapMin !== null ? ` (${formatMinutes(r.gapMin)})` : "";
        return `<tr>
          <td>${esc(r.seller_name || "(sin nombre)")}</td>
          <td>${sellerIdLabel(r)}</td>
          <td>${esc(r.vehicle_name || "-")}<br><span style="color:var(--muted);font-size:0.75rem">${esc(r.driver_name || "-")}</span></td>
          <td>${statusBadge(r.status)}</td>
          <td>${formatWindow(r)}</td>
          <td>${formatEta(r.checkin_time)}</td>
          <td>${formatEta(r.checkout_time)}</td>
          <td>${esc(V1_CLASS_LABELS[r.windowClass] || "-")}${gap}</td>
          <td>${r.dwellMin === null ? "-" : formatMinutes(r.dwellMin)}</td>
          <td>${formatQty(r.pactado)}</td>
          <td>${formatQty(r.retirado)}</td>
        </tr>`;
      })
      .join("")}</tbody>
  `;
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}

function renderVista1() {
  vista1ResultsEl.innerHTML = "";
  const data = getWorkingData();
  if (!data) return;

  const query = vista1SearchInput.value.trim().toLowerCase();
  let stops = flattenAllStops(data);
  if (query) stops = stops.filter((s) => (s.seller_name || "").toLowerCase().includes(query));

  const now = new Date();
  const rows = stops.map((s) => classifyVista1Stop(s, data.date, now));
  const trees = buildVista1Trees(rows);
  const enCurso = rows.filter((r) => r.windowClass === "en_curso").length;
  const sinVentana = rows.filter((r) => r.windowClass === "sin_ventana").length;
  const cumplPct = trees.evaluadas.length ? Math.round((trees.cumplido.length / trees.evaluadas.length) * 100) : null;

  const summary = document.createElement("div");
  summary.className = "summary-strip";
  const m = vista1Metrics(trees.evaluadas);
  summary.innerHTML = `
    <div class="summary-tile ${cumplPct !== null && cumplPct < 80 ? "sev-warning" : "sev-ok"}"><div class="value">${cumplPct === null ? "-" : cumplPct + "%"}</div><div class="label">Llegaron a la hora</div></div>
    <div class="summary-tile"><div class="value">${vista1Pct(m.retirado, m.pactado)}</div><div class="label">De lo prometido se retiró</div></div>
    <div class="summary-tile ${trees.retiroCeroTree.stops.length ? "sev-critical" : "sev-ok"}"><div class="value">${trees.retiroCeroTree.stops.length}</div><div class="label">Visitas sin retirar nada</div></div>
    <div class="summary-tile" title="Todavía tienen la ventana abierta: aún pueden llegar a la hora, por eso no se cuentan"><div class="value">${enCurso}</div><div class="label">Aún por visitar (no cuentan)</div></div>
  `;
  vista1ResultsEl.appendChild(summary);

  const tip = document.createElement("p");
  tip.className = "insight-desc";
  tip.textContent =
    "👆 Haz clic en cualquier caja para ver qué sellers están ahí." +
    (sinVentana ? ` (${sinVentana} visita(s) sin ventana cargada no se cuentan.)` : "");
  vista1ResultsEl.appendChild(tip);

  renderVista1Tree(vista1ResultsEl, {
    title: "1. ¿Llegamos a la hora?",
    description: "Compara la hora de check-in del chofer con la ventana acordada con el seller.",
    root: trees.cumplimiento,
    showDwell: false,
  });
  renderVista1Tree(vista1ResultsEl, {
    title: "2. ¿Dónde no retiramos nada?",
    description: "Visitas que tenían pedidos (Carga 2) y terminaron con 0 bultos retirados.",
    root: trees.retiroCeroTree,
    showDwell: false,
  });
  renderVista1Tree(vista1ResultsEl, {
    title: "3. ¿Cuánto demoramos según el tamaño del seller?",
    description: "Tiempo entre check-in y check-out, agrupado por cantidad de pedidos del seller.",
    root: trees.permanenciaTipo,
    showDwell: true,
  });
  renderVista1Tree(vista1ResultsEl, {
    title: "4. ¿Cuánto demoramos según si llegamos a la hora?",
    description: "Mismo tiempo en el seller, separado por llegada a la hora, temprano o tarde.",
    root: trees.permanenciaCumpl,
    showDwell: true,
  });
}

// ---------- Pestaña Avance (cantidades del dia y atrasos) ----------

function renderAvance() {
  avanceResultsEl.innerHTML = "";
  const data = getWorkingData();
  if (!data) return;

  const query = avanceSearchInput.value.trim().toLowerCase();
  // Las Descarga (vuelta al CD) no son retiros: aca se sacan siempre, este
  // prendido o no el filtro global, para no inflar atrasos ni bultos.
  let stops = flattenAllStops(data).filter((s) => !isDescargaStop(s));
  if (query) stops = stops.filter((s) => (s.seller_name || "").toLowerCase().includes(query));

  const now = new Date();
  const rows = stops.map((s) => {
    const st = (s.status || "pending").toLowerCase();
    const we = parseLocalDateTime(data.date, s.window_end);
    const eta = s.current_eta ? new Date(s.current_eta) : null;
    const isPending = st === "pending";
    return {
      ...s,
      st,
      pactado: toNumber(s.load_2),
      retirado: pickedUpQty(s),
      isPending,
      isClosedBad: st === "failed" || st === "skipped",
      // Atrasada = sigue pendiente y la ventana ya cerro; en riesgo = todavia
      // en ventana pero el ETA en vivo cae despues del cierre.
      overdue: isPending && we && we < now,
      atRisk: isPending && we && we >= now && eta && !Number.isNaN(eta.getTime()) && eta > we,
      overdueMin: isPending && we && we < now ? (now - we) / 60000 : null,
    };
  });

  const sum = (list, field) => list.reduce((acc, r) => acc + r[field], 0);
  const completed = rows.filter((r) => r.st === "completed");
  const bad = rows.filter((r) => r.isClosedBad);
  const pending = rows.filter((r) => r.isPending);
  const overdue = pending.filter((r) => r.overdue);
  const atRisk = pending.filter((r) => r.atRisk);

  const totalPactado = sum(rows, "pactado");
  const retirado = sum(rows, "retirado");
  const pendientePactado = sum(pending, "pactado");
  const perdidoFallidas = sum(bad, "pactado") - sum(bad, "retirado");
  // Retiros en visitas sin pedido cargado (Carga 2 vacia): son reales, pero no
  // sirven para medir el ritmo contra lo pactado.
  const extraRetirado = rows.filter((r) => r.pactado <= 0).reduce((acc, r) => acc + r.retirado, 0);
  const closedWithOrders = [...completed, ...bad].filter((r) => r.pactado > 0);
  const closedPactado = sum(closedWithOrders, "pactado");
  const closedRetirado = sum(closedWithOrders, "retirado");
  // Ritmo real del dia: de lo pactado en visitas ya cerradas, cuanto se retiro.
  const rate = closedPactado ? closedRetirado / closedPactado : null;
  const projectedFinal = rate === null ? null : Math.round(retirado + pendientePactado * rate);

  const pct = (part) => (totalPactado ? Math.max(0, Math.min(100, (part / totalPactado) * 100)) : 0);
  const pctText = (part, total) => (total ? `${Math.round((part / total) * 100)}%` : "-");

  // Barra principal: retirado (verde) + perdido en fallidas (rojo) + pendiente (gris).
  const progress = document.createElement("div");
  progress.className = "progress-section";
  progress.innerHTML = `
    <div class="progress-header">
      <span class="title">Avance de bultos del día</span>
      <span class="value"><strong>${formatQty(retirado)}</strong> retirados de ${formatQty(totalPactado)} pactados (${pctText(retirado, totalPactado)})</span>
    </div>
    <div class="progress-bar">
      <div class="progress-segment completed" style="width:${pct(retirado)}%"></div>
      <div class="progress-segment failed" style="width:${pct(Math.max(perdidoFallidas, 0))}%"></div>
    </div>
    <div class="progress-legend">
      <span class="lg-completed">${formatQty(retirado)} retirados</span>
      <span class="lg-failed">${formatQty(Math.max(perdidoFallidas, 0))} perdidos en fallidas/salteadas</span>
      <span class="lg-pending">${formatQty(pendientePactado)} por retirar</span>
    </div>
  `;
  avanceResultsEl.appendChild(progress);

  const tiles = document.createElement("div");
  tiles.className = "summary-strip";
  tiles.innerHTML = `
    <div class="summary-tile"><div class="value">${formatQty(totalPactado)}</div><div class="label">Bultos pactados (Carga 2)</div></div>
    <div class="summary-tile sev-ok" title="Incluye ${formatQty(extraRetirado)} bultos de visitas sin pedido cargado. No incluye paradas Descarga (CD)."><div class="value">${formatQty(retirado)}</div><div class="label">Retirados${extraRetirado ? ` (${formatQty(extraRetirado)} sin pedido cargado)` : ""}</div></div>
    <div class="summary-tile"><div class="value">${formatQty(pendientePactado)}</div><div class="label">Por retirar (${pending.length} visitas)</div></div>
    <div class="summary-tile ${bad.length ? "sev-critical" : "sev-ok"}"><div class="value">${bad.length}</div><div class="label">Visitas fallidas/salteadas</div></div>
    <div class="summary-tile ${overdue.length ? "sev-critical" : "sev-ok"}"><div class="value">${overdue.length}</div><div class="label">Atrasadas (${formatQty(sum(overdue, "pactado"))} bultos)</div></div>
    <div class="summary-tile ${atRisk.length ? "sev-warning" : "sev-ok"}"><div class="value">${atRisk.length}</div><div class="label">En riesgo de atraso (${formatQty(sum(atRisk, "pactado"))} bultos)</div></div>
  `;
  avanceResultsEl.appendChild(tiles);

  // Proyeccion simple: lo que falta se retira al mismo ritmo que lo ya cerrado.
  const projection = document.createElement("div");
  projection.className = "insight-card sev-info";
  projection.innerHTML =
    projectedFinal === null
      ? `<div class="insight-header"><h3>🔮 Proyección de cierre del día</h3></div><p class="insight-desc">Todavía no hay visitas cerradas para calcular el ritmo.</p>`
      : `<div class="insight-header"><h3>🔮 Proyección de cierre del día</h3></div>
         <p class="insight-desc">Si lo que falta se retira al mismo ritmo que lo ya cerrado hoy (${Math.round(rate * 100)}% de lo pactado), el día cerraría con
         <strong>${formatQty(projectedFinal)}</strong> bultos retirados de ${formatQty(totalPactado)} (${pctText(projectedFinal, totalPactado)}),
         es decir, quedarían <strong>${formatQty(Math.max(totalPactado - projectedFinal, 0))}</strong> bultos sin retirar.
         Ya hay ${overdue.length} visita(s) atrasada(s) con ${formatQty(sum(overdue, "pactado"))} bultos y ${atRisk.length} más en riesgo según el ETA en vivo.</p>`;
  avanceResultsEl.appendChild(projection);

  // Avance por hora de inicio de ventana: muestra donde se esta acumulando el atraso.
  const byHour = new Map();
  for (const r of rows) {
    const hour = r.window_start ? r.window_start.slice(0, 2) + ":00" : "Sin ventana";
    if (!byHour.has(hour)) byHour.set(hour, []);
    byHour.get(hour).push(r);
  }
  const hourRows = [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b));
  const hourCard = document.createElement("div");
  hourCard.className = "insight-card sev-info";
  hourCard.innerHTML = `
    <div class="insight-header"><h3>🕒 Avance por hora de ventana</h3></div>
    <p class="insight-desc">Visitas agrupadas por la hora en que abre su ventana. "Atrasadas" = siguen pendientes y su ventana ya cerró.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Ventana desde</th><th>Visitas</th><th>Hechas</th><th>Fallidas</th><th>Pendientes</th><th>Atrasadas</th><th>Pactado</th><th>Retirado</th><th>Por retirar</th><th>Avance</th></tr></thead>
      <tbody>${hourRows
        .map(([hour, list]) => {
          const p = sum(list, "pactado");
          const ret = sum(list, "retirado");
          const pend = list.filter((r) => r.isPending);
          const late = pend.filter((r) => r.overdue).length;
          return `<tr${late ? ' class="row-late"' : ""}>
            <td>${esc(hour)}</td>
            <td>${list.length}</td>
            <td>${list.filter((r) => r.st === "completed").length}</td>
            <td>${list.filter((r) => r.isClosedBad).length || "-"}</td>
            <td>${pend.length || "-"}</td>
            <td>${late ? `<strong class="dif-neg">${late}</strong>` : "-"}</td>
            <td>${formatQty(p)}</td>
            <td>${formatQty(ret)}</td>
            <td>${formatQty(sum(pend, "pactado")) }</td>
            <td>${pctText(ret, p)}</td>
          </tr>`;
        })
        .join("")}</tbody>
    </table></div>
  `;
  avanceResultsEl.appendChild(hourCard);

  const vehicleCol = { label: "Vehículo / Chofer", render: (r) => `${esc(r.vehicle_name || "-")}<br><span style="color:var(--muted);font-size:0.75rem">${esc(r.driver_name || "-")}</span>` };
  const sellerCol = { label: "Seller", render: (r) => esc(r.seller_name || "(sin nombre)") };
  const sellerIdCol = { label: "Seller ID", render: (r) => sellerIdLabel(r) };
  const windowCol = { label: "Ventana", render: (r) => formatWindow(r) };
  const pactadoCol = { label: "Bultos pactados", render: (r) => formatQty(r.pactado) };
  const byPactado = (a, b) => b.pactado - a.pactado;

  renderInsightCard(avanceResultsEl, {
    severity: "critical",
    title: "🔴 Atrasadas: ventana cerrada y siguen pendientes",
    description: "Ordenadas por bultos pactados: arriba lo que más pesa en el atraso del día.",
    rows: [...overdue].sort(byPactado),
    emptyText: "Ninguna, por ahora.",
    columns: [sellerCol, sellerIdCol, vehicleCol, windowCol, { label: "Atrasada hace", render: (r) => formatMinutes(r.overdueMin) }, { label: "Camión", render: (r) => (r.on_its_way ? "En camino" : "Sin camión en camino") }, pactadoCol],
  });

  renderInsightCard(avanceResultsEl, {
    severity: "warning",
    title: "🟠 En riesgo: el ETA en vivo cae después de la ventana",
    description: "Todavía están dentro de la ventana, pero según SimpliRoute el camión va a llegar tarde.",
    rows: [...atRisk].sort(byPactado),
    emptyText: "Ninguna, por ahora.",
    columns: [sellerCol, sellerIdCol, vehicleCol, windowCol, { label: "ETA en vivo", render: (r) => formatEta(r.current_eta) }, pactadoCol],
  });

  renderInsightCard(avanceResultsEl, {
    severity: "critical",
    title: "⚫ Nos fallaron: visitas fallidas o salteadas",
    description: "Con el motivo que dejó el chofer y lo que se dejó de retirar.",
    rows: [...bad].sort(byPactado),
    emptyText: "Ninguna.",
    columns: [
      sellerCol,
      sellerIdCol,
      vehicleCol,
      { label: "Motivo", render: (r) => esc(r.motivo_fallido || r.checkout_comment || "(sin motivo)") },
      pactadoCol,
      { label: "No retirado", render: (r) => formatQty(Math.max(r.pactado - r.retirado, 0)) },
    ],
  });
}

// ---------- Pestaña % Cumplimiento (retirado real vs pactado, por seller) ----------

let cumplMaxPct = "all";
let cumplSortMode = "pct-asc";

// Agrupa por seller las visitas ya cerradas que tenian pedidos (Carga 2 > 0).
// Las pendientes no entran: todavia no se sabe cuanto se va a retirar.
function getCumplimientoRows() {
  const data = getWorkingData();
  if (!data) return [];
  const query = cumplSearchInput.value.trim().toLowerCase();

  const bySeller = new Map();
  for (const s of flattenAllStops(data)) {
    const st = (s.status || "").toLowerCase();
    if (!["completed", "failed", "skipped"].includes(st)) continue;
    const pactado = toNumber(s.load_2);
    if (pactado <= 0) continue;
    const name = s.seller_name || "(sin nombre)";
    if (query && !name.toLowerCase().includes(query)) continue;
    if (!bySeller.has(name)) {
      bySeller.set(name, { seller_name: name, seller_id: s.seller_id, seller_id_exact: s.seller_id_exact, visits: 0, failed: 0, pactado: 0, retirado: 0, vehicles: new Set() });
    }
    const row = bySeller.get(name);
    row.visits += 1;
    if (st !== "completed") row.failed += 1;
    row.pactado += pactado;
    row.retirado += pickedUpQty(s);
    if (s.vehicle_name) row.vehicles.add(s.vehicle_name);
  }

  let rows = [...bySeller.values()].map((r) => ({
    ...r,
    vehicles: [...r.vehicles].join(", "),
    pct: (r.retirado / r.pactado) * 100,
    missing: Math.max(r.pactado - r.retirado, 0),
  }));
  if (cumplMaxPct !== "all") {
    const max = Number(cumplMaxPct);
    rows = rows.filter((r) => (max === 0 ? r.retirado === 0 : r.pct < max));
  }
  if (cumplSortMode === "missing-desc") {
    rows.sort((a, b) => b.missing - a.missing || a.pct - b.pct);
  } else {
    rows.sort((a, b) => a.pct - b.pct || b.pactado - a.pactado);
  }
  return rows;
}

function cumplTone(pct) {
  if (pct < 50) return "bad";
  if (pct < 80) return "warn";
  return "ok";
}

function renderCumplimiento() {
  cumplResultsEl.innerHTML = "";
  if (!getWorkingData()) return;
  const rows = getCumplimientoRows();

  const pactado = rows.reduce((sum, r) => sum + r.pactado, 0);
  const retirado = rows.reduce((sum, r) => sum + r.retirado, 0);
  const globalPct = pactado ? Math.round((retirado / pactado) * 100) : null;
  const critical = rows.filter((r) => r.pct < 80).length;
  const missing = rows.reduce((sum, r) => sum + r.missing, 0);

  const summary = document.createElement("div");
  summary.className = "summary-strip";
  summary.innerHTML = `
    <div class="summary-tile ${globalPct !== null && globalPct < 80 ? "sev-warning" : "sev-ok"}"><div class="value">${globalPct === null ? "-" : globalPct + "%"}</div><div class="label">Cumplimiento (retirado ÷ pactado)</div></div>
    <div class="summary-tile"><div class="value">${rows.length}</div><div class="label">Sellers en la lista</div></div>
    <div class="summary-tile ${critical ? "sev-critical" : "sev-ok"}"><div class="value">${critical}</div><div class="label">Sellers bajo 80%</div></div>
    <div class="summary-tile ${missing ? "sev-warning" : "sev-ok"}"><div class="value">${formatQty(missing)}</div><div class="label">Bultos que faltaron</div></div>
  `;
  cumplResultsEl.appendChild(summary);

  const note = document.createElement("p");
  note.className = "insight-desc";
  note.textContent =
    "Solo visitas terminadas (completadas, fallidas o salteadas) que tenían pedidos. % = bultos retirados ÷ pedidos pactados (Carga 2), sumando todas las visitas del día de cada seller.";
  cumplResultsEl.appendChild(note);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No hay sellers que cumplan con el filtro.";
    cumplResultsEl.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead><tr>
      <th>#</th><th>Seller</th><th>Seller ID</th><th>Vehículo(s)</th><th>Visitas</th>
      <th>Pactado</th><th>Retirado</th><th>Faltó</th><th>% cumplimiento</th>
    </tr></thead>
    <tbody>${rows
      .map((r, i) => {
        const tone = cumplTone(r.pct);
        const barWidth = Math.min(r.pct, 100);
        const failedNote = r.failed ? `<div class="note">${r.failed} visita(s) fallida(s)/salteada(s)</div>` : "";
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(r.seller_name)}${failedNote}</td>
          <td>${sellerIdLabel(r)}</td>
          <td>${esc(r.vehicles || "-")}</td>
          <td>${r.visits}</td>
          <td>${formatQty(r.pactado)}</td>
          <td>${formatQty(r.retirado)}</td>
          <td>${r.missing ? formatQty(r.missing) : "-"}</td>
          <td><div class="cumpl-cell">
            <div class="cumpl-bar"><div class="cumpl-fill tone-${tone}" style="width:${barWidth}%"></div></div>
            <span class="cumpl-pct tone-${tone}">${Math.round(r.pct)}%</span>
          </div></td>
        </tr>`;
      })
      .join("")}</tbody>
  `;
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.appendChild(table);
  cumplResultsEl.appendChild(scroll);
}

function downloadCumplimientoCsv() {
  const rows = getCumplimientoRows();
  if (rows.length === 0) return;
  const columns = [
    ["Seller", (r) => r.seller_name],
    ["Seller ID", (r) => sellerIdLabelPlain(r)],
    ["Vehículo(s)", (r) => r.vehicles],
    ["Visitas", (r) => r.visits],
    ["Visitas fallidas/salteadas", (r) => r.failed],
    ["Pactado (Carga 2)", (r) => r.pactado],
    ["Retirado", (r) => r.retirado],
    ["Faltó", (r) => r.missing],
    ["% cumplimiento", (r) => Math.round(r.pct)],
  ];
  const lines = [columns.map(([h]) => csvEscape(h)).join(",")];
  for (const row of rows) lines.push(columns.map(([, get]) => csvEscape(get(row))).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simpliroute_cumplimiento_${lastData.date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Pestaña Duración de visitas ----------

function renderDurations() {
  durationResultsEl.innerHTML = "";
  const data = getWorkingData();
  if (!data) return;

  const query = durationSearchInput.value.trim().toLowerCase();
  // Incluye tambien las fallidas: si el chofer hizo check-in y check-out,
  // estuvo ese tiempo en el sitio aunque el retiro no haya salido bien - ese
  // tiempo "perdido" es justamente lo que queremos poder ver aca.
  let stops = flattenAllStops(data).filter((s) => {
    const st = (s.status || "").toLowerCase();
    return (st === "completed" || st === "failed") && s.checkin_time && s.checkout_time;
  });
  if (query) {
    stops = stops.filter((s) => (s.seller_name || "").toLowerCase().includes(query));
  }

  stops = stops.map((s) => ({
    ...s,
    checkinDate: new Date(s.checkin_time),
    checkoutDate: new Date(s.checkout_time),
  }));
  stops = stops.map((s) => ({ ...s, durationMin: (s.checkoutDate - s.checkinDate) / 60000 }));

  if (durationSortMode === "duration-asc") {
    stops.sort((a, b) => a.durationMin - b.durationMin);
  } else if (durationSortMode === "checkout-desc") {
    stops.sort((a, b) => b.checkoutDate - a.checkoutDate);
  } else {
    stops.sort((a, b) => b.durationMin - a.durationMin);
  }

  const durations = stops.map((s) => s.durationMin);
  const avgMin = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const failedCount = stops.filter((s) => (s.status || "").toLowerCase() === "failed").length;

  const summary = document.createElement("div");
  summary.className = "summary-strip";
  summary.innerHTML = `
    <div class="summary-tile"><div class="value">${stops.length}</div><div class="label">Visitas con horario registrado</div></div>
    <div class="summary-tile ${failedCount ? "sev-warning" : "sev-ok"}"><div class="value">${failedCount}</div><div class="label">De esas, terminaron fallidas</div></div>
    <div class="summary-tile"><div class="value">${avgMin === null ? "-" : formatMinutes(avgMin)}</div><div class="label">Duración promedio</div></div>
    <div class="summary-tile"><div class="value">${durations.length ? formatMinutes(Math.max(...durations)) : "-"}</div><div class="label">Más lenta</div></div>
  `;
  durationResultsEl.appendChild(summary);

  if (stops.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = query
      ? "Ningún seller coincide con la búsqueda."
      : "Todavía no hay visitas (completadas o fallidas) con check-in y check-out registrados.";
    durationResultsEl.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Seller</th>
        <th>Seller ID</th>
        <th>Vehículo / Chofer</th>
        <th>Estado</th>
        <th>Ventana</th>
        <th>Llegó</th>
        <th>Salida</th>
        <th>Duración en sitio</th>
        <th>Carga planificada</th>
        <th>Bultos retirados</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  const longThreshold = avgMin !== null ? avgMin * 1.5 : Infinity;

  stops.forEach((s) => {
    const tr = document.createElement("tr");
    if (s.durationMin > longThreshold) tr.classList.add("current-stop");
    const statusKey = (s.status || "").toLowerCase();
    const reasonNote = statusKey === "failed" && (s.motivo_fallido || s.checkout_comment)
      ? `<div class="note">${esc(s.motivo_fallido || s.checkout_comment)}</div>`
      : "";
    tr.innerHTML = `
      <td>${esc(s.seller_name || "(sin nombre)")}</td>
      <td>${sellerIdLabel(s)}</td>
      <td>${esc(s.vehicle_name || "-")}<br><span style="color:var(--muted);font-size:0.75rem">${esc(s.driver_name || "-")}</span></td>
      <td>${statusBadge(s.status)}${reasonNote}</td>
      <td>${formatWindow(s)}</td>
      <td>${formatEta(s.checkin_time)}</td>
      <td>${formatEta(s.checkout_time)}</td>
      <td>${formatMinutes(s.durationMin)}${s.durationMin > longThreshold ? " ⚠️" : ""}</td>
      <td>${formatLoad(s)}</td>
      <td>${esc(s.bultos_retirados ?? "-")}</td>
    `;
    tbody.appendChild(tr);
  });

  durationResultsEl.appendChild(table);
}

// ---------- Pestaña Sábana (CSV) ----------

function formatDateTimeFull(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const SABANA_COLUMNS = [
  { header: "Fecha", get: (r) => r.planned_date || "" },
  { header: "Seller", get: (r) => r.seller_name || "" },
  { header: "Seller ID", get: (r) => sellerIdLabelPlain(r) },
  { header: "Estado", get: (r) => STATUS_LABELS[(r.status || "").toLowerCase()] || r.status || "" },
  { header: "Vehículo", get: (r) => r.vehicle_name || "" },
  { header: "Chofer", get: (r) => r.driver_name || "" },
  { header: "Orden en ruta", get: (r) => r.order ?? "" },
  { header: "Dirección", get: (r) => r.address || "" },
  { header: "Latitud", get: (r) => r.latitude || "" },
  { header: "Longitud", get: (r) => r.longitude || "" },
  { header: "Ventana inicio", get: (r) => (r.window_start || "").slice(0, 5) },
  { header: "Ventana fin", get: (r) => (r.window_end || "").slice(0, 5) },
  { header: "ETA planificado", get: (r) => (r.estimated_time_arrival || "").slice(0, 5) },
  { header: "ETA en vivo", get: (r) => formatDateTimeFull(r.current_eta) },
  { header: "Camión en camino", get: (r) => (r.on_its_way ? "Sí" : "No") },
  { header: "Llegó (check-in)", get: (r) => formatDateTimeFull(r.checkin_time) },
  { header: "Retirado (check-out)", get: (r) => formatDateTimeFull(r.checkout_time) },
  {
    header: "Duración en sitio (min)",
    get: (r) => (r.checkin_time && r.checkout_time ? Math.round((new Date(r.checkout_time) - new Date(r.checkin_time)) / 60000) : ""),
  },
  { header: "Motivo fallo (categoría)", get: (r) => r.motivo_fallido || "" },
  { header: "Motivo fallo (comentario)", get: (r) => r.checkout_comment || "" },
  { header: "Carga", get: (r) => r.load ?? "" },
  { header: "Carga 2", get: (r) => r.load_2 ?? "" },
  { header: "Carga 3", get: (r) => r.load_3 ?? "" },
  { header: "Bultos retirados (real)", get: (r) => r.bultos_retirados ?? "" },
];

function getSabanaRows() {
  const data = getWorkingData();
  if (!data) return [];
  const query = sabanaSearchInput.value.trim().toLowerCase();
  let rows = flattenAllStops(data).map((r) => ({ ...r, planned_date: data.date }));
  if (query) {
    rows = rows.filter((r) => (r.seller_name || "").toLowerCase().includes(query));
  }
  return rows;
}

function renderSabana() {
  sabanaResultsEl.innerHTML = "";
  const rows = getSabanaRows();
  sabanaCountEl.textContent = lastData ? `${rows.length} fila(s).` : "";

  if (rows.length === 0) {
    sabanaResultsEl.innerHTML = `<div class="empty">${
      lastData ? "Ningún seller coincide con la búsqueda." : "Apretá \"Actualizar\" para traer datos."
    }</div>`;
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead><tr>${SABANA_COLUMNS.map((c) => `<th>${c.header}</th>`).join("")}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr>${SABANA_COLUMNS.map((c) => `<td>${esc(c.get(r))}</td>`).join("")}</tr>`)
      .join("")}</tbody>
  `;
  sabanaResultsEl.appendChild(table);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv() {
  const rows = getSabanaRows();
  if (rows.length === 0) return;

  const lines = [SABANA_COLUMNS.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(SABANA_COLUMNS.map((c) => csvEscape(c.get(row))).join(","));
  }
  const csvContent = "﻿" + lines.join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simpliroute_rutas_${lastData.date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------- Pestaña Fallidos ----------

function reasonLabel(stop) {
  return stop.motivo_fallido || "(sin motivo categorizado)";
}

// Rampa secuencial (un solo hue, magnitud = luminosidad) del paquete de
// dataviz, pasos 100->550. Sobre fondo oscuro el ancla se invierte: el motivo
// con mas casos usa el paso mas claro (maxima visibilidad), y va oscureciendo
// a medida que baja el conteo - la barra mas chica ademas es la mas tenue.
const SEQUENTIAL_BLUE_RAMP = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
];

function sequentialFillFor(rankIndex, totalCount) {
  if (totalCount <= 1) return SEQUENTIAL_BLUE_RAMP[0];
  const t = rankIndex / (totalCount - 1);
  const idx = Math.round(t * (SEQUENTIAL_BLUE_RAMP.length - 1));
  return SEQUENTIAL_BLUE_RAMP[idx];
}

// Fallidas que matchean el buscador (sin aplicar todavia el filtro de
// motivo seleccionado) - se usa para armar el ranking de motivos, que
// siempre debe mostrar todos los motivos disponibles para poder clickearlos.
function getFailedStopsForQuery() {
  const data = getWorkingData();
  if (!data) return [];
  const query = failedSearchInput.value.trim().toLowerCase();
  let stops = flattenAllStops(data).filter((s) => (s.status || "").toLowerCase() === "failed");
  if (query) {
    stops = stops.filter((s) => (s.seller_name || "").toLowerCase().includes(query));
  }
  return stops;
}

// Las que realmente se ven en la tabla / se exportan a CSV: ademas del
// buscador, aplica el motivo seleccionado (si hay uno clickeado).
function getFailedRows() {
  const stops = getFailedStopsForQuery();
  return selectedFailReason ? stops.filter((s) => reasonLabel(s) === selectedFailReason) : stops;
}

function renderFailed() {
  failedGroupsEl.innerHTML = "";
  failedResultsEl.innerHTML = "";

  const data = getWorkingData();
  if (!data) return;

  const query = failedSearchInput.value.trim().toLowerCase();
  const failedStops = getFailedStopsForQuery();

  if (failedStops.length === 0) {
    failedResultsEl.innerHTML = `<div class="empty">${
      query ? "Ningún seller fallido coincide con la búsqueda." : "No hay paradas fallidas para esta fecha. 🎉"
    }</div>`;
    return;
  }

  // Agrupa por el motivo categorizado (dropdown que deja el chofer). Sirve
  // para ver rapido cuales son los motivos que mas se repiten.
  const counts = new Map();
  for (const s of failedStops) {
    const key = reasonLabel(s);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sortedReasons = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sortedReasons.length ? sortedReasons[0][1] : 1;

  if (selectedFailReason && !counts.has(selectedFailReason)) {
    selectedFailReason = null;
  }

  const groupCard = document.createElement("div");
  groupCard.className = "reason-list";
  const header = document.createElement("h3");
  header.textContent = `Motivos más comunes (${failedStops.length} fallidas)`;
  groupCard.appendChild(header);

  sortedReasons.forEach(([reason, count], rankIndex) => {
    const row = document.createElement("div");
    row.className = "reason-row" + (selectedFailReason === reason ? " selected" : "");
    row.dataset.reason = reason;
    const pct = Math.round((count / maxCount) * 100);
    const fillColor = sequentialFillFor(rankIndex, sortedReasons.length);
    row.innerHTML = `
      <span class="reason-name" title="${esc(reason)}">${esc(reason)}</span>
      <span class="reason-bar-track"><span class="reason-bar-fill" style="width:${pct}%;background:${fillColor}"></span></span>
      <span class="reason-count">${count}</span>
    `;
    row.addEventListener("click", () => {
      selectedFailReason = selectedFailReason === reason ? null : reason;
      renderFailed();
    });
    groupCard.appendChild(row);
  });

  if (selectedFailReason) {
    const clear = document.createElement("span");
    clear.className = "reason-clear";
    clear.textContent = "✕ Quitar filtro de motivo";
    clear.addEventListener("click", () => {
      selectedFailReason = null;
      renderFailed();
    });
    groupCard.appendChild(clear);
  }

  failedGroupsEl.appendChild(groupCard);

  const visibleStops = getFailedRows();

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Seller</th>
        <th>Seller ID</th>
        <th>Vehículo / Chofer</th>
        <th>Ventana</th>
        <th>Marcada fallida</th>
        <th>Motivo</th>
        <th>Comentario del chofer</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  visibleStops.forEach((s) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(s.seller_name || "(sin nombre)")}</td>
      <td>${sellerIdLabel(s)}</td>
      <td>${esc(s.vehicle_name || "-")}<br><span style="color:var(--muted);font-size:0.75rem">${esc(s.driver_name || "-")}</span></td>
      <td>${formatWindow(s)}</td>
      <td>${formatEta(s.checkout_time)}</td>
      <td>${esc(reasonLabel(s))}</td>
      <td>${esc(s.checkout_comment || "-")}</td>
    `;
    tbody.appendChild(tr);
  });

  failedResultsEl.appendChild(table);
}

const FAILED_COLUMNS = [
  { header: "Fecha", get: (r) => lastData?.date || "" },
  { header: "Seller", get: (r) => r.seller_name || "" },
  { header: "Seller ID", get: (r) => sellerIdLabelPlain(r) },
  { header: "Vehículo", get: (r) => r.vehicle_name || "" },
  { header: "Chofer", get: (r) => r.driver_name || "" },
  { header: "Dirección", get: (r) => r.address || "" },
  { header: "Ventana inicio", get: (r) => (r.window_start || "").slice(0, 5) },
  { header: "Ventana fin", get: (r) => (r.window_end || "").slice(0, 5) },
  { header: "Marcada fallida (check-out)", get: (r) => formatDateTimeFull(r.checkout_time) },
  { header: "Motivo (categoría)", get: (r) => reasonLabel(r) },
  { header: "Comentario del chofer", get: (r) => r.checkout_comment || "" },
];

function downloadFailedCsv() {
  const rows = getFailedRows();
  if (rows.length === 0) return;

  const lines = [FAILED_COLUMNS.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(FAILED_COLUMNS.map((c) => csvEscape(c.get(row))).join(","));
  }
  const csvContent = "﻿" + lines.join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simpliroute_fallidos_${lastData.date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function switchTab(tabName) {
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
    btn.setAttribute("aria-selected", btn.dataset.tab === tabName ? "true" : "false");
  }
  for (const [name, panel] of Object.entries(tabPanels)) {
    panel.hidden = name !== tabName;
  }
  if (tabName === "avance") renderAvance();
  if (tabName === "vista1") renderVista1();
  if (tabName === "cumplimiento") renderCumplimiento();
  if (tabName === "analisis") renderAnalysis();
  if (tabName === "duracion") renderDurations();
  if (tabName === "sabana") renderSabana();
  if (tabName === "fallidos") renderFailed();
  if (tabName === "usuarios") loadViewers();
}

function renderAllTabs() {
  const data = getWorkingData();
  if (data) populateSellerDatalist(data);
  render();
  renderAvance();
  renderVista1();
  renderCumplimiento();
  renderAnalysis();
  renderDurations();
  renderSabana();
  renderFailed();
}

async function loadData() {
  const targetDate = dateInput.value;
  refreshBtn.disabled = true;
  statusLine.textContent = "Consultando SimpliRoute...";

  try {
    const resp = await fetch(`/api/route-status?date=${encodeURIComponent(targetDate)}`);
    const data = await resp.json();

    if (!resp.ok) {
      statusLine.textContent = `Error: ${data.error || resp.status}`;
      return;
    }

    lastData = data;
    statusLine.textContent = `Actualizado ${new Date().toLocaleTimeString()} — ${data.vehicles?.length || 0} vehículo(s).`;
    if (publishBtn) publishBtn.disabled = false;
    renderAllTabs();
  } catch (err) {
    statusLine.textContent = `No se pudo conectar al servidor local: ${err.message}`;
  } finally {
    refreshBtn.disabled = false;
  }
}

// ---------- Solo owner: llamadas a los endpoints locales protegidos ----------

// El header X-SR-Owner hace que cualquier pedido desde otra pagina (otro
// origen) requiera un preflight CORS que server.py nunca aprueba.
async function ownerFetch(path, { method = "GET", body } = {}) {
  const resp = await fetch(path, {
    method,
    headers: { "X-SR-Owner": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Error ${resp.status}`);
  return data;
}

async function publishSnapshot() {
  publishBtn.disabled = true;
  statusLine.textContent = "Publicando para el equipo (cifrando y subiendo a GitHub)...";
  try {
    const result = await ownerFetch("/api/publish", { method: "POST" });
    const when = new Date(result.published_at).toLocaleTimeString();
    statusLine.textContent = `Publicado a las ${when} para ${result.users} usuario(s). Link: ${result.url} (puede tardar unos minutos en verse).`;
    if (tabPanels.usuarios && !tabPanels.usuarios.hidden) loadViewers();
  } catch (err) {
    statusLine.textContent = `No se pudo publicar: ${err.message}`;
  } finally {
    publishBtn.disabled = !lastData;
  }
}

// ---------- Pestaña Usuarios (solo owner) ----------

const viewerForm = document.getElementById("viewer-form");
const viewerUsernameInput = document.getElementById("viewer-username");
const viewerPasswordInput = document.getElementById("viewer-password");
const viewerPasswordConfirmInput = document.getElementById("viewer-password-confirm");
const viewerGenerateBtn = document.getElementById("viewer-generate");
const viewerFormMsg = document.getElementById("viewer-form-msg");
const viewerListEl = document.getElementById("viewer-list");
const viewerPendingEl = document.getElementById("viewer-pending");
const viewerSiteEl = document.getElementById("viewer-site");

// Sin caracteres que se confunden al dictarlos/copiarlos (0/O, 1/l/I).
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*-_";

function generatePassword(length = 16) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

function setPasswordVisibility(visible) {
  const type = visible ? "text" : "password";
  viewerPasswordInput.type = type;
  viewerPasswordConfirmInput.type = type;
}

function renderViewerList(state) {
  viewerListEl.innerHTML = "";
  viewerPendingEl.hidden = !state.pending_changes;
  viewerSiteEl.textContent = state.site_url
    ? `Link para compartir: ${state.site_url}${state.last_published_at ? ` — última publicación: ${new Date(state.last_published_at).toLocaleString()}` : " — todavía no se publicó"}`
    : "Todavía no está configurado el repo de GitHub para publicar.";

  if (state.viewers.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "Todavía no creaste ningún usuario.";
    viewerListEl.appendChild(empty);
    return;
  }

  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Usuario</th><th>Creado</th><th></th></tr></thead><tbody></tbody>";
  const tbody = table.querySelector("tbody");
  for (const v of state.viewers) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = v.username;
    const createdTd = document.createElement("td");
    createdTd.textContent = new Date(v.created_at).toLocaleString();
    const actionTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger-btn";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", () => deleteViewer(v.username));
    actionTd.appendChild(delBtn);
    tr.append(nameTd, createdTd, actionTd);
    tbody.appendChild(tr);
  }
  viewerListEl.appendChild(table);
}

async function loadViewers() {
  if (!viewerListEl) return;
  try {
    renderViewerList(await ownerFetch("/api/viewers"));
  } catch (err) {
    viewerListEl.textContent = `No se pudo cargar la lista de usuarios: ${err.message}`;
  }
}

function showViewerMsg(text, isError) {
  viewerFormMsg.textContent = text;
  viewerFormMsg.classList.toggle("error", !!isError);
}

async function createViewer(e) {
  e.preventDefault();
  const username = viewerUsernameInput.value.trim().toLowerCase();
  const password = viewerPasswordInput.value;
  if (password !== viewerPasswordConfirmInput.value) {
    showViewerMsg("Las claves no coinciden.", true);
    return;
  }
  if (password.length < 12) {
    showViewerMsg("La clave debe tener al menos 12 caracteres.", true);
    return;
  }
  try {
    const state = await ownerFetch("/api/viewers", { method: "POST", body: { username, password } });
    viewerForm.reset();
    setPasswordVisibility(false);
    showViewerMsg(`Usuario "${username}" creado. Apretá "Publicar para el equipo" para que pueda entrar.`, false);
    renderViewerList(state);
  } catch (err) {
    showViewerMsg(err.message, true);
  }
}

async function deleteViewer(username) {
  if (!confirm(`¿Eliminar el acceso de "${username}"? Se aplica en la próxima publicación.`)) return;
  try {
    renderViewerList(await ownerFetch("/api/viewers/delete", { method: "POST", body: { username } }));
    showViewerMsg(`Usuario "${username}" eliminado. Apretá "Publicar para el equipo" para aplicarlo.`, false);
  } catch (err) {
    showViewerMsg(err.message, true);
  }
}

if (viewerForm) {
  viewerForm.addEventListener("submit", createViewer);
  viewerGenerateBtn.addEventListener("click", () => {
    const pwd = generatePassword();
    viewerPasswordInput.value = pwd;
    viewerPasswordConfirmInput.value = pwd;
    setPasswordVisibility(true);
    showViewerMsg("Clave generada: copiala ahora y pasásela a la persona por un canal distinto al link. No se va a volver a mostrar.", false);
  });
}

// ---------- Solo viewer: el link compartido carga un snapshot ya descifrado ----------

window.srLoadSnapshot = (snapshot, meta) => {
  lastData = snapshot;
  const published = new Date(meta.published_at);
  statusLine.textContent =
    `Datos publicados el ${published.toLocaleDateString()} a las ${published.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` +
    ` (ruta del ${snapshot.date}) — ${snapshot.vehicles?.length || 0} vehículo(s).`;
  renderAllTabs();
};

if (refreshBtn) refreshBtn.addEventListener("click", loadData);
if (publishBtn) publishBtn.addEventListener("click", publishSnapshot);
searchInput.addEventListener("input", render);

liveToggleBtn.addEventListener("click", () => {
  onlyLive = !onlyLive;
  liveToggleBtn.classList.toggle("active", onlyLive);
  render();
});

statusFilterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  const value = btn.dataset.value;
  if (activeStatuses.has(value)) {
    activeStatuses.delete(value);
    btn.classList.remove("active");
  } else {
    activeStatuses.add(value);
    btn.classList.add("active");
  }
  render();
});

sortEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  sortMode = btn.dataset.sort;
  sortEl.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  render();
});

for (const btn of tabButtons) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
}
avanceSearchInput.addEventListener("input", renderAvance);
vista1SearchInput.addEventListener("input", renderVista1);

cumplSearchInput.addEventListener("input", renderCumplimiento);
downloadCumplCsvBtn.addEventListener("click", downloadCumplimientoCsv);
cumplFilterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  cumplMaxPct = btn.dataset.max;
  cumplFilterEl.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  renderCumplimiento();
});
cumplSortEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  cumplSortMode = btn.dataset.sort;
  cumplSortEl.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  renderCumplimiento();
});
analysisSearchInput.addEventListener("input", renderAnalysis);

durationSearchInput.addEventListener("input", renderDurations);
durationSortEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  durationSortMode = btn.dataset.sort;
  durationSortEl.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  renderDurations();
});

sabanaSearchInput.addEventListener("input", renderSabana);
downloadCsvBtn.addEventListener("click", downloadCsv);

excludeDescargaInput.addEventListener("change", renderAllTabs);
onlyFbsInput.addEventListener("change", renderAllTabs);

amPmFilterEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".segment");
  if (!btn) return;
  amPmFilter = btn.dataset.ampm;
  amPmFilterEl.querySelectorAll(".segment").forEach((s) => s.classList.toggle("active", s === btn));
  renderAllTabs();
});

failedSearchInput.addEventListener("input", renderFailed);
downloadFailedCsvBtn.addEventListener("click", downloadFailedCsv);

if (!VIEWER_MODE) statusLine.textContent = 'Elegí una fecha y apretá "Actualizar" para traer datos.';
