/* ============================================================
   Kriterin Mekan — gerçek OSM verisiyle kriter ağırlıklı analiz
   Nitelik puanı: var = 1 · bilinmiyor = 0.35 · yok = 0
   Yakınlık puanı: 1 − (uzaklık / 5 km), konum izniyle etkinleşir
   ============================================================ */

const WEIGHT_LABELS = ["Önemsiz", "Az önemli", "Orta", "Önemli", "Çok önemli"];
const DEFAULT_WEIGHT = 2;
const UNKNOWN_SCORE = 0.35;
const MAX_DIST_KM = 5;
const PAGE_SIZE = 24;

const CRITERIA = [
  { key: "wifi",     group: "kayit", label: "Wi-Fi",           desc: "İnternet erişimi olduğu kayıtlı mı?" },
  { key: "disMekan", group: "kayit", label: "Dış mekân",       desc: "Bahçe / kaldırım oturması var mı?" },
  { key: "paket",    group: "kayit", label: "Paket servis",    desc: "Al-götür imkânı var mı?" },
  { key: "erisim",   group: "kayit", label: "Erişilebilirlik", desc: "Tekerlekli sandalye erişimi var mı?" },
  { key: "sigara",   group: "kayit", label: "Sigara alanı",    desc: "Sigara içilebilen bir bölüm var mı?" },
  { key: "yakinlik", group: "kayit", label: "Yakınlık",        desc: "Konumuna ne kadar yakın? (konum izni gerektirir)", needsLocation: true },
  { key: "puan",     group: "oy", label: "Genel puan",     desc: "Topluluk yıldız puanı (1–5)" },
  { key: "priz",     group: "oy", label: "Priz",           desc: "Priz rahat bulunuyor mu? (topluluk oyu)" },
  { key: "sessiz",   group: "oy", label: "Sessizlik",      desc: "Ortam sessiz mi? (topluluk oyu)" },
  { key: "calisma",  group: "oy", label: "Çalışma ortamı", desc: "Çalışmaya / ders çalışmaya uygun mu? (topluluk oyu)" },
];

const GROUP_TITLES = { kayit: "Kayıtlı veriler", oy: "Topluluk puanları" };
const VOTE_FIELDS = ["priz", "sessiz", "calisma"];
const VOTE_KEY = "km_oylar";

let DATA = { meta: {}, cafes: [] };
let seedVotes = {};         // data/puanlar.json → sahibin doğruladığı oylar
let seedMeta = {};          // puanlar.json meta bilgisi (ör. demo işareti)
let myVotes = {};           // ziyaretçinin kendi oyları (localStorage)
let openRatingId = null;    // puanlama formu açık olan mekan
let draft = {};             // formda henüz kaydedilmemiş oy
let weights = {};
let userLoc = null;         // { lat, lon }
let activeSemt = "";
let activeTur = "";
let searchTerm = "";
let onlyOpen = false;
let shownCount = PAGE_SIZE;

try { myVotes = JSON.parse(localStorage.getItem(VOTE_KEY) || "{}"); } catch { myVotes = {}; }

function persistVotes() {
  try { localStorage.setItem(VOTE_KEY, JSON.stringify(myVotes)); } catch { /* gizli mod vb. */ }
}

/* ---------- Ortak oy havuzu (Firestore REST, js/firebase-config.js) ---------- */
const FB = (typeof window !== "undefined" && window.FIREBASE_CONFIG) || null;
let cloudVotes = {};        // mekanId → diğer ziyaretçilerin oyları

// Bu tarayıcıyı temsil eden rastgele kimlik: kendi bulut oyumuzu
// (yereldeki kopyası zaten sayıldığı için) ortalamaya iki kez katmamak için
let clientId = "";
try {
  clientId = localStorage.getItem("km_cid") ||
    (localStorage.setItem("km_cid", "c" + Math.random().toString(36).slice(2, 12)),
     localStorage.getItem("km_cid"));
} catch { clientId = "c-gecici"; }

const fbBase = () =>
  `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents`;

function fbEncode(id, vote) {
  const fields = { mekan: { stringValue: id }, cid: { stringValue: clientId } };
  if (Number.isFinite(vote.genel)) fields.genel = { integerValue: String(vote.genel) };
  for (const f of VOTE_FIELDS) if (vote[f]) fields[f] = { stringValue: vote[f] };
  if (vote.t) fields.t = { integerValue: String(vote.t) };
  return { fields };
}

function fbDecode(doc) {
  const f = doc.fields || {};
  const vote = { cid: f.cid?.stringValue || "" };
  if (f.genel?.integerValue !== undefined) vote.genel = Number(f.genel.integerValue);
  for (const k of VOTE_FIELDS) if (f[k]?.stringValue) vote[k] = f[k].stringValue;
  return { mekan: f.mekan?.stringValue, vote };
}

async function loadCloudVotes() {
  if (!FB) return;
  try {
    const grouped = {};
    let pageToken = "", pages = 0;
    do {
      const url = `${fbBase()}/oylar?pageSize=300&key=${FB.apiKey}` +
        (pageToken ? `&pageToken=${pageToken}` : "");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Firestore ${res.status}`);
      const json = await res.json();
      for (const doc of json.documents || []) {
        const { mekan, vote } = fbDecode(doc);
        if (!mekan || vote.cid === clientId) continue;
        (grouped[mekan] = grouped[mekan] || []).push(vote);
      }
      pageToken = json.nextPageToken || "";
    } while (pageToken && ++pages < 40);
    cloudVotes = grouped;
    update();
  } catch (err) {
    console.warn("Ortak oy havuzuna ulaşılamadı (site yerel oylarla çalışmaya devam ediyor):", err.message);
  }
}

async function pushVoteCloud(id, vote) {
  if (!FB) return;
  try {
    // Daha önce gönderdiysek aynı belgeyi güncelle, yoksa yeni oluştur
    const url = vote._doc
      ? `https://firestore.googleapis.com/v1/${vote._doc}?key=${FB.apiKey}`
      : `${fbBase()}/oylar?key=${FB.apiKey}`;
    const res = await fetch(url, {
      method: vote._doc ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fbEncode(id, vote)),
    });
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    const doc = await res.json();
    if (doc.name && myVotes[id]) { myVotes[id]._doc = doc.name; persistVotes(); }
  } catch (err) {
    console.warn("Oy ortak havuza gönderilemedi (yerelde saklandı):", err.message);
  }
}

/* Bir mekanın tüm oylarını (tohum + ortak havuz + ziyaretçinin kendi oyu) özetler */
function aggregate(id) {
  const votes = [...(seedVotes[id] || []), ...(cloudVotes[id] || [])];
  if (myVotes[id]) votes.push(myVotes[id]);
  const agg = { n: votes.length, genel: null, priz: null, sessiz: null, calisma: null };
  const stars = votes.map(v => v.genel).filter(Number.isFinite);
  if (stars.length) agg.genel = stars.reduce((a, b) => a + b, 0) / stars.length;
  for (const f of VOTE_FIELDS) {
    let yes = 0, no = 0;
    votes.forEach(v => { if (v[f] === "yes") yes++; else if (v[f] === "no") no++; });
    if (yes !== no) agg[f] = yes > no ? "yes" : "no";
  }
  return agg;
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- Veri yükleme ---------- */
async function loadData() {
  if (window.__CAFE_DATA__) {          // tek dosyalık sürüm (scripts/build_single.py)
    DATA = window.__CAFE_DATA__;
    seedVotes = (window.__PUAN_DATA__ || {}).oylar || {};
    seedMeta = (window.__PUAN_DATA__ || {}).meta || {};
    init();
    return;
  }
  try {
    const res = await fetch("data/cafes.json");
    if (!res.ok) throw new Error(res.statusText);
    DATA = await res.json();
    try {
      const pr = await fetch("data/puanlar.json");
      if (pr.ok) {
        const pj = await pr.json();
        seedVotes = pj.oylar || {};
        seedMeta = pj.meta || {};
      }
    } catch { /* tohum oy dosyası yoksa sorun değil */ }
    init();
  } catch (err) {
    $("resultsGrid").innerHTML =
      `<p class="no-results">Veri yüklenemedi. Siteyi bir web sunucusu üzerinden açtığınızdan emin olun
       (ör. <code>python3 -m http.server</code>).</p>`;
    console.error("Veri yükleme hatası:", err);
  }
}

/* ---------- Başlatma ---------- */
function init() {
  CRITERIA.forEach(c => { weights[c.key] = c.needsLocation ? 0 : DEFAULT_WEIGHT; });
  renderSliders();
  renderSelects();
  renderHeroStats();
  bindEvents();
  $("demoBadge").hidden = !seedMeta.demo;
  update();
  loadCloudVotes();   // yapılandırılmışsa ortak havuzu arka planda getir
}

function renderSliders() {
  let lastGroup = null;
  $("criteriaSliders").innerHTML = CRITERIA.map(c => {
    const locked = c.needsLocation && !userLoc;
    const header = c.group !== lastGroup
      ? `<p class="crit-group-title">${esc(GROUP_TITLES[c.group] || "")}</p>`
      : "";
    lastGroup = c.group;
    return header + `
    <div class="criterion ${locked ? "locked" : ""}" id="crit-${c.key}">
      <div class="criterion-top">
        <span class="criterion-label" title="${esc(c.desc)}">${esc(c.label)}</span>
        <span class="criterion-value" id="val-${c.key}">${WEIGHT_LABELS[weights[c.key]]}</span>
      </div>
      <input type="range" min="0" max="4" step="1" value="${weights[c.key]}"
             data-key="${c.key}" aria-label="${esc(c.label)} önemi" ${locked ? "disabled" : ""}>
      ${locked ? `<p class="locked-note">Konum izni verince etkinleşir.</p>` : ""}
    </div>`;
  }).join("");
}

function renderSelects() {
  const semtCounts = new Map();
  const turCounts = new Map();
  DATA.cafes.forEach(c => {
    semtCounts.set(c.semt, (semtCounts.get(c.semt) || 0) + 1);
    (c.mutfak || []).forEach(m => turCounts.set(m, (turCounts.get(m) || 0) + 1));
  });

  const semtSel = $("semtSelect");
  [...semtCounts.keys()].sort((a, b) => a.localeCompare(b, "tr")).forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = `${s} (${semtCounts.get(s)})`;
    semtSel.appendChild(opt);
  });

  const turSel = $("turSelect");
  [...turCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .forEach(([t, n]) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = `${t} (${n})`;
      turSel.appendChild(opt);
    });
}

function renderHeroStats() {
  const fmt = n => n.toLocaleString("tr-TR");
  const semtSayisi = new Set(DATA.cafes.map(c => c.semt)).size;
  $("heroStats").innerHTML = `
    <div class="stat"><b>${fmt(DATA.cafes.length)}</b><span>kafe</span></div>
    <div class="stat"><b>${fmt(semtSayisi)}</b><span>semt</span></div>
    <div class="stat"><b>${CRITERIA.length}</b><span>kriter</span></div>
  `;
}

/* ---------- Olaylar ---------- */
function bindEvents() {
  $("criteriaSliders").addEventListener("input", e => {
    if (e.target.type !== "range") return;
    const key = e.target.dataset.key;
    weights[key] = Number(e.target.value);
    $(`val-${key}`).textContent = WEIGHT_LABELS[weights[key]];
    resetPageAndUpdate();
  });

  $("semtSelect").addEventListener("change", e => { activeSemt = e.target.value; resetPageAndUpdate(); });
  $("turSelect").addEventListener("change", e => { activeTur = e.target.value; resetPageAndUpdate(); });
  $("openNow").addEventListener("change", e => { onlyOpen = e.target.checked; resetPageAndUpdate(); });

  let debounce;
  $("searchInput").addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchTerm = e.target.value.trim().toLocaleLowerCase("tr");
      resetPageAndUpdate();
    }, 160);
  });

  $("resetBtn").addEventListener("click", () => {
    CRITERIA.forEach(c => { weights[c.key] = c.needsLocation && !userLoc ? 0 : DEFAULT_WEIGHT; });
    renderSliders();
    activeSemt = ""; activeTur = ""; searchTerm = ""; onlyOpen = false;
    $("semtSelect").value = ""; $("turSelect").value = "";
    $("searchInput").value = ""; $("openNow").checked = false;
    resetPageAndUpdate();
  });

  $("locBtn").addEventListener("click", requestLocation);

  $("loadMoreBtn").addEventListener("click", () => {
    shownCount += PAGE_SIZE;
    update();
  });

  // Puanlama etkileşimleri (kartlar her güncellemede yeniden çizildiği için delegasyon)
  $("resultsGrid").addEventListener("click", e => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, id, k, v } = btn.dataset;

    if (act === "open-rate") {
      openRatingId = openRatingId === id ? null : id;
      draft = openRatingId ? { ...(myVotes[id] || {}) } : {};
      update();
    } else if (act === "star") {
      draft.genel = Number(v);
      update();
    } else if (act === "attr") {
      draft[k] = draft[k] === v ? null : v;   // aynı seçime tekrar basınca temizle
      update();
    } else if (act === "save") {
      const hasContent = Number.isFinite(draft.genel) || VOTE_FIELDS.some(f => draft[f]);
      if (!hasContent) return;
      myVotes[id] = { ...draft, t: Date.now() };
      persistVotes();
      pushVoteCloud(id, myVotes[id]);
      openRatingId = null;
      update();
    } else if (act === "cancel") {
      openRatingId = null;
      update();
    } else if (act === "delete") {
      delete myVotes[id];
      persistVotes();
      openRatingId = null;
      update();
    }
  });
}

function requestLocation() {
  const status = $("locStatus");
  status.hidden = false;
  status.classList.remove("err");
  if (!navigator.geolocation) {
    status.textContent = "Tarayıcın konum desteği sunmuyor.";
    status.classList.add("err");
    return;
  }
  status.textContent = "Konum alınıyor…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLoc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (weights.yakinlik === 0) weights.yakinlik = 3;
      renderSliders();
      status.textContent = "Konum alındı — yakınlık kriteri etkin. ✓";
      resetPageAndUpdate();
    },
    () => {
      status.textContent = "Konum alınamadı. İzin verildiğinden emin ol.";
      status.classList.add("err");
    },
    { timeout: 10000, maximumAge: 300000 }
  );
}

/* ---------- Yardımcılar ---------- */
function distKm(a, b) {
  const dLat = (a.lat - b.lat) * 111.32;
  const dLon = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLon * dLon);
}

/* OSM opening_hours için temel çözümleyici.
   Desteklenen: "24/7", "HH:MM-HH:MM", "Mo-Fr 09:00-18:00; Sa 10:00-14:00",
   gece taşan aralıklar (22:00-02:00), "Su off".
   Çözülemeyen kayıtlar null (bilinmiyor) döner.                       */
const DAY_IDX = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };

function parseDays(str) {
  str = str.trim().toLowerCase();
  if (!str) return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set();
  for (let tok of str.split(",")) {
    tok = tok.trim();
    if (!tok || tok === "ph" || tok === "sh") continue;
    const range = tok.split("-").map(t => DAY_IDX[t.trim().slice(0, 2)]);
    if (range.some(d => d === undefined)) return null;
    if (range.length === 1) days.add(range[0]);
    else {
      let d = range[0];
      while (true) { days.add(d); if (d === range[1]) break; d = (d + 1) % 7; }
    }
  }
  return days.size ? days : null;
}

function isOpenNow(hours, now = new Date()) {
  if (!hours) return null;
  hours = hours.trim();
  if (hours === "24/7") return true;

  const today = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let applies = false;
  let open = false;

  for (let seg of hours.split(";")) {
    seg = seg.trim();
    if (!seg) continue;

    const offMatch = seg.match(/^([a-z ,\-]+)\s+(off|closed)$/i);
    if (offMatch) {
      const days = parseDays(offMatch[1]);
      if (days && days.has(today)) { applies = true; open = false; }
      continue;
    }

    const m = seg.match(/^([a-z ,\-]*?)\s*((?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*)$/i);
    if (!m) continue;

    const days = parseDays(m[1]);
    if (!days || !days.has(today)) continue;
    applies = true;

    for (const rangeStr of m[2].split(",")) {
      const [a, b] = rangeStr.split("-").map(t => {
        const [h, mm] = t.trim().split(":").map(Number);
        return h * 60 + mm;
      });
      if (b < a ? (nowMin >= a || nowMin < b) : (nowMin >= a && nowMin < b)) open = true;
    }
  }
  return applies ? open : null;
}

/* ---------- Puanlama ---------- */
function scoreCafe(cafe) {
  const active = CRITERIA.filter(c => !(c.needsLocation && !userLoc));
  let totalW = active.reduce((s, c) => s + weights[c.key], 0);
  const w = k => (totalW === 0 ? 1 : weights[k]);
  if (totalW === 0) totalW = active.length;

  const agg = aggregate(cafe.id);
  let got = 0;
  for (const c of active) {
    let s;
    if (c.needsLocation) {
      s = Math.max(0, 1 - distKm(userLoc, cafe) / MAX_DIST_KM);
    } else if (c.key === "puan") {
      s = agg.genel !== null ? (agg.genel - 1) / 4 : UNKNOWN_SCORE;
    } else if (VOTE_FIELDS.includes(c.key)) {
      const v = agg[c.key];
      s = v === "yes" ? 1 : v === "no" ? 0 : UNKNOWN_SCORE;
    } else {
      const v = cafe.ozellik[c.key];
      s = v === "yes" ? 1 : v === "no" ? 0 : UNKNOWN_SCORE;
    }
    got += w(c.key) * s;
  }
  return Math.round((got / totalW) * 100);
}

const knownCount = c => Object.values(c.ozellik).filter(v => v !== null).length;

/* ---------- Sonuçlar ---------- */
function resetPageAndUpdate() {
  shownCount = PAGE_SIZE;
  update();
}

function update() {
  const grid = $("resultsGrid");
  const fmt = n => n.toLocaleString("tr-TR");
  const now = new Date();

  let list = DATA.cafes;
  if (activeSemt) list = list.filter(c => c.semt === activeSemt);
  if (activeTur) list = list.filter(c => (c.mutfak || []).includes(activeTur));
  if (searchTerm) list = list.filter(c => c.ad.toLocaleLowerCase("tr").includes(searchTerm));
  if (onlyOpen) list = list.filter(c => isOpenNow(c.saat, now) === true);

  const scored = list
    .map(c => ({ ...c, match: scoreCafe(c) }))
    .sort((a, b) => b.match - a.match || knownCount(b) - knownCount(a) || a.ad.localeCompare(b.ad, "tr"));

  $("resultsCount").textContent = scored.length
    ? `${fmt(Math.min(shownCount, scored.length))} / ${fmt(scored.length)} kafe`
    : "";
  $("noResults").hidden = scored.length > 0;
  $("loadMoreBtn").hidden = scored.length <= shownCount;

  grid.innerHTML = scored.slice(0, shownCount).map((c, i) => cardHTML(c, i, now)).join("");
}

function chipHTML(label, v, sourceNote) {
  const cls = v === "yes" ? "yes" : v === "no" ? "no" : "unknown";
  const mark = v === "yes" ? "✓" : v === "no" ? "✕" : "?";
  const state = v === "yes" ? "var" : v === "no" ? "yok" : "bilinmiyor";
  return `<span class="chip ${cls}" title="${esc(label)}: ${state}${sourceNote}">${mark} ${esc(label)}</span>`;
}

function cardHTML(c, i, now) {
  const openState = isOpenNow(c.saat, now);
  const agg = aggregate(c.id);
  const chips =
    CRITERIA.filter(cr => cr.group === "kayit" && !cr.needsLocation)
      .map(cr => chipHTML(cr.label, c.ozellik[cr.key], " (kayıtlı veri)")).join("") +
    CRITERIA.filter(cr => VOTE_FIELDS.includes(cr.key))
      .map(cr => chipHTML(cr.label, agg[cr.key], " (topluluk oyu)")).join("");

  const tags = (c.mutfak || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join("");

  const links = [
    `<a href="https://www.google.com/maps/search/?api=1&query=${c.lat}%2C${c.lon}" target="_blank" rel="noopener">Harita</a>`,
    c.web ? `<a href="${esc(c.web)}" target="_blank" rel="noopener">Web</a>` :
    c.insta ? `<a href="${esc(c.insta)}" target="_blank" rel="noopener">Instagram</a>` : "",
    c.tel ? `<a href="tel:${esc(c.tel.replace(/\s/g, ""))}">Ara</a>` : "",
  ].filter(Boolean).join("");

  const dist = userLoc
    ? `<span class="sep">·</span><span class="dist-note">${distKm(userLoc, c).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} km</span>`
    : "";

  const hoursHTML = c.saat
    ? `<span class="cafe-hours ${openState === true ? "open" : ""}" title="${esc(c.saat)}">
         ${openState === true ? "● Şu an açık" : openState === false ? "Kapalı" : "🕐"} ${esc(c.saat)}
       </span>`
    : `<span class="cafe-hours">Saat bilgisi yok</span>`;

  const starsHTML = agg.genel !== null
    ? `<span class="sep">·</span><span class="rating-inline" title="${agg.n} oy">★ ${agg.genel.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} <small>(${agg.n})</small></span>`
    : "";

  const mine = myVotes[c.id];
  const rateBtn = `<button type="button" class="rate-btn ${mine ? "voted" : ""}" data-act="open-rate" data-id="${esc(c.id)}">
    ${mine ? `★ ${mine.genel ?? "—"} · Oyum` : "☆ Puanla"}</button>`;

  const rateBox = openRatingId === c.id ? rateBoxHTML(c.id) : "";

  return `
  <article class="cafe-card" style="animation-delay:${Math.min(i % PAGE_SIZE * 30, 400)}ms">
    <div class="cafe-top">
      <div>
        <h3 class="cafe-name">${esc(c.ad)}</h3>
        <div class="cafe-meta">
          <span>${esc(c.semt)}${c.semtTahmini ? "*" : ""}</span>
          ${c.mahalle ? `<span class="sep">·</span><span>${esc(c.mahalle)}</span>` : ""}
          ${dist}
          ${starsHTML}
        </div>
      </div>
      <div class="match-badge ${i === 0 ? "top" : ""}"><b>%${c.match}</b><span>eşleşme</span></div>
    </div>
    <div class="match-bar"><i style="width:${c.match}%"></i></div>
    <div class="attr-chips">${chips}</div>
    ${tags ? `<div class="cuisine-tags">${tags}</div>` : ""}
    <div class="cafe-foot">
      ${hoursHTML}
      <div class="cafe-links">${rateBtn}${links}</div>
    </div>
    ${rateBox}
  </article>`;
}

/* ---------- Puanlama formu ---------- */
function rateBoxHTML(id) {
  const star = n => `<button type="button" class="star-btn ${draft.genel >= n ? "on" : ""}"
    data-act="star" data-id="${esc(id)}" data-v="${n}" aria-label="${n} yıldız">★</button>`;

  const toggle = (key, yesLabel, noLabel) => `
    <div class="rate-row">
      <span class="rate-label">${esc(CRITERIA.find(c => c.key === key).label)}</span>
      <div class="pill-pair">
        <button type="button" class="pill ${draft[key] === "yes" ? "on" : ""}"
          data-act="attr" data-id="${esc(id)}" data-k="${key}" data-v="yes">${yesLabel}</button>
        <button type="button" class="pill ${draft[key] === "no" ? "on no" : ""}"
          data-act="attr" data-id="${esc(id)}" data-k="${key}" data-v="no">${noLabel}</button>
      </div>
    </div>`;

  return `
  <div class="rate-box">
    <div class="rate-row">
      <span class="rate-label">Genel</span>
      <div class="stars">${[1, 2, 3, 4, 5].map(star).join("")}</div>
    </div>
    ${toggle("priz", "Var", "Yok")}
    ${toggle("sessiz", "Sessiz", "Gürültülü")}
    ${toggle("calisma", "Uygun", "Değil")}
    <div class="rate-actions">
      <button type="button" class="btn btn-accent btn-small" data-act="save" data-id="${esc(id)}">Kaydet</button>
      <button type="button" class="btn btn-ghost btn-small" data-act="cancel">Vazgeç</button>
      ${myVotes[id] ? `<button type="button" class="link-btn" data-act="delete" data-id="${esc(id)}">Oyumu sil</button>` : ""}
    </div>
    <p class="rate-note">${FB
      ? "Oyun sıralamana hemen yansır ve herkesin gördüğü ortak havuza eklenir."
      : "Oyun bu tarayıcıda saklanır ve senin sıralamana hemen yansır."}</p>
  </div>`;
}

loadData();
