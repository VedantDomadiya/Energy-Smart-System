/* ================================================================
   Energy-Smart Stadium — app.js
   - Connects to /ws if available, otherwise drives a realistic
     simulation so the hackathon demo runs standalone.
   ================================================================ */

(() => {
  'use strict';

  const ZONE_META = [
    { id: 'north', name: 'North Stand',  short: 'N', cap: 15000, anchor: { x: 500, y: 180 }, kind: 'stand' },
    { id: 'south', name: 'South Stand',  short: 'S', cap: 15000, anchor: { x: 500, y: 560 }, kind: 'stand' },
    { id: 'west',  name: 'West Stand',   short: 'W', cap: 12000, anchor: { x: 180, y: 360 }, kind: 'stand' },
    { id: 'east',  name: 'East Stand',   short: 'E', cap: 12000, anchor: { x: 820, y: 360 }, kind: 'stand' },
    { id: 'conA',  name: 'Concourse A',  short: 'A', cap:  3000, anchor: { x: 500, y: 100 }, kind: 'concourse' },
    { id: 'conB',  name: 'Concourse B',  short: 'B', cap:  3000, anchor: { x: 500, y: 620 }, kind: 'concourse' },
    { id: 'food',  name: 'Food Court',   short: 'F', cap:  2000, anchor: { x: 100, y: 360 }, kind: 'support' },
    { id: 'rest',  name: 'Restrooms',    short: 'R', cap:   800, anchor: { x: 900, y: 360 }, kind: 'support' },
  ];

  const PHASES = ['Pre-Game', 'First Half', 'Halftime', 'Second Half', 'Post-Game'];
  const MATCH_SECONDS = 120;

  const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const tweens = new WeakMap();
  function tween(el, to, fmt) {
    const from = tweens.get(el) ?? 0;
    const start = performance.now();
    const dur = 450;
    cancelAnimationFrame(el._raf || 0);
    function step(t) {
      const p = Math.min(1, (t - start) / dur);
      const k = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * k;
      el.textContent = fmt(v);
      if (p < 1) el._raf = requestAnimationFrame(step);
      else tweens.set(el, to);
    }
    el._raf = requestAnimationFrame(step);
  }

  const $ = (s) => document.querySelector(s);
  const els = {
    clock:       $('#clock'),
    tickLabel:   $('#tickLabel'),
    phaseFill:   $('#phaseFill'),
    phaseCursor: $('#phaseCursor'),
    phases:      document.querySelectorAll('#phases li'),

    heroStatus:  $('#heroStatus'),
    heroSaved:   $('#heroSaved'),
    heroPct:     $('#heroPct'),
    heroPhase:   $('#heroPhase'),
    heroBaseline:$('#heroBaseline'),
    heroBarSmart:$('#heroBarSmart'),
    heroInr:     $('#heroInr'),
    heroCo2:     $('#heroCo2'),
    heroLoad:    $('#heroLoad'),
    heroLoadBase:$('#heroLoadBase'),
    heroLoadDelta:$('#heroLoadDelta'),

    zones:       $('#zones'),
    zoneLabels:  $('#zoneLabels'),
    ztip:        $('#ztip'),

    chartGap:    $('#chartGap'),
    peakBase:    $('#peakBase'),
    peakSmart:   $('#peakSmart'),
    cumSaved:    $('#cumSaved'),

    ztableBody:  $('#ztableBody'),
    sortChips:   document.querySelectorAll('[data-sort]'),
  };

  function mountZoneLabels() {
    const ns = 'http://www.w3.org/2000/svg';
    ZONE_META.forEach(z => {
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('data-zid', z.id);
      g.setAttribute('transform', `translate(${z.anchor.x}, ${z.anchor.y})`);
      g.innerHTML = `
        <text class="zl-pct"  x="0" y="-4" text-anchor="middle"><tspan>0%</tspan></text>
        <text class="zl-name" x="0" y="14" text-anchor="middle">${z.name}</text>
        <text class="zl-sub"  x="0" y="28" text-anchor="middle"><tspan>0 / ${nf0.format(z.cap)}</tspan></text>
      `;
      els.zoneLabels.appendChild(g);
    });
  }

  function zoneState(z) {
    const occ = z.occupancy_pct;
    const ratio = z.baseline_kw > 0 ? z.smart_kw / z.baseline_kw : 1;
    if (occ > 70 || ratio > 0.85) return 'hot';
    if (occ > 30 || ratio > 0.55) return 'warm';
    return 'calm';
  }

  function updateStadium(zones) {
    zones.forEach(z => {
      const shape = els.zones.querySelector(`[data-zid="${z.id}"]`);
      const label = els.zoneLabels.querySelector(`[data-zid="${z.id}"]`);
      if (!shape || !label) return;
      const state = zoneState(z);
      shape.setAttribute('data-state', state);
      const pctEl = label.querySelector('.zl-pct tspan');
      const subEl = label.querySelector('.zl-sub tspan');
      pctEl.textContent = `${z.occupancy_pct.toFixed(0)}%`;
      subEl.textContent = `${nf0.format(z.occupancy)} / ${nf0.format(z.capacity)}`;
    });
  }

  function mountZoneTooltip(getZones) {
    const tip = els.ztip;
    const stadium = $('#stadium');
    stadium.addEventListener('mousemove', (e) => {
      const g = e.target.closest('.zone') || e.target.closest('[data-zid]');
      if (!g) { tip.hidden = true; return; }
      const zid = g.getAttribute('data-zid');
      const z = getZones().find(x => x.id === zid);
      if (!z) { tip.hidden = true; return; }
      const rect = stadium.getBoundingClientRect();
      tip.hidden = false;
      tip.style.left = (e.clientX - rect.left) + 'px';
      tip.style.top  = (e.clientY - rect.top - 10) + 'px';
      tip.querySelector('.ztip__name').textContent = z.name;
      tip.querySelector('.ztip__pct').textContent = `${z.occupancy_pct.toFixed(1)}%`;
      tip.querySelector('.ztip__rows').innerHTML = `
        <span>Occupancy</span><span>${nf0.format(z.occupancy)} / ${nf0.format(z.capacity)}</span>
        <span>Baseline</span><span>${z.baseline_kw.toFixed(1)} kW</span>
        <span>Smart</span><span>${z.smart_kw.toFixed(1)} kW</span>
        <span>Saved</span><span style="color:var(--good)">${(z.baseline_kw - z.smart_kw).toFixed(1)} kW</span>
        <span>Lighting</span><span>${z.lighting_pct}%</span>
        <span>HVAC</span><span>${z.hvac_pct}%</span>
        <span>Screens</span><span>${z.screens_on ? 'on' : 'off'}</span>
      `;
    });
    stadium.addEventListener('mouseleave', () => { tip.hidden = true; });
  }

  function updateHero(msg) {
    const t = msg.totals;
    tween(els.heroSaved, t.saved_kwh, v => nf2.format(v));
    els.heroPct.textContent = `${nf1.format(t.saved_pct)}%`;
    els.heroPhase.textContent = msg.phase;
    els.heroBaseline.textContent = nf1.format(t.baseline_kwh);
    tween(els.heroInr, t.saved_inr, v => nf0.format(v));
    tween(els.heroCo2, t.co2_kg, v => nf1.format(v));

    const curSmart = msg.zones.reduce((s, z) => s + z.smart_kw, 0);
    const curBase  = msg.zones.reduce((s, z) => s + z.baseline_kw, 0);
    tween(els.heroLoad, curSmart, v => nf0.format(v));
    els.heroLoadBase.textContent = nf0.format(curBase);
    const delta = curSmart - curBase;
    els.heroLoadDelta.textContent = `${delta <= 0 ? '−' : '+'}${nf0.format(Math.abs(delta))} kW`;
    els.heroLoadDelta.className = 'delta ' + (delta <= 0 ? 'delta--good' : 'delta--bad');

    const ratio = t.baseline_kwh > 0 ? (t.baseline_kwh - t.saved_kwh) / t.baseline_kwh : 1;
    els.heroBarSmart.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;

    const statusByPhase = {
      'Pre-Game': 'PRE-COOLING',
      'First Half': 'OPTIMIZING',
      'Halftime': 'SURGE ACTIVE',
      'Second Half': 'OPTIMIZING',
      'Post-Game': 'WIND-DOWN',
    };
    els.heroStatus.textContent = statusByPhase[msg.phase] || 'OPTIMIZING';
  }

  function updatePhase(phase, elapsed) {
    const idx = PHASES.indexOf(phase);
    els.phases.forEach((li, i) => li.setAttribute('data-active', i === idx));
    const pct = Math.min(1, elapsed / MATCH_SECONDS);
    els.phaseFill.style.width = `${pct * 100}%`;
    els.phaseCursor.style.left = `${pct * 100}%`;

    const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const ss = Math.floor(elapsed % 60).toString().padStart(2, '0');
    els.clock.textContent = `${mm}:${ss}`;
  }

  const chart = (() => {
    const ctx = document.getElementById('loadChart').getContext('2d');
    const labels = Array.from({ length: 60 }, (_, i) => i - 59);
    const common = { borderWidth: 2, pointRadius: 0, tension: 0.35, spanGaps: true };
    const ch = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Baseline gap', data: new Array(60).fill(null),
            backgroundColor: (ctx2) => {
              const {chart} = ctx2;
              const {ctx: c, chartArea} = chart;
              if (!chartArea) return 'rgba(53,212,154,0.0)';
              const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              g.addColorStop(0, 'rgba(53,212,154,0.32)');
              g.addColorStop(1, 'rgba(53,212,154,0.02)');
              return g;
            },
            borderColor: 'rgba(53,212,154,0.35)',
            borderWidth: 0, pointRadius: 0, tension: 0.35, fill: '+1',
            order: 3,
          },
          { label: 'Smart', data: new Array(60).fill(null),
            borderColor: '#46d4ff',
            backgroundColor: 'rgba(70,212,255,0.0)',
            ...common, order: 2,
            borderCapStyle: 'round', borderJoinStyle: 'round',
          },
          { label: 'Baseline', data: new Array(60).fill(null),
            borderColor: '#ff7a59',
            borderDash: [4, 4],
            ...common, order: 1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(14,18,26,0.95)',
            borderColor: '#262e3d', borderWidth: 1,
            titleColor: '#e9edf3', bodyColor: '#b6bdcb',
            padding: 10, boxPadding: 4,
            callbacks: {
              title: (it) => `t ${it[0].label}s`,
              label: (it) => {
                if (it.dataset.label === 'Baseline gap') return null;
                return `${it.dataset.label}: ${it.parsed.y.toFixed(0)} kW`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#7b8393', font: { family: 'Geist Mono', size: 10 },
              maxTicksLimit: 7,
              callback: (v, i) => (i % 10 === 0 ? `${labels[i]}s` : ''),
            },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.04)' },
            ticks: {
              color: '#7b8393', font: { family: 'Geist Mono', size: 10 },
              callback: (v) => `${v} kW`,
            },
            border: { display: false },
          },
        },
      },
    });
    return ch;
  })();

  const chartBuf = { base: [], smart: [] };
  function pushChart(baseKw, smartKw) {
    chartBuf.base.push(baseKw);
    chartBuf.smart.push(smartKw);
    if (chartBuf.base.length > 60) chartBuf.base.shift();
    if (chartBuf.smart.length > 60) chartBuf.smart.shift();

    const padL = 60 - chartBuf.base.length;
    const basePadded  = new Array(padL).fill(null).concat(chartBuf.base);
    const smartPadded = new Array(padL).fill(null).concat(chartBuf.smart);

    chart.data.datasets[0].data = basePadded;
    chart.data.datasets[1].data = smartPadded;
    chart.data.datasets[2].data = basePadded;
    chart.update('none');

    const pb = Math.max(...chartBuf.base);
    const ps = Math.max(...chartBuf.smart);
    els.peakBase.textContent  = `${nf0.format(pb)} kW`;
    els.peakSmart.textContent = `${nf0.format(ps)} kW`;
    const gap = basePadded.reduce((a, v, i) => {
      if (v == null || smartPadded[i] == null) return a;
      return a + Math.max(0, v - smartPadded[i]);
    }, 0) / 3600;
    els.cumSaved.textContent = `${nf2.format(gap * 60)} kWh`;

    const gapPct = pb > 0 ? ((pb - ps) / pb) * 100 : 0;
    els.chartGap.textContent = `${nf0.format(gapPct)}%`;
  }

  let sortMode = 'impact';
  els.sortChips.forEach(c => c.addEventListener('click', () => {
    els.sortChips.forEach(x => x.classList.toggle('chip--on', x === c));
    sortMode = c.getAttribute('data-sort');
    if (lastMsg) renderTable(lastMsg.zones);
  }));

  function renderTable(zones) {
    const sorted = [...zones];
    if (sortMode === 'impact') sorted.sort((a, b) => (b.baseline_kw - b.smart_kw) - (a.baseline_kw - a.smart_kw));
    else if (sortMode === 'occ') sorted.sort((a, b) => b.occupancy_pct - a.occupancy_pct);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));

    const frag = document.createDocumentFragment();
    sorted.forEach(z => {
      const state = zoneState(z);
      const saved = z.baseline_kw - z.smart_kw;
      const pct = Math.max(0, Math.min(100, z.occupancy_pct));
      const capLabel = ZONE_META.find(m => m.id === z.id)?.cap || z.capacity;
      const row = document.createElement('div');
      row.className = 'ztable__row';
      row.setAttribute('role', 'row');
      row.innerHTML = `
        <div class="zr-name">
          <span class="zr-name__dot" style="background:${state === 'hot' ? 'var(--bad)' : state === 'warm' ? 'var(--warn)' : 'var(--good)'}"></span>
          <span class="zr-name__txt">
            <span class="zr-name__primary">${z.name}</span>
            <span class="zr-name__sub">${nf0.format(z.occupancy)} / ${nf0.format(z.capacity ?? capLabel)}</span>
          </span>
        </div>
        <div class="zr-occ">
          <div class="zr-occ__top"><span>${z.occupancy_pct.toFixed(1)}%</span><span>${state}</span></div>
          <div class="zr-occ__bar"><div class="zr-occ__fill zr-occ__fill--${state}" style="width:${pct}%"></div></div>
        </div>
        <div class="zr-load">
          <span class="zr-load__base">${z.baseline_kw.toFixed(0)} kW</span>
          <span class="zr-load__smart">${z.smart_kw.toFixed(0)} kW</span>
        </div>
        <div class="zr-saved ${saved < 0.5 ? 'zr-saved--zero' : ''}">${saved >= 0.5 ? '−' + saved.toFixed(1) : '0.0'} kW</div>
        <div class="zr-ctrl ${ctrlClass(z.lighting_pct)}">${z.lighting_pct}%</div>
        <div class="zr-ctrl ${ctrlClass(z.hvac_pct)}">${z.hvac_pct}%</div>
        <div class="zr-ctrl ${z.screens_on ? 'zr-ctrl--hi' : 'zr-ctrl--off'}">${z.screens_on ? 'on' : 'off'}</div>
        <div class="zr-fore">${forecastBars(z.prediction || [], z.capacity ?? capLabel)}</div>
        <div class="zr-adv ${adviceClass(z.advice)}">
          <span class="zr-adv__icon">${adviceIcon(z.advice)}</span>
          <span>${z.advice || 'Stable — maintain setpoints'}</span>
        </div>
      `;
      frag.appendChild(row);
    });
    els.ztableBody.replaceChildren(frag);
  }

  function ctrlClass(pct) {
    if (pct >= 90) return 'zr-ctrl--hi';
    if (pct >= 50) return 'zr-ctrl--mid';
    if (pct > 0)   return 'zr-ctrl--lo';
    return 'zr-ctrl--off';
  }
  function forecastBars(pred, cap) {
    if (!pred || !pred.length) return '';
    const maxV = Math.max(cap, ...pred) || 1;
    return pred.slice(0, 15).map(v => {
      const h = Math.max(3, (v / maxV) * 100);
      const color = v / cap > 0.7 ? 'var(--bad)' : v / cap > 0.3 ? 'var(--warn)' : 'var(--good)';
      return `<div class="zr-fore__bar" style="height:${h}%;background:${color}"></div>`;
    }).join('');
  }
  function adviceClass(s) {
    if (!s) return '';
    if (/surge|peak|alert|pre-cool/i.test(s)) return 'zr-adv--alert';
    if (/critical|shed/i.test(s)) return 'zr-adv--critical';
    return '';
  }
  function adviceIcon(s) {
    if (!s) return '✓';
    if (/surge|pre-cool|peak/i.test(s)) return '↗';
    if (/critical|shed/i.test(s)) return '!';
    if (/dim|reduce|drop/i.test(s)) return '↓';
    return '✓';
  }

  let lastMsg = null;
  function onMessage(msg) {
    lastMsg = msg;
    els.tickLabel.textContent = `t=${msg.tick}`;
    updatePhase(msg.phase, msg.elapsed);
    updateHero(msg);
    updateStadium(msg.zones);
    renderTable(msg.zones);
    const curBase = msg.zones.reduce((s, z) => s + z.baseline_kw, 0);
    const curSmart = msg.zones.reduce((s, z) => s + z.smart_kw, 0);
    pushChart(curBase, curSmart);
  }

  const sim = (() => {
    let tick = 0;
    let cumBase = 0, cumSmart = 0;
    const rng = (seed => () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    })(1337);

    function phaseFor(elapsed) {
      if (elapsed < 12) return 'Pre-Game';
      if (elapsed < 52) return 'First Half';
      if (elapsed < 68) return 'Halftime';
      if (elapsed < 108) return 'Second Half';
      return 'Post-Game';
    }

    function zoneOccTarget(id, phase, elapsed) {
      const ramp = (lo, hi, start, end) => {
        if (elapsed <= start) return lo;
        if (elapsed >= end) return hi;
        const p = (elapsed - start) / (end - start);
        return lo + (hi - lo) * p;
      };
      switch (phase) {
        case 'Pre-Game':
          return { north: ramp(5, 35, 0, 12), south: ramp(3, 28, 0, 12),
                   east: ramp(4, 30, 0, 12), west: ramp(4, 28, 0, 12),
                   conA: ramp(10, 55, 0, 12), conB: ramp(10, 58, 0, 12),
                   food: ramp(8, 45, 0, 12), rest: ramp(4, 18, 0, 12) }[id];
        case 'First Half':
          return { north: 72, south: 70, east: 66, west: 68,
                   conA: 18, conB: 22, food: 14, rest: 22 }[id];
        case 'Halftime':
          return { north: 24, south: 22, east: 20, west: 22,
                   conA: 82, conB: 86, food: 78, rest: 74 }[id];
        case 'Second Half':
          return { north: 74, south: 71, east: 68, west: 70,
                   conA: 16, conB: 20, food: 12, rest: 24 }[id];
        case 'Post-Game':
        default:
          return { north: ramp(74, 6, 108, 120), south: ramp(71, 5, 108, 120),
                   east: ramp(68, 4, 108, 120), west: ramp(70, 4, 108, 120),
                   conA: ramp(16, 40, 108, 116), conB: ramp(20, 45, 108, 116),
                   food: ramp(12, 25, 108, 116), rest: ramp(24, 50, 108, 118) }[id];
      }
    }

    const state = Object.fromEntries(ZONE_META.map(z => [z.id, { occ: 0 }]));

    function step() {
      tick += 1;
      const elapsed = tick;
      const phase = phaseFor(elapsed);

      const zones = ZONE_META.map(meta => {
        const target = zoneOccTarget(meta.id, phase, elapsed);
        const s = state[meta.id];
        s.occ += (target - s.occ) * 0.18 + (rng() - 0.5) * 1.5;
        s.occ = Math.max(0, Math.min(99, s.occ));
        const occPct = s.occ;
        const occupancy = Math.round(meta.cap * (occPct / 100));

        const capScale = meta.cap / 8000;
        const baseline_kw = (meta.kind === 'stand' ? 320 : meta.kind === 'concourse' ? 110 : 90) * capScale;

        const lighting_pct = occPct < 8 ? 30 : occPct < 30 ? 55 : occPct < 60 ? 80 : 100;
        const hvac_pct     = occPct < 8 ? 35 : occPct < 30 ? 60 : occPct < 60 ? 80 : 95;
        const screens_on   = occPct > 10;

        const duty = 0.25 + 0.75 * (occPct / 100);
        const smart_kw = Math.max(0.15 * baseline_kw, baseline_kw * duty);

        const prediction = Array.from({ length: 15 }, (_, i) => {
          const t2 = elapsed + i + 1;
          const p2 = phaseFor(t2);
          const tgt = zoneOccTarget(meta.id, p2, t2);
          return Math.round(meta.cap * (tgt / 100));
        });

        let advice = 'Stable — maintain setpoints';
        const nextAvg = prediction.reduce((a, v) => a + v, 0) / prediction.length;
        const nowAvg = occupancy;
        if (nextAvg > nowAvg * 1.4 && nextAvg > meta.cap * 0.4)
          advice = 'Surge incoming — pre-cool & pre-light';
        else if (nowAvg > meta.cap * 0.7)
          advice = 'Peak load — hold HVAC, dim spot lights';
        else if (nextAvg < nowAvg * 0.5 && nowAvg > meta.cap * 0.3)
          advice = 'Drop incoming — reduce lighting in 20s';
        else if (nowAvg < meta.cap * 0.05)
          advice = 'Empty — shed HVAC, screens off';
        else if (nowAvg < meta.cap * 0.2)
          advice = 'Low — dim to 55%, HVAC to 60%';

        return {
          id: meta.id, name: meta.name, capacity: meta.cap,
          occupancy, occupancy_pct: occPct,
          baseline_kw, smart_kw,
          lighting_pct, hvac_pct, screens_on,
          prediction, advice,
        };
      });

      const curBase = zones.reduce((a, z) => a + z.baseline_kw, 0);
      const curSmart = zones.reduce((a, z) => a + z.smart_kw, 0);
      cumBase += curBase / 3600;
      cumSmart += curSmart / 3600;
      const saved = cumBase - cumSmart;
      const saved_pct = cumBase > 0 ? (saved / cumBase) * 100 : 0;

      return {
        phase, elapsed, tick,
        zones,
        totals: {
          baseline_kwh: cumBase,
          smart_kwh: cumSmart,
          saved_kwh: saved,
          saved_pct,
          saved_inr: saved * 9.5,
          co2_kg: saved * 0.82,
        },
      };
    }

    return { step };
  })();

  mountZoneLabels();
  mountZoneTooltip(() => lastMsg ? lastMsg.zones : []);

  let ws = null;
  let simTimer = null;
  function startSim() {
    if (simTimer) return;
    if (ws && ws.readyState <= 1) { try { ws.close(); } catch(_){} }
    onMessage(sim.step());
    simTimer = setInterval(() => onMessage(sim.step()), 1000);
  }
  function isContractValid(msg) {
    return msg && msg.totals && Array.isArray(msg.zones) &&
           msg.zones.length > 0 &&
           ZONE_META.some(m => msg.zones.find(z => z.id === m.id));
  }
  try {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    let gotValid = false;
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (!isContractValid(msg)) {
          if (!gotValid) startSim();
          return;
        }
        gotValid = true;
        onMessage(msg);
      } catch(e) { console.warn(e); }
    });
    ws.addEventListener('error', () => { if (!gotValid) startSim(); });
    ws.addEventListener('close', () => { if (!gotValid) startSim(); });
    setTimeout(() => { if (!gotValid) startSim(); }, 1200);
  } catch (e) {
    startSim();
  }

})();
