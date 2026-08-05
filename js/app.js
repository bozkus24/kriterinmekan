/* ============================================================
   KriterinMekan — kriter ağırlıklı mekan analiz motoru
   ============================================================ */

const WEIGHT_LABELS = ["Önemsiz", "Az önemli", "Orta", "Önemli", "Çok önemli"];
const DEFAULT_WEIGHT = 2; // "Orta"
const MAX_SCORE = 5;      // veritabanındaki puanlar 1–5 arası

let DATA = { criteria: [], cafes: [] };
let weights = {};          // { kriterKey: 0..4 }
let activeSemt = "";
let activeFiyat = "";

/* ---------- Veri yükleme ---------- */
async function loadData() {
  try {
    const res = await fetch("data/cafes.json");
    if (!res.ok) throw new Error(res.statusText);
    DATA = await res.json();
    init();
  } catch (err) {
    document.getElementById("resultsGrid").innerHTML =
      `<p class="no-results">Veri yüklenemedi. Siteyi bir web sunucusu üzerinden açtığınızdan emin olun
       (ör. <code>python3 -m http.server</code>).</p>`;
    console.error("Veri yükleme hatası:", err);
  }
}

/* ---------- Başlatma ---------- */
function init() {
  DATA.criteria.forEach(c => { weights[c.key] = DEFAULT_WEIGHT; });
  renderSliders();
  renderSemtOptions();
  renderHeroStats();
  bindEvents();
  update();
}

function renderSliders() {
  const wrap = document.getElementById("criteriaSliders");
  wrap.innerHTML = DATA.criteria.map(c => `
    <div class="criterion">
      <div class="criterion-top">
        <span class="criterion-label" title="${c.desc}">${c.icon} ${c.label}</span>
        <span class="criterion-value" id="val-${c.key}">${WEIGHT_LABELS[DEFAULT_WEIGHT]}</span>
      </div>
      <input type="range" min="0" max="4" step="1" value="${DEFAULT_WEIGHT}"
             data-key="${c.key}" aria-label="${c.label} önemi">
    </div>
  `).join("");
}

function renderSemtOptions() {
  const semtler = [...new Set(DATA.cafes.map(c => c.semt))].sort((a, b) => a.localeCompare(b, "tr"));
  const sel = document.getElementById("semtSelect");
  semtler.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  });
}

function renderHeroStats() {
  const semtSayisi = new Set(DATA.cafes.map(c => c.semt)).size;
  document.getElementById("heroStats").innerHTML = `
    <div class="stat"><b>${DATA.cafes.length}</b><span>mekan</span></div>
    <div class="stat"><b>${semtSayisi}</b><span>semt</span></div>
    <div class="stat"><b>${DATA.criteria.length}</b><span>kriter</span></div>
  `;
}

function bindEvents() {
  document.getElementById("criteriaSliders").addEventListener("input", e => {
    if (e.target.type !== "range") return;
    const key = e.target.dataset.key;
    weights[key] = Number(e.target.value);
    document.getElementById(`val-${key}`).textContent = WEIGHT_LABELS[weights[key]];
    update();
  });

  document.getElementById("semtSelect").addEventListener("change", e => {
    activeSemt = e.target.value;
    update();
  });

  document.getElementById("budgetBtns").addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    activeFiyat = btn.dataset.fiyat;
    document.querySelectorAll("#budgetBtns button").forEach(b => b.classList.toggle("active", b === btn));
    update();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    DATA.criteria.forEach(c => { weights[c.key] = DEFAULT_WEIGHT; });
    document.querySelectorAll("#criteriaSliders input[type=range]").forEach(r => {
      r.value = DEFAULT_WEIGHT;
      document.getElementById(`val-${r.dataset.key}`).textContent = WEIGHT_LABELS[DEFAULT_WEIGHT];
    });
    update();
  });
}

/* ---------- Puanlama motoru ----------
   Eşleşme %  =  Σ(ağırlık × mekan puanı) / Σ(ağırlık × 5) × 100
   Tüm ağırlıklar 0 ise eşit ağırlık varsayılır.               */
function scoreCafe(cafe) {
  let totalWeight = DATA.criteria.reduce((s, c) => s + weights[c.key], 0);
  const effWeights = {};
  DATA.criteria.forEach(c => {
    effWeights[c.key] = totalWeight === 0 ? 1 : weights[c.key];
  });
  if (totalWeight === 0) totalWeight = DATA.criteria.length;

  let got = 0, max = 0;
  DATA.criteria.forEach(c => {
    const w = effWeights[c.key];
    got += w * (cafe.puanlar[c.key] ?? 0);
    max += w * MAX_SCORE;
  });
  return max === 0 ? 0 : Math.round((got / max) * 100);
}

/* Kullanıcının önem verdiği kriterler arasında mekanın en güçlü 2 yönü */
function strengths(cafe) {
  return DATA.criteria
    .filter(c => weights[c.key] >= 3 && (cafe.puanlar[c.key] ?? 0) >= 4)
    .sort((a, b) => cafe.puanlar[b.key] - cafe.puanlar[a.key])
    .slice(0, 2)
    .map(c => `${c.icon} ${c.label}`);
}

/* ---------- Sonuçları çiz ---------- */
function update() {
  const grid = document.getElementById("resultsGrid");
  const noResults = document.getElementById("noResults");

  const filtered = DATA.cafes
    .filter(c => !activeSemt || c.semt === activeSemt)
    .filter(c => !activeFiyat || c.fiyat === Number(activeFiyat))
    .map(c => ({ ...c, match: scoreCafe(c) }))
    .sort((a, b) => b.match - a.match);

  document.getElementById("resultsCount").textContent =
    filtered.length ? `${filtered.length} mekan bulundu` : "";

  noResults.hidden = filtered.length > 0;

  grid.innerHTML = filtered.map((c, i) => {
    const guclu = strengths(c);
    return `
    <article class="cafe-card" style="animation-delay:${Math.min(i * 40, 300)}ms">
      <div class="cafe-top">
        <div>
          <div class="cafe-name">${c.ad}</div>
          <div class="cafe-meta">
            <span>📍 ${c.semt}</span>
            <span>${"₺".repeat(c.fiyat)}</span>
            <span>🕐 ${c.saat}</span>
          </div>
        </div>
        <div class="match-badge ${i === 0 ? "top" : ""}">
          <b>%${c.match}</b><span>eşleşme</span>
        </div>
      </div>
      <div class="match-bar"><i style="width:${c.match}%"></i></div>
      <p class="cafe-desc">${c.aciklama}</p>
      <div class="cafe-tags">${c.etiketler.map(t => `<span class="tag">${t}</span>`).join("")}</div>
      ${guclu.length ? `<div class="cafe-strengths"><b>Senin için güçlü yönleri:</b> ${guclu.join(" · ")}</div>` : ""}
    </article>`;
  }).join("");
}

loadData();
