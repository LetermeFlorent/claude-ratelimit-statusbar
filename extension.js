const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FULL = '$(cs-bar-full)';
const EMPTY = '$(cs-bar-empty)';
const GRAY = '#8a8a8a';

function cfg() { return vscode.workspace.getConfiguration('claudeRate'); }

function cacheFile() {
  const custom = cfg().get('cachePath');
  if (custom && String(custom).trim()) return String(custom).trim();
  return path.join(os.tmpdir(), 'cs-rate-cache.json');
}

function readCache() {
  try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8').replace(/^﻿/, '')); }
  catch (_) { return null; }
}

function bar(pct, w) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round(p / 100 * w);
  return FULL.repeat(filled) + EMPTY.repeat(w - filled);
}

function colorFor(pct) {
  const p = Number(pct) || 0;
  if (p >= 90) return '#f14c4c';
  if (p >= 75) return '#e59b45';
  if (p >= 50) return '#e5c452';
  return '#57c85a';
}

const it = {};
let timer;

function scheduled() {
  const ms = Math.max(2, Number(cfg().get('refreshSeconds')) || 5) * 1000;
  clearInterval(timer);
  timer = setInterval(render, ms);
}

function seg(item, text, color) {
  if (!text) { item.hide(); return; }
  item.text = text;
  item.color = color;
  item.show();
}

function drawLine(lbl, barItem, valItem, label, data, w, stale) {
  seg(lbl, label, undefined);
  seg(barItem, bar(data.used_percentage, w), stale ? GRAY : colorFor(data.used_percentage));
  seg(valItem, (data.used_percentage + '% ' + (data.reset_time || '')).replace(/\s+$/, ''), undefined);
}

function render() {
  const w = Math.max(4, Math.min(20, Number(cfg().get('barWidth')) || 8));
  const staleMs = Math.max(10, Number(cfg().get('staleSeconds')) || 90) * 1000;
  const c = readCache();
  const d = c && c.data;
  const rl = d && d.rate_limits;
  const five = rl && rl.five_hour;
  const seven = rl && rl.seven_day;
  const stale = !c || (Date.now() - (c.ts || 0) > staleMs);

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
  it.l5 = mk(106); it.b5 = mk(105); it.v5 = mk(104);
  it.l7 = mk(103); it.b7 = mk(102); it.v7 = mk(101);
  context.subscriptions.push(vscode.commands.registerCommand('claudeRate.refresh', render));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(function (e) {
    if (e.affectsConfiguration('claudeRate')) { scheduled(); render(); }
  }));
  context.subscriptions.push({ dispose: function () { clearInterval(timer); } });
  render();
  scheduled();
}

function deactivate() { clearInterval(timer); }

module.exports = { activate, deactivate };
