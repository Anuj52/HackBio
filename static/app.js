/* ═══════════════════════════════════════════════════════════
   Bacterial Colony ABM — Dashboard Application
   ═══════════════════════════════════════════════════════════ */
const socket = io();

// ─── Genotype colors ───
const GC=['#569cd6','#608b4e','#d16969','#dcdcaa','#c586c0','#9cdcfe','#4ec9b0','#ce9178','#b5cea8','#d7ba7d','#6a9955','#c586c0','#4fc1ff','#d4d4d4','#569cd6','#608b4e','#dcdcaa','#c586c0','#858585','#ce9178'];
const PHASE_NAMES=['Lag','Log','Stationary','Death'];
const PHASE_ALPHA=[.45,1,.65,.25];

// ─── Preset Scenarios ───
const PRESETS = {
  custom: {label:'Custom', cfg:null},
  ltee: {label:'LTEE Classic', cfg:{epochs:200,initPop:300,capacity:10000,mutation:0.01,abMode:'gradual',abStart:60,seed:'42',gridW:200,gridH:200,zLevels:10,temp:37,pressure:1,ph:7,rl:true,cpu:false}},
  stress: {label:'Stress Test', cfg:{epochs:150,initPop:500,capacity:8000,mutation:0.05,abMode:'spike',abStart:20,seed:'',gridW:200,gridH:200,zLevels:10,temp:37,pressure:1,ph:7,rl:true,cpu:false}},
  biofilm: {label:'Biofilm Focus', cfg:{epochs:200,initPop:200,capacity:10000,mutation:0.01,abMode:'gradual',abStart:100,seed:'',gridW:200,gridH:200,zLevels:10,temp:37,pressure:1,ph:7,rl:true,cpu:false}},
  speed: {label:'Speed Run', cfg:{epochs:100,initPop:100,capacity:5000,mutation:0.01,abMode:'gradual',abStart:40,seed:'42',gridW:50,gridH:50,zLevels:5,temp:37,pressure:1,ph:7,rl:true,cpu:false}},
  norl: {label:'No RL Baseline', cfg:{epochs:200,initPop:300,capacity:10000,mutation:0.01,abMode:'gradual',abStart:60,seed:'42',gridW:200,gridH:200,zLevels:10,temp:37,pressure:1,ph:7,rl:false,cpu:false}},
};

function applyPreset(name){
  const p = PRESETS[name];
  if(!p || !p.cfg) return;
  const c = p.cfg;
  document.getElementById('cfgEpochs').value=c.epochs;
  document.getElementById('cfgInitPop').value=c.initPop;
  document.getElementById('cfgCapacity').value=c.capacity;
  document.getElementById('cfgMutation').value=c.mutation;
  document.getElementById('cfgABMode').value=c.abMode;
  document.getElementById('cfgABStart').value=c.abStart;
  document.getElementById('cfgSeed').value=c.seed;
  document.getElementById('cfgGridW').value=c.gridW;
  document.getElementById('cfgGridH').value=c.gridH;
  document.getElementById('cfgZLevels').value=c.zLevels;
  document.getElementById('cfgTemp').value=c.temp;
  document.getElementById('cfgPressure').value=c.pressure;
  document.getElementById('cfgPH').value=c.ph;
  document.getElementById('cfgRLEnabled').checked=c.rl;
  document.getElementById('cfgForceCPU').checked=c.cpu;
}

// ─── State ───
let snapshot = null;
let gridW=200, gridH=200;
const sparkData = {pop:[], fit:[], rst:[]};
const SPARK_MAX = 50;

// ─── World renderer ───
const CELL = 5;
const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d');
let zoom = 1, offX = 0, offY = 0;
let dragging = false, lastMX = 0, lastMY = 0;
let hovered = null;

const overlayRes = document.createElement('canvas');
const overlayAb = document.createElement('canvas');
const overlayBio = document.createElement('canvas');
const overlaySig = document.createElement('canvas');

function resizeCanvas(){
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  canvas.width = w; canvas.height = h;
  render();
}
window.addEventListener('resize', resizeCanvas);

function fitView(){
  const wrap = canvas.parentElement;
  const ww = wrap.clientWidth, wh = wrap.clientHeight;
  const worldPx = Math.max(gridW, gridH) * CELL;
  zoom = Math.min(ww / worldPx, wh / worldPx) * 0.9;
  offX = (ww - gridW * CELL * zoom) / 2;
  offY = (wh - gridH * CELL * zoom) / 2;
}

// Zoom
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx = (mx - offX) / zoom, wy = (my - offY) / zoom;
  const f = e.deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.15, Math.min(30, zoom * f));
  offX = mx - wx * zoom; offY = my - wy * zoom;
  render();
}, {passive: false});

// Pan
canvas.addEventListener('mousedown', e => { dragging = true; lastMX = e.clientX; lastMY = e.clientY; canvas.classList.add('dragging'); });
canvas.addEventListener('mousemove', e => {
  if (dragging) { offX += e.clientX - lastMX; offY += e.clientY - lastMY; lastMX = e.clientX; lastMY = e.clientY; render(); }
  detectHover(e);
});
canvas.addEventListener('mouseup', () => { dragging = false; canvas.classList.remove('dragging'); });
canvas.addEventListener('mouseleave', () => { dragging = false; canvas.classList.remove('dragging'); hovered = null; document.getElementById('tooltip').style.display = 'none'; });

// Hover detection — throttled
let _hoverPending = false;
function detectHover(e){
  if (_hoverPending) return;
  _hoverPending = true;
  requestAnimationFrame(()=>{ _hoverPending = false; _doHover(e); });
}
function _doHover(e){
  if (!snapshot || !snapshot.bacteria) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const wx = (mx - offX) / zoom / CELL, wy = (my - offY) / zoom / CELL;
  let best = null, bestD = 2.5;
  const vl = -offX / zoom / CELL - 2, vt = -offY / zoom / CELL - 2;
  const vr = (canvas.width - offX) / zoom / CELL + 2, vb = (canvas.height - offY) / zoom / CELL + 2;
  for (const b of snapshot.bacteria) {
    if (b[0] < vl || b[0] > vr || b[1] < vt || b[1] > vb) continue;
    const jx = b[0] + jitter(b, 0), jy = b[1] + jitter(b, 1);
    const dx = jx - wx, dy = jy - wy, d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; best = b; }
  }
  hovered = best;
  const tip = document.getElementById('tooltip');
  if (best) {
    tip.style.display = 'block';
    const tx = Math.min(e.clientX - canvas.parentElement.getBoundingClientRect().left + 16, canvas.width - 200);
    const ty = Math.min(e.clientY - canvas.parentElement.getBoundingClientRect().top + 16, canvas.height - 200);
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    tip.innerHTML = `<div class="tt-head" style="color:${GC[best[2]%GC.length]}">Genotype ${best[2]}</div>`
      + ttRow('Phase', PHASE_NAMES[best[3]])
      + ttRow('Fitness', best[4]) + ttRow('Biomass', best[5])
      + ttRow('Resistance', best[6]) + ttRow('Efficiency', best[7])
      + ttRow('Toxin Prod', best[8]) + ttRow('Public Good', best[9])
      + ttRow('Biofilm', best[10] ? 'Yes' : 'No') + ttRow('Age', best[11]);
    render();
  } else {
    tip.style.display = 'none';
    if (hovered !== null) render();
  }
}
function ttRow(k,v){ return `<div class="tt-row"><span class="tt-label">${k}</span><span class="tt-val">${v}</span></div>`; }

function jitter(b, axis){
  const h = ((b[0]*73856093 + b[1]*19349663 + b[2]*83492791 + axis*4256249) & 0x7FFFFFFF) % 1000;
  return (h / 1000 - 0.5) * 0.65;
}

// ─── Overlays ───
function buildOverlay(oc, grid, colorFn){
  if (!grid || !grid.length) return;
  const R = grid.length, C = grid[0].length;
  oc.width = C; oc.height = R;
  const octx = oc.getContext('2d');
  const img = octx.createImageData(C, R);
  let mn = Infinity, mx = -Infinity;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const v = grid[r][c]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const rng = mx - mn || 1;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = (grid[r][c] - mn) / rng;
    const [cr,cg,cb,ca] = colorFn(t);
    const i = (r * C + c) * 4;
    img.data[i] = cr; img.data[i+1] = cg; img.data[i+2] = cb; img.data[i+3] = ca;
  }
  octx.putImageData(img, 0, 0);
}

function buildResourceOverlay(oc, grid){
  if (!grid || !grid.length) return;
  const R = grid.length, C = grid[0].length;
  oc.width = C; oc.height = R;
  const octx = oc.getContext('2d');
  const img = octx.createImageData(C, R);
  const flat = [];
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) flat.push(grid[r][c]);
  flat.sort((a,b) => a - b);
  const p95 = flat[Math.floor(flat.length * 0.95)] || 1;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const dep = Math.max(0, 1 - grid[r][c] / p95);
    const t = dep * dep;
    const i = (r * C + c) * 4;
    img.data[i] = 180 + 75*t | 0; img.data[i+1] = 130 + 40*t | 0; img.data[i+2] = 40; img.data[i+3] = t * 160 | 0;
  }
  octx.putImageData(img, 0, 0);
}

function buildAntibioticOverlay(oc, grid){
  if (!grid || !grid.length) return;
  const R = grid.length, C = grid[0].length;
  oc.width = C; oc.height = R;
  const octx = oc.getContext('2d');
  const img = octx.createImageData(C, R);
  let mx = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { if (grid[r][c] > mx) mx = grid[r][c]; }
  if (mx < 0.01) { octx.clearRect(0,0,C,R); return; }
  const BANDS = 5;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const raw = grid[r][c] / mx;
    if (raw < 0.05) { const i=(r*C+c)*4; img.data[i+3]=0; continue; }
    const band = Math.min(BANDS-1, Math.floor(raw * BANDS));
    const bf = (band + 1) / BANDS;
    const i = (r * C + c) * 4;
    img.data[i] = 180 + 60 * bf | 0; img.data[i+1] = 50 + 30 * bf | 0; img.data[i+2] = 50 + 20 * bf | 0; img.data[i+3] = 30 + bf * 110 | 0;
  }
  octx.putImageData(img, 0, 0);
  const octx2 = oc.getContext('2d');
  octx2.strokeStyle = 'rgba(255,120,100,.35)'; octx2.lineWidth = 0.5;
  for (let r = 1; r < R; r++) for (let c = 1; c < C; c++) {
    const v = Math.floor(grid[r][c] / mx * BANDS);
    const vl = Math.floor(grid[r][c-1] / mx * BANDS);
    const vu = Math.floor(grid[r-1][c] / mx * BANDS);
    if (v !== vl || v !== vu) { octx2.beginPath(); octx2.rect(c, r, 1, 1); octx2.stroke(); }
  }
}

function ovCyan(t){ return [30+56*t|0, 80+42*t|0, 120+84*t|0, t*110|0]; }
function ovPurple(t){ return [120+77*t|0, 70+64*t|0, 130+62*t|0, t*100|0]; }

// ─── RENDER (rAF throttled) ───
let _renderScheduled = false;
function render(){
  if (_renderScheduled) return;
  _renderScheduled = true;
  requestAnimationFrame(_renderFrame);
}
function _renderFrame(){
  _renderScheduled = false;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offX, offY);
  ctx.scale(zoom, zoom);
  const worldW = gridW * CELL, worldH = gridH * CELL;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, worldW, worldH);

  ctx.imageSmoothingEnabled = true;
  if (document.getElementById('layResource').checked && overlayRes.width)
    ctx.drawImage(overlayRes, 0, 0, worldW, worldH);
  if (document.getElementById('layAntibiotic').checked && overlayAb.width)
    ctx.drawImage(overlayAb, 0, 0, worldW, worldH);
  if (document.getElementById('layBiofilm').checked && overlayBio.width)
    ctx.drawImage(overlayBio, 0, 0, worldW, worldH);
  if (document.getElementById('laySignal').checked && overlaySig.width)
    ctx.drawImage(overlaySig, 0, 0, worldW, worldH);

  if (zoom > 3) {
    ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .3;
    for (let i = 0; i <= gridW; i++) { ctx.beginPath(); ctx.moveTo(i*CELL, 0); ctx.lineTo(i*CELL, worldH); ctx.stroke(); }
    for (let i = 0; i <= gridH; i++) { ctx.beginPath(); ctx.moveTo(0, i*CELL); ctx.lineTo(worldW, i*CELL); ctx.stroke(); }
  }

  if (snapshot && snapshot.bacteria) {
    const r = CELL * 0.38;
    const vl = -offX / zoom / CELL - 2, vt = -offY / zoom / CELL - 2;
    const vr = (W - offX) / zoom / CELL + 2, vb = (H - offY) / zoom / CELL + 2;
    const bioRing = Math.max(.5, 1.2 / zoom);
    for (const b of snapshot.bacteria) {
      if (b[0] < vl || b[0] > vr || b[1] < vt || b[1] > vb) continue;
      const jx = b[0] + jitter(b, 0), jy = b[1] + jitter(b, 1);
      const cx = jx * CELL, cy = jy * CELL;
      const phase = b[3];
      const alpha = PHASE_ALPHA[phase] || 1;
      const col = GC[b[2] % GC.length];
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = col; ctx.fill();
      if (b[10]) { ctx.strokeStyle = 'rgba(0,122,204,.6)'; ctx.lineWidth = bioRing; ctx.stroke(); }
      ctx.globalAlpha = 1;
    }
    if (hovered) {
      const jx = hovered[0] + jitter(hovered, 0), jy = hovered[1] + jitter(hovered, 1);
      ctx.beginPath(); ctx.arc(jx * CELL, jy * CELL, CELL * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, 1.5 / zoom); ctx.stroke();
    }
  }
  ctx.restore();
}

document.querySelectorAll('#layersPanel input').forEach(el => el.addEventListener('change', ()=>{
  if(viewMode==='3d') render3D(); else render();
}));

// ─── Stats ───
function toggleStats(){
  const p = document.getElementById('statsPanel');
  p.classList.toggle('collapsed');
  document.getElementById('statsChev').textContent = p.classList.contains('collapsed') ? '▸' : '▾';
}

// Animated number update helper
function animateValue(el, newText){
  if(el.textContent !== newText){
    el.textContent = newText;
    el.classList.add('changed');
    setTimeout(()=> el.classList.remove('changed'), 600);
  }
}

// Sparkline renderer
function renderSparkline(svgId, data){
  const svg = document.getElementById(svgId);
  if(!svg || !data.length) return;
  const w = 48, h = 14;
  let mn = Infinity, mx = -Infinity;
  for(const v of data){ if(v<mn)mn=v; if(v>mx)mx=v; }
  const rng = mx - mn || 1;
  const pts = data.map((v,i) => `${(i/(data.length-1||1))*w},${h - ((v-mn)/rng)*h}`).join(' ');
  svg.innerHTML = `<polyline points="${pts}"/>`;
}

function updateStats(d){
  animateValue(document.getElementById('sPop'), d.total_population.toLocaleString());
  animateValue(document.getElementById('sFit'), d.mean_fitness);
  animateValue(document.getElementById('sRes'), d.mean_resource);
  animateValue(document.getElementById('sAb'), d.mean_antibiotic);
  animateValue(document.getElementById('sCoop'), d.cooperation_index);
  animateValue(document.getElementById('sComp'), d.competition_index);
  animateValue(document.getElementById('sBio'), (d.biofilm_fraction * 100).toFixed(1) + '%');
  animateValue(document.getElementById('sRst'), d.mean_resistance);
  animateValue(document.getElementById('sMut'), d.mutation_frequency);
  animateValue(document.getElementById('sHGT'), String(d.hgt_events));
  const cmArr = d.ts_cumulative_mutations || [];
  animateValue(document.getElementById('sCumMut'), cmArr.length ? cmArr[cmArr.length-1].toLocaleString() : '0');
  const chArr = d.ts_cumulative_hgt || [];
  animateValue(document.getElementById('sCumHGT'), chArr.length ? chArr[chArr.length-1].toLocaleString() : '0');
  const rcArr = d.ts_resource_consumed || [];
  animateValue(document.getElementById('sResCon'), rcArr.length ? Math.round(rcArr[rcArr.length-1]).toLocaleString() : '—');
  animateValue(document.getElementById('sGrowthMod'), d.growth_modifier != null ? d.growth_modifier : '—');
  animateValue(document.getElementById('sDiv'), String(d.divisions));
  animateValue(document.getElementById('sDth'), String(d.deaths));
  animateValue(document.getElementById('sGen'), String(Object.keys(d.genotype_counts || {}).length));
  // Persister stats
  const persEl = document.getElementById('sPersist');
  if(persEl) animateValue(persEl, d.persister_count != null ? String(d.persister_count) : '0');
  // RL stats
  if(d.rl_stats){
    document.getElementById('rlStatsBlock').style.display='block';
    animateValue(document.getElementById('sRLDev'), d.rl_stats.device||'—');
    animateValue(document.getElementById('sRLEps'), d.rl_stats.epsilon);
    animateValue(document.getElementById('sRLLoss'), d.rl_stats.avg_loss);
    animateValue(document.getElementById('sRLBuf'), d.rl_stats.buffer_size);
  } else { document.getElementById('rlStatsBlock').style.display='none'; }
  document.getElementById('epochNum').textContent = d.epoch;
  document.getElementById('epochDenom').textContent = '/ ' + d.total_epochs;
  const pct = d.total_epochs > 0 ? (d.epoch / d.total_epochs * 100) : 0;
  document.getElementById('progressBar').style.width = pct + '%';
  // Sparklines
  sparkData.pop.push(d.total_population);
  sparkData.fit.push(parseFloat(d.mean_fitness)||0);
  sparkData.rst.push(parseFloat(d.mean_resistance)||0);
  if(sparkData.pop.length > SPARK_MAX){ sparkData.pop.shift(); sparkData.fit.shift(); sparkData.rst.shift(); }
  renderSparkline('sparkPop', sparkData.pop);
  renderSparkline('sparkFit', sparkData.fit);
  renderSparkline('sparkRst', sparkData.rst);
}

// ─── Charts ───
const DL={paper_bgcolor:'#252526',plot_bgcolor:'#1e1e1e',font:{color:'#cccccc',size:10},margin:{t:8,r:16,b:32,l:44},xaxis:{gridcolor:'#333333',title:'Epoch'},yaxis:{gridcolor:'#333333'},legend:{bgcolor:'rgba(0,0,0,0)',font:{size:9}},showlegend:true,autosize:true};
const P={responsive:true,displayModeBar:false};
const CHART_IDS = ['cPopGeno','cPopRes','cCoopComp','cFitness','cPhases','cDemo','cMutHGT','cBioAb','cCumMut','cResCon'];
function initCharts(){ CHART_IDS.forEach(id => Plotly.newPlot(id, [], {...DL}, P)); }
initCharts();

function updateCharts(d){
  const ep = d.ts_epochs;
  const gt=[];
  if(d.ts_genotypes){const gs=Object.keys(d.ts_genotypes).sort((a,b)=>+a-+b);
    for(const g of gs)gt.push({x:ep,y:d.ts_genotypes[g],name:'G'+g,mode:'lines',line:{width:1.3,color:GC[+g%GC.length]}});}
  Plotly.react('cPopGeno',gt,{...DL,yaxis:{...DL.yaxis,title:'Pop'}});
  Plotly.react('cPopRes',[{x:ep,y:d.ts_population,name:'Pop',line:{color:'#569cd6',width:2}},{x:ep,y:d.ts_resource,name:'Res',yaxis:'y2',line:{color:'#608b4e',width:1.5,dash:'dot'}}],{...DL,yaxis:{...DL.yaxis,title:'Pop'},yaxis2:{gridcolor:'#333333',title:'Res',side:'right',overlaying:'y'}});
  Plotly.react('cCoopComp',[{x:ep,y:d.ts_cooperation,name:'Coop',line:{color:'#dcdcaa',width:2}},{x:ep,y:d.ts_competition,name:'Comp',line:{color:'#d16969',width:2}}],{...DL,yaxis:{...DL.yaxis,title:'Index'}});
  Plotly.react('cFitness',[{x:ep,y:d.ts_fitness,name:'Fitness',line:{color:'#569cd6',width:2}},{x:ep,y:d.ts_resistance,name:'Resist',line:{color:'#c586c0',width:1.5,dash:'dash'}}],{...DL,yaxis:{...DL.yaxis,title:'Val'}});
  Plotly.react('cPhases',[
    {x:ep,y:d.ts_phase_lag,name:'Lag',stackgroup:'p',line:{width:0},fillcolor:'rgba(86,156,214,.3)'},
    {x:ep,y:d.ts_phase_log,name:'Log',stackgroup:'p',line:{width:0},fillcolor:'rgba(96,139,78,.3)'},
    {x:ep,y:d.ts_phase_stat,name:'Stat',stackgroup:'p',line:{width:0},fillcolor:'rgba(220,220,170,.3)'},
    {x:ep,y:d.ts_phase_death,name:'Death',stackgroup:'p',line:{width:0},fillcolor:'rgba(209,105,105,.3)'}
  ],{...DL,yaxis:{...DL.yaxis,title:'Count'}});
  Plotly.react('cDemo',[{x:ep,y:d.ts_divisions,name:'Div',type:'bar',marker:{color:'rgba(96,139,78,.5)'}},{x:ep,y:d.ts_deaths,name:'Death',type:'bar',marker:{color:'rgba(209,105,105,.5)'}}],{...DL,barmode:'group',yaxis:{...DL.yaxis,title:'N'}});
  Plotly.react('cMutHGT',[{x:ep,y:d.ts_mutation,name:'Mut',line:{color:'#dcdcaa',width:2}},{x:ep,y:d.ts_hgt,name:'HGT',yaxis:'y2',line:{color:'#c586c0',width:1.5,dash:'dash'}}],{...DL,yaxis:{...DL.yaxis,title:'Freq'},yaxis2:{gridcolor:'#333333',title:'HGT',side:'right',overlaying:'y'}});
  Plotly.react('cBioAb',[{x:ep,y:d.ts_biofilm,name:'Biofilm',line:{color:'#569cd6',width:2}},{x:ep,y:d.ts_antibiotic,name:'Antibiotic',yaxis:'y2',line:{color:'#d16969',width:1.5,dash:'dot'}}],{...DL,yaxis:{...DL.yaxis,title:'Biofilm%'},yaxis2:{gridcolor:'#333333',title:'Ab',side:'right',overlaying:'y'}});
  Plotly.react('cCumMut',[{x:ep,y:d.ts_cumulative_mutations||[],name:'Σ Mutations',line:{color:'#dcdcaa',width:2}},{x:ep,y:d.ts_cumulative_hgt||[],name:'Σ HGT',yaxis:'y2',line:{color:'#c586c0',width:1.5,dash:'dash'}}],{...DL,yaxis:{...DL.yaxis,title:'Cumulative Mutations'},yaxis2:{gridcolor:'#333333',title:'Cum HGT',side:'right',overlaying:'y'}});
  Plotly.react('cResCon',[{x:ep,y:d.ts_resource_consumed||[],name:'Total Consumed',fill:'tozeroy',line:{color:'#608b4e',width:2},fillcolor:'rgba(96,139,78,.15)'}],{...DL,yaxis:{...DL.yaxis,title:'Resource Units'}});
}

// ─── 3D View Mode ───
let viewMode = '2d';
let world3dInit = false;
let _camera3d = null;

function toggleViewMode(){
  if(simState !== 'idle') return;
  viewMode = viewMode === '2d' ? '3d' : '2d';
  const btn = document.getElementById('btnViewMode');
  const c = document.getElementById('world');
  const d3 = document.getElementById('world3d');
  const gizmo = document.getElementById('gizmo3d');
  btn.textContent = viewMode.toUpperCase();
  if(viewMode === '3d'){
    c.style.display = 'none'; d3.style.display = 'block'; gizmo.style.display = 'block'; render3D();
  } else {
    c.style.display = 'block'; d3.style.display = 'none'; gizmo.style.display = 'none'; render();
  }
}

function _hookCameraRelay(){
  const el = document.getElementById('world3d');
  el.on('plotly_relayout', function(ed){
    if(ed['scene.camera']) _camera3d = ed['scene.camera'];
    else {
      const cam = {}; let found = false;
      for(const k of Object.keys(ed)){
        if(k.startsWith('scene.camera.')){
          const sub = k.replace('scene.camera.','');
          const parts = sub.split('.');
          let obj = cam;
          for(let i=0;i<parts.length-1;i++){ if(!obj[parts[i]]) obj[parts[i]]={}; obj=obj[parts[i]]; }
          obj[parts[parts.length-1]] = ed[k]; found = true;
        }
      }
      if(found) _camera3d = cam;
    }
  });
}

const GIZMO_VIEWS = {
  front:{eye:{x:0,y:-2.2,z:0.3},up:{x:0,y:0,z:1}}, back:{eye:{x:0,y:2.2,z:0.3},up:{x:0,y:0,z:1}},
  left:{eye:{x:-2.2,y:0,z:0.3},up:{x:0,y:0,z:1}}, right:{eye:{x:2.2,y:0,z:0.3},up:{x:0,y:0,z:1}},
  top:{eye:{x:0,y:0,z:2.5},up:{x:0,y:1,z:0}}, bottom:{eye:{x:0,y:0,z:-2.5},up:{x:0,y:-1,z:0}},
  iso:{eye:{x:1.5,y:-1.5,z:1.2},up:{x:0,y:0,z:1}}, zAxis:{eye:{x:0.01,y:-0.01,z:2.5},up:{x:0,y:1,z:0}},
  home:{eye:{x:1.25,y:1.25,z:1.25},up:{x:0,y:0,z:1}},
};
function gizmoView(name){
  const v = GIZMO_VIEWS[name]; if(!v) return;
  _camera3d = {eye:v.eye, up:v.up, center:{x:0,y:0,z:0}};
  Plotly.relayout('world3d',{'scene.camera': _camera3d});
}

function render3D(){
  if(!snapshot) return;
  const traces = [];
  if(snapshot.bacteria && snapshot.bacteria.length){
    const bx=[],by=[],bz=[],bc=[],bsz=[],bt=[];
    for(const b of snapshot.bacteria){
      bx.push(b[0]); by.push(b[1]); bz.push(b[12]||0);
      bc.push(GC[b[2]%GC.length]);
      bsz.push(Math.max(2, Math.min(6, b[5]*4)));
      bt.push('<b style="color:'+GC[b[2]%GC.length]+'">Genotype '+b[2]+'</b><br>'
        +'Phase: '+PHASE_NAMES[b[3]]+'<br>Fitness: '+b[4]+'<br>Biomass: '+b[5]
        +'<br>Resistance: '+b[6]+'<br>Efficiency: '+b[7]+'<br>Toxin Prod: '+b[8]
        +'<br>Public Good: '+b[9]+'<br>Biofilm: '+(b[10]?'Yes':'No')+'<br>Age: '+b[11]+'<br>Z-Depth: '+(b[12]||0));
    }
    traces.push({type:'scatter3d',mode:'markers',x:bx,y:by,z:bz,text:bt,hoverinfo:'text',
      marker:{size:bsz,color:bc,opacity:0.8,line:{width:0.5,color:'rgba(255,255,255,0.15)'}},name:'Bacteria'});
  }
  // Resource/Antibiotic/Biofilm/Signal overlays
  const overlayConfigs = [
    {grid:snapshot.resource_grid, id:'layResource', color:'#b5e61d', sym:'circle', z:-0.3, name:'Resource'},
    {grid:snapshot.antibiotic_grid, id:'layAntibiotic', color:'#ff8c00', sym:'diamond', z:-0.5, name:'Antibiotic'},
    {grid:snapshot.biofilm_grid, id:'layBiofilm', color:'#00e5ff', sym:'square', z:-0.2, name:'Biofilm'},
    {grid:snapshot.signal_grid, id:'laySignal', color:'#ff00ff', sym:'cross', z:-0.4, name:'Signal'},
  ];
  for(const ov of overlayConfigs){
    if(!ov.grid || !document.getElementById(ov.id).checked) continue;
    const g=ov.grid, R=g.length, C=g[0].length;
    const ox=[],oy=[],oz=[],oht=[];
    const step=Math.max(1,Math.floor(Math.min(R,C)/25));
    let mx=0;
    for(let r=0;r<R;r+=step) for(let c=0;c<C;c+=step){ if(g[r][c]>mx) mx=g[r][c]; }
    if(mx<0.01) continue;
    for(let r=0;r<R;r+=step) for(let c=0;c<C;c+=step){
      const v=g[r][c]/mx; if(v<0.08) continue;
      ox.push(c*(gridW/C)); oy.push(r*(gridH/R)); oz.push(ov.z);
      oht.push(ov.name+': '+(g[r][c]).toFixed(2));
    }
    if(ox.length) traces.push({type:'scatter3d',mode:'markers',x:ox,y:oy,z:oz,text:oht,hoverinfo:'text',
      marker:{size:2.5,color:ov.color,opacity:0.6,symbol:ov.sym},showlegend:false,name:ov.name});
  }
  if(!traces.length) return;
  const zMax = parseInt(document.getElementById('cfgZLevels').value)||10;
  const layout3d = {paper_bgcolor:'#1a1a1a',plot_bgcolor:'#1a1a1a',font:{color:'#cccccc',size:10},margin:{t:0,r:0,b:0,l:0},
    scene:{xaxis:{title:'X',gridcolor:'#333',color:'#888',range:[0,gridW]},yaxis:{title:'Y',gridcolor:'#333',color:'#888',range:[0,gridH]},
      zaxis:{title:'Depth',gridcolor:'#333',color:'#888',range:[-1,zMax]},bgcolor:'#1a1a1a',camera:_camera3d||GIZMO_VIEWS.home},
    showlegend:false,autosize:true,hoverlabel:{bgcolor:'#252526',bordercolor:'#454545',font:{family:'Segoe UI',size:11,color:'#ccc'}}};
  Plotly.react('world3d',traces,layout3d,{responsive:true,displayModeBar:false});
  if(!world3dInit){ world3dInit = true; _hookCameraRelay(); }
}

// ─── Modals ───
function openModal(name){
  document.getElementById('modal-'+name).classList.add('open');
  if(name==='charts') setTimeout(()=>{ CHART_IDS.forEach(id=>Plotly.Plots.resize(id)); if(snapshot) updateCharts(snapshot); }, 80);
}
function closeModal(name){ document.getElementById('modal-'+name).classList.remove('open'); }
document.querySelectorAll('.modal-bg').forEach(el => el.addEventListener('click', e => { if(e.target===el) el.classList.remove('open'); }));

// ─── Loading skeleton ───
function hideSkeleton(){
  const sk = document.getElementById('loadingSkeleton');
  if(sk) sk.classList.add('hidden');
}

// ─── Snapshot handling ───
function applySnapshot(d){
  snapshot = d;
  hideSkeleton();
  if (d.grid_w) gridW = d.grid_w;
  if (d.grid_h) gridH = d.grid_h;
  buildResourceOverlay(overlayRes, d.resource_grid);
  buildAntibioticOverlay(overlayAb, d.antibiotic_grid);
  buildOverlay(overlayBio, d.biofilm_grid, ovCyan);
  buildOverlay(overlaySig, d.signal_grid, ovPurple);
  updateStats(d);
  if(viewMode === '3d') render3D(); else render();
  if (document.getElementById('modal-charts').classList.contains('open')) updateCharts(d);
}

socket.on('snapshot', d => { applySnapshot(d); });

// HTTP polling
let _pullTimer = null, _lastPulledEpoch = -1, _fetchInFlight = false;
function fetchSnapshot(){
  if(_fetchInFlight) return;
  _fetchInFlight = true;
  fetch('/api/snapshot')
    .then(r => { if(r.ok && r.status===200) return r.json(); return null; })
    .then(d => { _fetchInFlight = false; if(!d || !d.epoch) return; if(d.epoch === _lastPulledEpoch) return; _lastPulledEpoch = d.epoch; applySnapshot(d); })
    .catch(()=>{ _fetchInFlight = false; });
}
function startSnapshotPull(){ if(_pullTimer) return; _pullTimer = setInterval(fetchSnapshot, 200); }
function stopSnapshotPull(){ if(_pullTimer){ clearInterval(_pullTimer); _pullTimer = null; } fetchSnapshot(); }

socket.on('epoch_tick', d => {
  document.getElementById('epochNum').textContent = d.epoch;
  const pct = d.total > 0 ? (d.epoch / d.total * 100) : 0;
  document.getElementById('progressBar').style.width = pct + '%';
});

let simState = 'idle';
socket.on('status', d => {
  const badge = document.getElementById('statusBadge');
  const pp = document.getElementById('btnPlayPause'), bT = document.getElementById('btnStop');
  const vmBtn = document.getElementById('btnViewMode');
  if (d.running && !d.paused) {
    simState='running'; badge.className='status s-run'; badge.textContent='running';
    pp.innerHTML='⏸'; pp.title='Pause'; bT.disabled=false;
    vmBtn.disabled=true; vmBtn.style.opacity='.4'; vmBtn.title='Cannot change during simulation';
    _lastPulledEpoch = -1; startSnapshotPull();
  } else if (d.running && d.paused) {
    simState='paused'; badge.className='status s-pause'; badge.textContent='paused';
    pp.innerHTML='▶'; pp.title='Resume'; bT.disabled=false;
    vmBtn.disabled=true; vmBtn.style.opacity='.4'; vmBtn.title='Cannot change during simulation';
    stopSnapshotPull();
  } else {
    simState='idle'; badge.className='status s-idle'; badge.textContent='idle';
    pp.innerHTML='▶'; pp.title='Start'; bT.disabled=true;
    vmBtn.disabled=false; vmBtn.style.opacity='1'; vmBtn.title='Switch between 2D and 3D view';
    stopSnapshotPull();
  }
});

socket.on('sim_complete', () => {
  const btn = document.getElementById('btnReport');
  if(btn){ btn.style.opacity='1'; btn.style.pointerEvents='auto'; btn.title='Download report (charts + CSV)'; }
  fetchSnapshot();
});

socket.on('log', d => {
  const box = document.getElementById('logBox');
  box.innerHTML += `<p><span class="ts">[${new Date().toLocaleTimeString()}]</span> ${d.msg}</p>`;
  box.scrollTop = box.scrollHeight;
});

socket.on('config_defaults', cfg => {
  if(cfg.simulation) document.getElementById('cfgEpochs').value = cfg.simulation.epochs || 200;
  if(cfg.bacterium) document.getElementById('cfgInitPop').value = cfg.bacterium.initial_count || 300;
  if(cfg.population) document.getElementById('cfgCapacity').value = cfg.population.carrying_capacity || 10000;
  if(cfg.mutation) document.getElementById('cfgMutation').value = cfg.mutation.rate || 0.01;
  if(cfg.antibiotic) document.getElementById('cfgABStart').value = cfg.antibiotic.start_epoch || 60;
  if(cfg.simulation && cfg.simulation.seed != null) document.getElementById('cfgSeed').value = cfg.simulation.seed;
  if(cfg.grid){ document.getElementById('cfgGridW').value = cfg.grid.width||200; document.getElementById('cfgGridH').value = cfg.grid.height||200; document.getElementById('cfgZLevels').value = cfg.grid.z_levels||10; }
  if(cfg.physics){ document.getElementById('cfgTemp').value = cfg.physics.temperature||37; document.getElementById('cfgPressure').value = cfg.physics.pressure_atm||1; document.getElementById('cfgPH').value = cfg.physics.ph||7; }
  if(cfg.rl){ document.getElementById('cfgRLEnabled').checked = cfg.rl.enabled !== false; document.getElementById('cfgForceCPU').checked = !!cfg.rl.force_cpu; }
});

socket.on('gpu_info', info => {
  const badge = document.getElementById('gpuBadge');
  if(info && (info.cuda_available || info.mps_available)){
    badge.style.display='inline'; badge.textContent = 'GPU: '+(info.gpu_name || info.device);
    badge.title = 'Memory: '+(info.gpu_memory_mb ? info.gpu_memory_mb+'MB' : 'N/A')+' | Torch '+info.torch_version;
  } else {
    badge.style.display='inline'; badge.textContent = 'CPU';
    badge.style.background='rgba(209,105,105,.2)'; badge.style.color='#d16969';
    badge.title = 'No GPU detected — Torch '+info.torch_version;
    document.getElementById('cfgForceCPU').checked = true; document.getElementById('cfgForceCPU').disabled = true;
  }
});

// ─── Controls ───
function startSim(){
  socket.emit('start', {
    epochs: document.getElementById('cfgEpochs').value,
    initial_count: document.getElementById('cfgInitPop').value,
    carrying_capacity: document.getElementById('cfgCapacity').value,
    resource_scenario: document.getElementById('cfgResource').value,
    antibiotic_mode: document.getElementById('cfgABMode').value,
    antibiotic_start: document.getElementById('cfgABStart').value,
    mutation_rate: document.getElementById('cfgMutation').value,
    seed: document.getElementById('cfgSeed').value || null,
    grid_width: document.getElementById('cfgGridW').value,
    grid_height: document.getElementById('cfgGridH').value,
    z_levels: document.getElementById('cfgZLevels').value,
    temperature: document.getElementById('cfgTemp').value,
    pressure_atm: document.getElementById('cfgPressure').value,
    ph: document.getElementById('cfgPH').value,
    rl_enabled: document.getElementById('cfgRLEnabled').checked,
    force_cpu: document.getElementById('cfgForceCPU').checked,
    view_mode: viewMode,
    speed: parseFloat(document.getElementById('speedSlider').value) / 1000,
    update_interval: document.getElementById('intervalSlider').value,
  });
}
function startFromSettings(){ closeModal('settings'); startSim(); }
function togglePlayPause(){
  if (simState === 'idle') startSim();
  else if (simState === 'running') socket.emit('pause');
  else if (simState === 'paused') socket.emit('pause');
}
function stopSim(){ socket.emit('stop'); }
function setSpeed(v){
  const s = parseFloat(v) / 1000;
  document.getElementById('speedLabel').textContent = s.toFixed(3) + 's';
  socket.emit('set_speed', {value: s});
}
function setInterval2(v){
  document.getElementById('intervalLabel').textContent = v;
  socket.emit('set_update_interval', {value: v});
}
function downloadReport(){
  const a = document.createElement('a');
  a.href = '/report'; a.download = 'simulation_report.zip';
  document.body.appendChild(a); a.click(); a.remove();
}

// ─── Keyboard Shortcuts ───
document.addEventListener('keydown', e => {
  // Ignore if typing in an input
  if(e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  switch(e.key){
    case ' ': e.preventDefault(); togglePlayPause(); break;
    case 's': case 'S': if(!e.ctrlKey && !e.metaKey) openModal('settings'); break;
    case 'c': case 'C': if(!e.ctrlKey && !e.metaKey) openModal('charts'); break;
    case 'Escape':
      document.querySelectorAll('.modal-bg.open').forEach(el => el.classList.remove('open'));
      break;
  }
});

// ─── Shareable config link ───
function getShareableLink(){
  const params = new URLSearchParams({
    epochs: document.getElementById('cfgEpochs').value,
    pop: document.getElementById('cfgInitPop').value,
    cap: document.getElementById('cfgCapacity').value,
    mut: document.getElementById('cfgMutation').value,
    ab: document.getElementById('cfgABMode').value,
    abs: document.getElementById('cfgABStart').value,
    seed: document.getElementById('cfgSeed').value,
    gw: document.getElementById('cfgGridW').value,
    gh: document.getElementById('cfgGridH').value,
    z: document.getElementById('cfgZLevels').value,
    t: document.getElementById('cfgTemp').value,
    p: document.getElementById('cfgPressure').value,
    ph: document.getElementById('cfgPH').value,
    rl: document.getElementById('cfgRLEnabled').checked?1:0,
  });
  return window.location.origin + '?' + params.toString();
}
function loadFromURL(){
  const params = new URLSearchParams(window.location.search);
  if(!params.has('epochs')) return;
  const map = {epochs:'cfgEpochs',pop:'cfgInitPop',cap:'cfgCapacity',mut:'cfgMutation',ab:'cfgABMode',abs:'cfgABStart',seed:'cfgSeed',gw:'cfgGridW',gh:'cfgGridH',z:'cfgZLevels',t:'cfgTemp',p:'cfgPressure',ph:'cfgPH'};
  for(const [k,id] of Object.entries(map)){ if(params.has(k)) document.getElementById(id).value=params.get(k); }
  if(params.has('rl')) document.getElementById('cfgRLEnabled').checked = params.get('rl')==='1';
}

// Init
loadFromURL();
fitView();
resizeCanvas();
fetchSnapshot();
