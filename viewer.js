// Link compartido (GitHub Pages): login + descifrado del snapshot publicado.
//
// data.enc.json esta cifrado (AES-256-GCM). La clave de datos de cada
// publicacion viene "envuelta" una vez por usuario con una clave derivada de
// su clave personal (PBKDF2-SHA256). Sin usuario+clave validos no hay forma
// de leer los datos: ocultar/saltarse esta pantalla no sirve de nada.
// Todo pasa en el navegador con WebCrypto; la clave nunca sale de aca.
(() => {
  // WebCrypto solo existe en contextos seguros: si se entro por http://,
  // se redirige a https:// en vez de fallar con un error confuso.
  if (location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
    location.replace(`https://${location.host}${location.pathname}${location.search}`);
    return;
  }

  const DATA_URL = "data.enc.json";
  const SESSION_KEY = "sr_viewer_session";
  const LOGOUT_MSG_KEY = "sr_viewer_logout_msg";
  const POLL_MS = 2 * 60 * 1000;
  const MIN_ITERATIONS = 100000;
  const enc = new TextEncoder();
  // Deben coincidir con publish.py.
  const DATA_AAD = enc.encode("sr-data-v1");
  const DEK_AAD = enc.encode("sr-dek-v1");

  let session = null; // { uid, kek } - kek en base64; nunca la clave
  let currentPublishedAt = null;
  let pollTimer = null;

  // Medición de uso (Google Analytics 4) sin cargar scripts de terceros: se
  // manda solo el nombre del evento y el usuario que entró, nunca datos del
  // panel. connect-src de VIEWER_CSP (publish.py) permite solo este destino.
  const GA_ID = "G-XXXXXXXXXX";
  function track(name, params = {}) {
    if (GA_ID === "G-XXXXXXXXXX" || location.protocol !== "https:" || !navigator.sendBeacon) return;
    const flags = {};
    let cid, sid;
    try {
      cid = localStorage.getItem("sr_ga_cid");
      if (!cid) {
        cid = `${Math.floor(Math.random() * 2147483647)}.${Math.floor(Date.now() / 1000)}`;
        localStorage.setItem("sr_ga_cid", cid);
        flags._fv = "1";
      }
      sid = sessionStorage.getItem("sr_ga_sid");
      if (!sid) {
        sid = String(Math.floor(Date.now() / 1000));
        sessionStorage.setItem("sr_ga_sid", sid);
        flags._ss = "1";
      }
    } catch {
      return;
    }
    const q = new URLSearchParams({
      v: "2", tid: GA_ID, cid, sid, sct: "1", seg: "1", _et: "1", en: name,
      dl: location.origin + location.pathname, dt: document.title, "ep.app_name": "panel-rutas", ...flags,
    });
    for (const [k, v] of Object.entries(params)) q.set(`ep.${k}`, v);
    navigator.sendBeacon(`https://region1.google-analytics.com/g/collect?${q}`);
  }
  track("page_view");

  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

  async function userId(username) {
    const normalized = username.trim().toLowerCase();
    return toHex(await crypto.subtle.digest("SHA-256", enc.encode(`sr-viewer:${normalized}`)));
  }

  async function deriveKekBytes(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, 256);
    return new Uint8Array(bits);
  }

  // Version del codigo de esta pagina (publish.py la pone en un <meta>). Si
  // data.enc.json trae otra, el navegador tiene el HTML viejo en cache (Pages
  // lo guarda 10 min): se recarga con ?b=<version> para saltarse esa cache. La
  // sesion vive en sessionStorage, asi que no se vuelve a pedir la clave.
  const PAGE_BUILD = document.querySelector('meta[name="sr-build"]')?.content || null;
  const BUILD_RELOAD_KEY = "sr_viewer_build_reload";

  function reloadIfNewBuild(payload) {
    if (!payload.build || !PAGE_BUILD || payload.build === PAGE_BUILD) return false;
    // Un solo intento por version: si el CDN todavia sirve el HTML viejo, no
    // se queda recargando en loop; se reintenta en la proxima publicacion.
    if (sessionStorage.getItem(BUILD_RELOAD_KEY) === payload.build) return false;
    sessionStorage.setItem(BUILD_RELOAD_KEY, payload.build);
    location.replace(`${location.pathname}?b=${encodeURIComponent(payload.build)}`);
    return true;
  }

  async function fetchPayload() {
    const resp = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (resp.status === 404) throw new Error("NOT_PUBLISHED");
    if (!resp.ok) throw new Error("FETCH_FAILED");
    const payload = await resp.json();
    if (reloadIfNewBuild(payload)) throw new Error("RELOADING");
    return payload;
  }

  async function decryptWith(payload, uid, kekBytes) {
    const entry = payload.users.find((u) => u.id === uid);
    if (!entry) throw new Error("NO_ACCESS");
    const kek = await crypto.subtle.importKey("raw", kekBytes, "AES-GCM", false, ["decrypt"]);
    const dekRaw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(entry.iv), additionalData: DEK_AAD },
      kek,
      b64ToBytes(entry.wrapped_key)
    );
    const dek = await crypto.subtle.importKey("raw", dekRaw, "AES-GCM", false, ["decrypt"]);
    const compressed = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(payload.iv), additionalData: DATA_AAD },
      dek,
      b64ToBytes(payload.data)
    );
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }

  // ---------- UI ----------

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  const usernameInput = el("input", { type: "text", placeholder: "Usuario", autocomplete: "username", required: true });
  const passwordInput = el("input", { type: "password", placeholder: "Clave", autocomplete: "current-password", required: true });
  const errorEl = el("div", { className: "login-error" });
  const submitBtn = el("button", { type: "submit", textContent: "Entrar" });
  const form = el("form", { className: "login-card" }, [
    el("h2", { textContent: "🚚 Visibilidad de rutas" }),
    el("p", { textContent: "Ingresá con el usuario y la clave que te dieron." }),
    usernameInput,
    passwordInput,
    errorEl,
    submitBtn,
  ]);
  // Al recargar con sesion activa se muestra un spinner en vez del formulario
  // mientras se descifra; si la sesion ya no sirve, aparece el login.
  const loader = el("div", { className: "login-loading" }, [
    el("div", { className: "spinner" }),
    el("p", { textContent: "Cargando datos..." }),
  ]);
  const overlay = el("div", { id: "login-overlay" }, [form, loader]);
  overlay.classList.toggle("restoring", !!sessionStorage.getItem(SESSION_KEY));
  document.body.prepend(overlay);

  const logoutBtn = el("button", { type: "button", className: "logout-btn", textContent: "Cerrar sesión" });
  logoutBtn.addEventListener("click", () => logout());
  document.querySelector(".toolbar .toolbar-row")?.append(logoutBtn);

  const pendingMsg = sessionStorage.getItem(LOGOUT_MSG_KEY);
  if (pendingMsg) {
    errorEl.textContent = pendingMsg;
    sessionStorage.removeItem(LOGOUT_MSG_KEY);
  }

  function showDashboard(decrypted, publishedAt) {
    currentPublishedAt = publishedAt;
    overlay.remove();
    document.body.classList.add("unlocked");
    window.srLoadSnapshot(decrypted.snapshot, { published_at: decrypted.published_at });
    clearInterval(pollTimer);
    pollTimer = setInterval(checkForUpdate, POLL_MS);
  }

  // Al cerrar sesion se recarga la pagina para que los datos descifrados no
  // queden en memoria ni en el DOM.
  function logout(message) {
    sessionStorage.removeItem(SESSION_KEY);
    if (message) sessionStorage.setItem(LOGOUT_MSG_KEY, message);
    location.reload();
  }

  async function login(username, password) {
    const payload = await fetchPayload();
    const uid = await userId(username);
    const entry = payload.users.find((u) => u.id === uid);
    // Si el usuario no existe se deriva igual (con salt al azar), para que la
    // respuesta tarde lo mismo y no se pueda averiguar que usuarios existen.
    const salt = entry ? b64ToBytes(entry.salt) : crypto.getRandomValues(new Uint8Array(16));
    const iterations = Math.max(entry ? entry.iterations : 600000, MIN_ITERATIONS);
    const kekBytes = await deriveKekBytes(password, salt, iterations);
    if (!entry) throw new Error("BAD_CREDENTIALS");

    let decrypted;
    try {
      decrypted = await decryptWith(payload, uid, kekBytes);
    } catch {
      throw new Error("BAD_CREDENTIALS");
    }
    session = { uid, kek: bytesToB64(kekBytes) };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    showDashboard(decrypted, payload.published_at);
    track("viewer_login", { viewer: username.trim().toLowerCase() });
  }

  async function restoreSession() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    try {
      session = JSON.parse(raw);
      const payload = await fetchPayload();
      showDashboard(await decryptWith(payload, session.uid, b64ToBytes(session.kek)), payload.published_at);
    } catch (err) {
      if (err.message === "RELOADING") return;
      session = null;
      sessionStorage.removeItem(SESSION_KEY);
      overlay.classList.remove("restoring");
    }
  }

  // Sin sesion: igual se revisa la version al abrir, para que el login ya
  // aparezca sobre el codigo nuevo.
  async function checkBuildOnOpen() {
    if (sessionStorage.getItem(SESSION_KEY)) return restoreSession();
    try {
      await fetchPayload();
    } catch {
      // sin red o recargando: el login se encarga de mostrar el error
    }
  }

  async function checkForUpdate() {
    if (!session) return;
    let payload;
    try {
      payload = await fetchPayload();
    } catch {
      return; // problema de red: se reintenta en el proximo ciclo
    }
    if (payload.published_at === currentPublishedAt) return;
    try {
      const decrypted = await decryptWith(payload, session.uid, b64ToBytes(session.kek));
      currentPublishedAt = payload.published_at;
      window.srLoadSnapshot(decrypted.snapshot, { published_at: decrypted.published_at });
    } catch {
      logout("Tu acceso cambió o fue revocado. Ingresá de nuevo.");
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    if (!window.crypto?.subtle || typeof DecompressionStream === "undefined") {
      errorEl.textContent = "Este navegador no es compatible. Usá Chrome, Edge, Firefox o Safari actualizados.";
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = "Verificando...";
    try {
      await login(usernameInput.value, passwordInput.value);
    } catch (err) {
      passwordInput.value = "";
      errorEl.textContent =
        err.message === "BAD_CREDENTIALS"
          ? "Usuario o clave incorrectos."
          : err.message === "NOT_PUBLISHED"
            ? "Todavía no hay datos publicados."
            : "No se pudieron cargar los datos. Revisá tu conexión e intentá de nuevo.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Entrar";
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });

  checkBuildOnOpen();
})();
