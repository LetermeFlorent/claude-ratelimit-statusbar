const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const FULL = '$(cs-bar-full)';
const EMPTY = '$(cs-bar-empty)';
const GRAY = '#8a8a8a';
const CRED = path.join(os.homedir(), '.claude', '.credentials.json');
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const API_MIN_INTERVAL = 55000;

function cfg() { return vscode.workspace.getConfiguration('claudeRate'); }

function csCacheFile() {
  const custom = cfg().get('cachePath');
  if (custom && String(custom).trim()) return String(custom).trim();
  return path.join(os.tmpdir(), 'cs-rate-cache.json');
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); }
  catch (_) { return null; }
}

function colorFor(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return '#f14c4c';
  if (p >= 75) return '#e59b45';
  if (p >= 50) return '#e5c452';
  return '#57c85a';
}

function fmtDur(iso) {
  const t = Date.parse(iso);
  if (isNaN(t)) return '';
  let s = Math.max(0, Math.round((t - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return d + 'd' + String(h).padStart(2, '0') + 'h';
  return h + 'h' + String(m).padStart(2, '0') + 'm';
}

function csSnapshot() {
  const c = readJson(csCacheFile());
  if (!c || !c.data || !c.data.rate_limits) return null;
  const rl = c.data.rate_limits;
  const mk = function (x) { return x ? { pct: x.used_percentage, reset: x.reset_time || '' } : null; };
  return { five: mk(rl.five_hour), seven: mk(rl.seven_day), ts: c.ts || 0 };
}

const mem = { accessToken: null, expiresAt: 0 };

async function refreshToken(refresh) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh, grant_type: 'refresh_token' })
  });
  if (r.status !== 200) throw new Error('refresh ' + r.status);
  const d = await r.json();
  return { accessToken: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 };
}

async function getToken() {
  const j = readJson(CRED);
  const o = j && j.claudeAiOauth;
  if (!o || !o.accessToken) return null;
  if (Date.now() < o.expiresAt - 60000) { mem.accessToken = o.accessToken; mem.expiresAt = o.expiresAt; return o.accessToken; }
  if (mem.accessToken && Date.now() < mem.expiresAt - 60000) return mem.accessToken;
  if (o.refreshToken) {
    try { const nt = await refreshToken(o.refreshToken); mem.accessToken = nt.accessToken; mem.expiresAt = nt.expiresAt; return nt.accessToken; }
    catch (_) { return null; }
  }
  return null;
}

function curlGet(url, headers) {
  const args = ['-s', '-w', '\n__H:%{http_code}'];
  for (const k in headers) { args.push('-H', k + ': ' + headers[k]); }
  args.push(url);
  const p = cp.spawnSync('curl', args, { encoding: 'utf8', timeout: 8000 });
  const out = p.stdout || '';
  const i = out.lastIndexOf('__H:');
  return { status: i >= 0 ? parseInt(out.slice(i + 4), 10) : 0, body: i >= 0 ? out.slice(0, i) : out };
}

async function callUsage(token) {
  const headers = { Authorization: 'Bearer ' + token, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' };
  try {
    const r = await fetch(USAGE_URL, { headers });
    const body = await r.text();
    if (r.status === 403 && body.indexOf('Request not allowed') >= 0) return curlGet(USAGE_URL, headers);
    return { status: r.status, body };
  } catch (_) { return curlGet(USAGE_URL, headers); }
}

let apiSnap = null;
let apiStatus = { state: 'init', code: 0, msg: '' };
let cooldownUntil = 0, lastFetch = 0, fetching = false;

async function maybeFetch() {
  const now = Date.now();
  if (fetching || now < cooldownUntil || now - lastFetch < API_MIN_INTERVAL) return;
  fetching = true; lastFetch = now;
  try {
    const tok = await getToken();
    if (!tok) { apiStatus = { state: 'nocreds', code: 0, msg: CRED }; render(); return; }
    const r = await callUsage(tok);
    if (r.status === 429) { cooldownUntil = Date.now() + 60000; apiStatus = { state: 'cooldown', code: 429, msg: 'rate-limited 60s' }; render(); return; }
    if (r.status !== 200) { apiStatus = { state: 'http', code: r.status, msg: (r.body || '').slice(0, 120) }; render(); return; }
    const d = JSON.parse(r.body);
    const mk = function (x) { return x ? { pct: Math.round(x.utilization), reset: fmtDur(x.resets_at) } : null; };
    apiSnap = { five: mk(d.five_hour), seven: mk(d.seven_day), ts: Date.now() };
    apiStatus = { state: 'ok', code: 200, msg: '' };
    render();
  } catch (e) { apiStatus = { state: 'err', code: 0, msg: String((e && e.message) || e) }; render(); }
  finally { fetching = false; }
}

const it = {};
let timer;

function scheduled() {
  const ms = Math.max(2, Number(cfg().get('refreshSeconds')) || 5) * 1000;
  clearInterval(timer);
  timer = setInterval(render, ms);
}

function bar(pct, w) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round(p / 100 * w);
  return FULL.repeat(filled) + EMPTY.repeat(w - filled);
}

function seg(item, text, color) {
  if (!text) { item.hide(); return; }
  item.text = text;
  item.color = color;
  item.show();
}

function drawLine(lbl, barItem, valItem, label, data, w, stale) {
  seg(lbl, label, undefined);
  seg(barItem, bar(data.pct, w), stale ? GRAY : colorFor(data.pct));
  seg(valItem, (data.pct + '% ' + (data.reset || '')).replace(/\s+$/, ''), undefined);
}

function setStatus(src) {
  let icon = '$(sync)', color, tip = 'API: initialisation';
  if (apiStatus.state === 'ok') { icon = '$(check)'; color = '#57c85a'; tip = 'API OK'; }
  else if (apiStatus.state === 'cooldown') { icon = '$(clock)'; color = '#e59b45'; tip = 'API 429 - cooldown 60s'; }
  else if (apiStatus.state === 'nocreds') { icon = '$(warning)'; color = '#e59b45'; tip = 'Pas de credentials Claude: ' + apiStatus.msg; }
  else if (apiStatus.state === 'http') { icon = '$(error)'; color = '#f14c4c'; tip = 'API HTTP ' + apiStatus.code + ' ' + apiStatus.msg; }
  else if (apiStatus.state === 'err') { icon = '$(error)'; color = '#f14c4c'; tip = 'API erreur: ' + apiStatus.msg; }
  const srcLabel = src === 'api' ? 'affichage: API' : (src === 'cache' ? 'affichage: cache CLI' : 'aucune source');
  it.st.text = icon;
  it.st.color = color;
  it.st.tooltip = tip + ' | ' + srcLabel;
  it.st.show();
}

function render() {
  const w = Math.max(4, Math.min(20, Number(cfg().get('barWidth')) || 8));
  const staleMs = Math.max(10, Number(cfg().get('staleSeconds')) || 300) * 1000;

  if (cfg().get('apiFallback') !== false) {
    const focused = !vscode.window.state || vscode.window.state.focused;
    const wanted = focused ? 60000 : 300000;
    if (!apiSnap || Date.now() - apiSnap.ts > wanted) maybeFetch();
  }

  let snap = apiSnap;
  let src = 'api';
  if (!snap) { snap = csSnapshot(); src = snap ? 'cache' : 'none'; }
  const stale = !snap || (Date.now() - snap.ts > staleMs);

  setStatus(src);

  const five = snap && snap.five;
  const seven = snap && snap.seven;

  if (five) drawLine(it.l5, it.b5, it.v5, '5h', five, w, stale);
  else { it.l5.hide(); it.b5.hide(); it.v5.hide(); }

  if (seven) drawLine(it.l7, it.b7, it.v7, '7d', seven, w, stale);
  else { it.l7.hide(); it.b7.hide(); it.v7.hide(); }
}

function activate(context) {
  const mk = function (prio) {
    const s = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, prio);
    context.subscriptions.push(s);
    return s;
  };
  it.st = mk(107);
  it.l5 = mk(106); it.b5 = mk(105); it.v5 = mk(104);
  it.l7 = mk(103); it.b7 = mk(102); it.v7 = mk(101);
  context.subscriptions.push(vscode.commands.registerCommand('claudeRate.refresh', function () { lastFetch = 0; maybeFetch(); render(); }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (e) {
    if (e.affectsConfiguration('claudeRate')) { scheduled(); render(); }
  }));
  context.subscriptions.push({ dispose: function () { clearInterval(timer); } });
  render();
  scheduled();
}

function deactivate() { clearInterval(timer); }

module.exports = { activate, deactivate };
