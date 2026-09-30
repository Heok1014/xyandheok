import { CATALOG, ORDERS, ACHIEVEMENTS, createWorld, normalizeWorld, advanceWorld, applyAction, getCropStatus, getLevel, getDailyTasks, serializeWorld, importWorld } from './engine.js?v=2';
import { cloudConfig } from './config.js';
import { WorldClient } from './client.js';
import { ArcadeController } from './arcade.js';
import { playSound, toggleSound, soundEnabled } from './sound.js';

const $ = id => document.getElementById(id);
const names = { heok: '廖炫旭', xy: '陈欣怡' };
const key = 'our-little-days-v1';
let storageOK = true, savedCode = '', actor = 'heok', local = createWorld(), code = '', remote = null;
let online = false, busy = false, seed = 'carrot', selected = '', importCandidate = null, drag = null;
let journalSignature = '', toastTimer, poseTimer, polling = false;
let clockOffset = 0;
const client = new WorldClient(cloudConfig.apiBase);
try {
  const raw = localStorage.getItem(key);
  if (raw) { local = importWorld(raw); if (!localStorage.getItem(`${key}-before-adventure`)) localStorage.setItem(`${key}-before-adventure`, raw); }
  savedCode = localStorage.getItem(`${key}-room`) || '';
  actor = localStorage.getItem(`${key}-actor`) === 'xy' ? 'xy' : 'heok';
} catch { storageOK = false; }

function store(k, value) {
  try { value === null ? localStorage.removeItem(k) : localStorage.setItem(k, value); }
  catch { storageOK = false; }
}
function saveLocal() { store(key, serializeWorld(local)); }
function now() { return Math.max(0, Math.floor(Date.now() + (code ? clockOffset : 0))); }
function world() { return advanceWorld(code ? remote : local, now()); }
function receiveWorld(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.lastUpdated) || value.lastUpdated < 0 || value.lastUpdated > 253402271999999) throw new Error('云端存档格式不正确。');
  clockOffset = value.lastUpdated - Date.now();
  remote = normalizeWorld(value, value.lastUpdated);
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function sprite(kind, id) { const el = node('span', `${kind}-sprite ${id}`); el.dataset[kind === 'plant' ? 'crop' : 'item'] = id; el.setAttribute('aria-hidden', 'true'); return el; }
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
function dialog(id) { $(id).showModal(); document.documentElement.style.overflow = 'hidden'; }
document.querySelectorAll('dialog').forEach(el => el.addEventListener('close', () => { document.documentElement.style.overflow = ''; }));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => $(el.dataset.close).close()));
function pose(type, message) {
  clearTimeout(poseTimer);
  $('pet-character').className = `pet-character ${type === 'rest' ? 'sleeping' : 'playing'}`;
  $('pet-bubble').textContent = message; $('pet-bubble').hidden = false;
  poseTimer = setTimeout(() => { $('pet-character').className = 'pet-character'; $('pet-bubble').hidden = true; }, 4000);
}
async function action(input) {
  if (busy || (code && !online)) { toast(code && !online ? '正在重新连接，请稍等。' : '正在保存这一份小幸福。'); return false; }
  busy = true; render();
  try {
    let result;
    if (code) {
      if (client.pending) { toast('上一笔操作正在等待确认，请稍等自动重试。'); return false; }
      result = await client.act(code, actor, input);
      if (!remote || result.world.revision >= remote.revision) receiveWorld(result.world); online = true;
    } else {
      result = applyAction(local, { ...input, actor });
      local = result.state; saveLocal();
    }
    toast(result.message);
    if (result.ok) { playSound(input.type === 'harvest' || input.type === 'claim' || input.type === 'order' ? 'reward' : 'touch'); if (input.type === 'gift') celebrate(); }
    if (result.ok && ['feed', 'play', 'rest'].includes(input.type)) pose(input.type, input.type === 'rest' ? '有你在，睡觉也很安心。' : '喵，今天也最喜欢你。');
    return result.ok;
  } catch (error) { online = false; toast('操作还未确认。恢复连接后会安全重试，不会重复扣金币。'); }
  finally { busy = false; render(); }
  return false;
}

const tabs = [...document.querySelectorAll('[data-tab]')];
function chooseTab(id) {
  tabs.forEach(tab => { const active = tab.dataset.tab === id; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; $(`panel-${tab.dataset.tab}`).hidden = !active; });
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => chooseTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    chooseTab(target.dataset.tab); target.focus();
  });
});
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => action({ type: button.dataset.action })));
$('pet-character').addEventListener('click', () => { pose('play', ['不用做什么，陪着我就很好。', '今天有没有想我呀？', '一起去游乐场玩好不好？'][Math.floor(Math.random() * 3)]); playSound('touch'); });
$('rename-pet').addEventListener('click', () => { $('new-pet-name').value = world().pet.name; $('name-status').textContent = ''; dialog('name-dialog'); });
$('name-form').addEventListener('submit', async event => { event.preventDefault(); if (await action({ type: 'rename', name: $('new-pet-name').value })) $('name-dialog').close(); else $('name-status').textContent = '暂时没有改好，请看提示后再试。'; });

const seedNodes = CATALOG.crops.map(crop => {
  const button = node('button', 'seed-button'); button.append(sprite('plant', crop.id), node('span', '', crop.name), node('small', '', `${crop.cost} 金币`));
  button.addEventListener('click', () => { seed = crop.id; render(); }); $('seed-picker').append(button); return button;
});
const plots = Array.from({ length: 6 }, (_, index) => {
  const button = node('button', 'plot'); const art = sprite('plant', 'sprout'), label = node('span', 'plot-label');
  button.append(art, label); $('farm-plots').append(button);
  button.addEventListener('click', () => {
    const status = getCropStatus(world().plots[index], now());
    action(status.empty ? { type: 'plant', index, crop: seed } : { type: status.ready ? 'harvest' : 'water', index });
  });
  return { button, art, label };
});
$('harvest-all').addEventListener('click', async () => {
  for (let index = 0; index < 6; index++) if (getCropStatus(world().plots[index], now()).ready && !(await action({ type: 'harvest', index }))) break;
});

const furnitureCards = CATALOG.furniture.map(item => {
  const card = node('article', 'furniture-card'), status = node('p'), button = node('button');
  card.append(sprite('furniture', item.id), node('h4', '', item.name), status, button); $('furniture-shop').append(card);
  button.addEventListener('click', async () => {
    if (!world().owned.includes(item.id) && !(await action({ type: 'buy', item: item.id }))) return;
    selected = item.id; render(); toast('点场景里的位置摆放，也可以拖动家具。');
  });
  return { card, status, button, item };
});
const placedNodes = new Map();
function coordinates(event) {
  const bounds = $('home-scene').getBoundingClientRect();
  return { x: Math.max(8, Math.min(92, (event.clientX - bounds.left) / bounds.width * 100)), y: Math.max(selected === 'painting' ? 25 : 65, Math.min(90, (event.clientY - bounds.top) / bounds.height * 100)) };
}
function selectFurniture(id) { selected = id; render(); }
$('home-scene').addEventListener('click', event => {
  if (event.target.closest('.placed-item') || !selected) return;
  action({ type: 'place', item: selected, ...coordinates(event) });
});
$('home-scene').addEventListener('pointermove', event => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const point = coordinates(event); drag.point = point;
  drag.moved ||= Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 6;
  if (drag.moved) { drag.el.style.left = `${point.x}%`; drag.el.style.top = `${point.y}%`; drag.el.classList.add('dragging'); }
});
function endDrag(event) {
  if (!drag || drag.pointer !== event.pointerId) return;
  const current = drag; drag = null; current.el.classList.remove('dragging');
  if (event.type !== 'pointercancel' && current.moved) action({ type: 'place', item: selected, ...current.point }); else render();
}
$('home-scene').addEventListener('pointerup', endDrag);
$('home-scene').addEventListener('pointercancel', endDrag);
$('home-scene').addEventListener('keydown', event => {
  if (!selected || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const current = world().placed.find(item => item.id === selected) || { x: 50, y: 75 };
  action({ type: 'place', item: selected, x: current.x + (event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0), y: current.y + (event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : 0) });
});
$('remove-selected').addEventListener('click', () => action({ type: 'remove', item: selected }));
$('deselect-furniture').addEventListener('click', () => { selected = ''; render(); });
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => action({ type: 'theme', theme: button.dataset.theme })));
$('send-gift').addEventListener('click', () => action({ type: 'gift' }));
$('sound-toggle').addEventListener('click', () => { toggleSound(); $('sound-toggle').textContent = soundEnabled() ? '音效：开' : '音效：关'; $('sound-toggle').setAttribute('aria-pressed', String(soundEnabled())); });
function celebrate() {
  const burst = node('div', 'heart-burst'); burst.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 12; i++) { const heart = node('span', '', '♡'); heart.style.setProperty('--i', i); burst.append(heart); }
  document.body.append(burst); setTimeout(() => burst.remove(), 1600);
}
const arcade = new ArcadeController({ act: action, getWorld: world, getActor: () => actor, open: () => dialog('arcade-dialog'), feedback: playSound });
document.querySelectorAll('[data-game]').forEach(button => button.addEventListener('click', () => arcade.start(button.dataset.game)));
const inventoryNodes = CATALOG.crops.map(crop => {
  const el = node('div'), count = node('b'); el.append(sprite('plant', crop.id), node('span', '', crop.name), count); $('inventory').append(el); return count;
});
const orderNodes = ORDERS.map(order => {
  const card = node('article', 'order-card'), needs = node('p'), button = node('button', 'small-button');
  card.append(node('h4', '', order.name), needs, button); $('orders').append(card);
  button.addEventListener('click', () => action({ type: 'order', order: order.id })); return { order, card, needs, button };
});
const achievementNodes = ACHIEVEMENTS.map(achievement => {
  const row = node('div', 'achievement'), badge = node('span', 'achievement-badge', '◇'), text = node('div');
  text.append(node('b', '', achievement.name), node('small', '', achievement.description)); row.append(badge, text); $('achievements').append(row); return { achievement, row, badge };
});
const taskNodes = getDailyTasks(local).map(task => {
  const row = node('div', 'task'), details = node('div', 'task-details'), title = node('span', 'task-name'), progress = node('small', 'task-progress'), button = node('button', 'task-reward');
  details.append(title, progress); row.append(details, button); $('daily-tasks').append(row);
  button.addEventListener('click', () => action({ type: 'claim', task: task.id })); return { row, title, progress, button };
});

function render() {
  const state = world(), locked = busy || !!(code && !online);
  const adventure = state.adventure;
  arcade.reconcile(state, locked || !!client.pending);
  $('bond-title').textContent = `与${state.pet.name}的羁绊 · Lv. ${1 + Math.floor(adventure.bond / 50)}`;
  $('bond-label').textContent = `${adventure.bond} 点亲密 · ${adventure.bond < 50 ? '慢慢熟悉' : adventure.bond < 150 ? '最好的玩伴' : '形影不离'}`;
  $('bond-bar').value = adventure.bond % 50; $('bond-bar').max = 50;
  $('pet-help').textContent = `${state.pet.name}不会生病或离开。照顾和小游戏都会累积亲密度。`;
  $('arcade-quota').textContent = `今天还可获得 ${Math.max(0, 5 - adventure.daily.games[actor])} 局奖励`;
  for (const game of ['catch', 'memory', 'fishing']) $('best-' + game).textContent = `最佳 ${adventure.best[game]} / ${game === 'catch' ? 15 : game === 'memory' ? 6 : 5}`;
  document.querySelectorAll('[data-game]').forEach(button => button.disabled = locked);
  inventoryNodes.forEach((el, index) => el.textContent = `× ${adventure.inventory[CATALOG.crops[index].id]}`);
  orderNodes.forEach(({ order, card, needs, button }) => {
    const completed = adventure.daily.orders.includes(order.id), enough = Object.entries(order.needs).every(([id, quantity]) => adventure.inventory[id] >= quantity);
    needs.textContent = Object.entries(order.needs).map(([id, quantity]) => `${CATALOG.crops.find(crop => crop.id === id).name} ${adventure.inventory[id]}/${quantity}`).join(' · ');
    button.textContent = completed ? '今日已交付' : `交付 +${order.reward} 金币`; button.disabled = locked || completed || !enough;
    card.classList.toggle('completed', completed);
  });
  achievementNodes.forEach(({ achievement, row, badge }) => { const earned = adventure.achievements.includes(achievement.id); row.classList.toggle('earned', earned); badge.textContent = earned ? '✦' : '◇'; row.setAttribute('aria-label', `${achievement.name}：${earned ? '已达成' : '未达成'}`); });
  const next = ACHIEVEMENTS.find(entry => !adventure.achievements.includes(entry.id));
  $('next-goal').textContent = next ? `下一站：${next.name} · ${next.description}` : '所有徽章已点亮。下一份快乐，就留给明天。';
  const gifted = adventure.daily.gifts.includes(actor), partnerGifted = adventure.daily.gifts.includes(actor === 'xy' ? 'heok' : 'xy');
  $('send-gift').disabled = locked || gifted; $('send-gift').textContent = gifted ? '今天的心意已经送达' : `给${names[actor === 'xy' ? 'heok' : 'xy']}送小心意`;
  $('gift-status').textContent = partnerGifted ? '对方今天也把心意留给了你。' : '每人每天一次，不花金币。';
  document.querySelectorAll('[data-theme]').forEach(button => { button.disabled = locked; button.setAttribute('aria-pressed', String(button.dataset.theme === adventure.theme)); });
  $('home-scene').dataset.theme = adventure.theme;
  $('actor').disabled = busy || arcade.running;
  $('coins').textContent = state.coins; $('level').textContent = `Lv. ${getLevel(state)}`;
  $('pet-name').textContent = state.pet.name; $('tab-pet').querySelector('span').textContent = '小猫'; $('tab-pet').setAttribute('aria-label', `${state.pet.name}的小窝`);
  $('pet-character').setAttribute('aria-label', `摸摸${state.pet.name}`);
  for (const stat of ['hunger', 'happiness', 'energy']) { $('' + stat + '-value').textContent = Math.round(state.pet[stat]); $(stat + '-bar').value = state.pet[stat]; }
  $('pet-message').textContent = state.pet.hunger < 40 ? '有点饿，想吃一口' : state.pet.happiness < 40 ? '想和你玩一会儿' : '今天也在等你';
  document.querySelectorAll('[data-action]').forEach(button => button.disabled = locked);
  seedNodes.forEach((button, index) => { const active = seed === CATALOG.crops[index].id; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); });
  plots.forEach(({ button, art, label }, index) => {
    const status = getCropStatus(state.plots[index], now()), crop = CATALOG.crops.find(item => item.id === status.crop);
    button.className = `plot ${status.status}`; button.disabled = locked;
    art.hidden = status.empty; art.dataset.crop = status.ready ? status.crop : 'sprout'; art.className = `plant-sprite ${art.dataset.crop}`;
    label.textContent = status.empty ? '种在这里' : status.ready ? `${crop.name} · 收获` : `${Math.ceil(status.remaining / 1000)}秒 · ${status.watered ? '已浇水' : '浇水'}`;
    button.setAttribute('aria-label', `第${index + 1}块地：${label.textContent}`);
  });
  $('harvest-all').disabled = locked || !state.plots.some(plot => getCropStatus(plot, now()).ready);
  furnitureCards.forEach(({ card, status, button, item }) => {
    const owned = state.owned.includes(item.id), placed = state.placed.some(piece => piece.id === item.id);
    status.textContent = owned ? (placed ? '已经住进家里' : '已拥有') : `${item.cost} 金币`;
    button.textContent = owned ? '摆放' : '购买'; button.disabled = locked || (!owned && state.coins < item.cost);
    card.classList.toggle('selected', selected === item.id); button.setAttribute('aria-label', `${owned ? '摆放' : '购买'}${item.name}`);
  });
  for (const [id, el] of placedNodes) if (!state.placed.some(item => item.id === id)) { el.remove(); placedNodes.delete(id); }
  for (const item of state.placed) {
    let el = placedNodes.get(item.id);
    if (!el) {
      el = node('button', 'placed-item'); el.dataset.item = item.id; el.append(sprite('furniture', item.id));
      el.setAttribute('aria-label', `移动${CATALOG.furniture.find(piece => piece.id === item.id).name}`);
      el.addEventListener('click', event => { event.stopPropagation(); selectFurniture(item.id); });
      el.addEventListener('pointerdown', event => {
        if (busy || (code && !online) || event.button !== 0) return;
        selected = item.id; el.setPointerCapture(event.pointerId); drag = { el, pointer: event.pointerId, moved: false, startX: event.clientX, startY: event.clientY }; render();
      });
      $('home-items').append(el); placedNodes.set(item.id, el);
    }
    el.classList.toggle('selected', selected === item.id); el.disabled = locked;
    if (drag?.el !== el) { el.style.left = `${item.x}%`; el.style.top = `${item.y}%`; }
    el.style.zIndex = item.id === 'rug' ? '0' : String(Math.round(item.y));
  }
  $('remove-selected').disabled = locked || !state.placed.some(item => item.id === selected);
  $('placement-hint').hidden = !selected;
  $('selected-furniture-label').textContent = selected ? `正在布置：${CATALOG.furniture.find(item => item.id === selected).name}` : '先从一张柔软的小毯子开始。';
  getDailyTasks(state, now()).forEach((task, index) => {
    const el = taskNodes[index]; el.title.textContent = task.id === 'feed' ? `喂${state.pet.name}一次` : task.name;
    el.progress.textContent = `${Math.min(task.progress, task.target)} / ${task.target}`;
    el.button.textContent = task.claimed ? '已领取' : `${task.reward} 金币`;
    el.button.disabled = locked || !task.complete || task.claimed; el.button.setAttribute('aria-label', `${el.title.textContent}：${el.button.textContent}`);
    el.row.classList.toggle('claimed', task.claimed); el.button.classList.toggle('claimable', task.complete && !task.claimed);
  });
  $('xp-bar').value = state.xp % 40; $('xp-label').textContent = `再攒 ${40 - state.xp % 40} 点陪伴，升到下一级`;
  const signature = JSON.stringify(state.journal.slice(-5));
  if (signature !== journalSignature) {
    journalSignature = signature; $('journal-list').replaceChildren();
    if (!state.journal.length) $('journal-list').append(node('li', '', '欢迎回家，小猫已经准备好认识你们了。'));
    for (const entry of state.journal.slice(-5).reverse()) $('journal-list').append(node('li', '', `${names[entry.actor] || '我们'} · ${entry.message}`));
  }
  $('connection-label').textContent = code ? online ? '进度已同步' : '重连中' : '本地试玩';
  $('connection-dot').className = code && online ? 'connected' : code ? 'offline' : '';
  $('save-status').textContent = !storageOK ? '浏览器未能保存，请导出本地备份并保管房间码。' : code ? online ? '共用同一份进度，约 5 秒同步一次' : '断网时暂停操作；连接恢复后自动重试' : '本机进度会自动保存';
  $('cloud-button-label').textContent = code ? '查看我们的房间码' : '连接我们的云端小家';
  $('cloud-connected').hidden = !code; $('cloud-setup').hidden = !!code; $('current-code').value = code;
  $('create-room').disabled = !cloudConfig.apiBase || busy; $('join-form').querySelector('button').disabled = !cloudConfig.apiBase || busy;
  $('export-save').disabled = false;
}

function acceptRemote(room, data) {
  if (!data.world || data.world.version !== 1) throw new Error('存档格式不正确。');
  receiveWorld(data.world); code = room; savedCode = room; online = true; selected = ''; journalSignature = ''; store(`${key}-room`, code); render();
}
async function connect(room, creating = false) {
  if (busy) return;
  if (arcade.running) { $('cloud-status').textContent = '请先完成或退出小游戏，再切换小家。'; return; }
  if (client.pending) { $('cloud-status').textContent = '上一笔操作还在等待确认，请恢复连接后再切换小家。'; return; }
  busy = true; $('cloud-status').textContent = '正在打开我们的小家……'; render();
  try {
    const data = creating ? await client.create() : await client.read(room);
    acceptRemote(creating ? data.code : room, data); $('cloud-status').textContent = '连接成功。把房间码只发给另一半就好。';
  } catch (error) { $('cloud-status').textContent = error.message; }
  finally { busy = false; render(); }
}
function openCloud() { $('cloud-status').textContent = cloudConfig.apiBase ? '' : '云端还未上线。本地小游戏已可玩，正式上线后这里可以连接两台手机。'; dialog('cloud-dialog'); }
$('connection-button').addEventListener('click', openCloud); $('open-cloud').addEventListener('click', openCloud);
$('create-room').addEventListener('click', () => connect('', true));
$('join-form').addEventListener('submit', event => { event.preventDefault(); const room = $('join-code').value.trim().toLowerCase(); if (!/^[a-f0-9]{32}$/.test(room)) { $('cloud-status').textContent = '请输入完整的 32 位房间码。'; return; } connect(room); });
$('copy-room').addEventListener('click', async () => { try { await navigator.clipboard.writeText(code); $('cloud-status').textContent = '房间码已复制。'; } catch { $('current-code').focus(); $('current-code').select(); $('cloud-status').textContent = '请长按选中的房间码复制。'; } });
$('leave-room').addEventListener('click', () => {
  if (busy || client.pending || arcade.running) { $('cloud-status').textContent = '请等当前操作或小游戏结束后再退出，避免遗漏进度。'; return; }
  code = ''; savedCode = ''; remote = null; online = false; selected = ''; store(`${key}-room`, null); $('cloud-status').textContent = '已回到保留的本地试玩。原来的房间码仍然有效。'; render();
});
$('actor').value = actor;
$('actor').addEventListener('change', () => { actor = $('actor').value; store(`${key}-actor`, actor); render(); });
async function poll() {
  if (!code && savedCode && cloudConfig.apiBase && !busy && !document.hidden) { await connect(savedCode); return; }
  if (!code || busy || polling || document.hidden) return;
  const room = code; polling = true;
  try {
    const result = client.pending ? await client.act(room, actor, {}) : await client.read(room);
    if (code === room && (!remote || result.world.revision >= remote.revision)) { receiveWorld(result.world); online = true; }
  } catch { if (code === room) online = false; }
  finally { polling = false; render(); }
}
setInterval(poll, cloudConfig.pollInterval);
window.addEventListener('online', poll);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); render(); } });

$('open-guide').addEventListener('click', () => dialog('guide-dialog'));
$('open-save').addEventListener('click', () => dialog('save-dialog'));
$('export-save').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeWorld(local)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'our-little-days-backup.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('save-dialog-status').textContent = '已准备下载本地备份；云端进度和房间码不在这个文件里。';
});
$('import-file').addEventListener('change', async event => {
  importCandidate = null; $('confirm-import').hidden = true; $('import-summary').hidden = true;
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 100000) throw new Error('文件太大。'); importCandidate = importWorld(await file.text()); $('import-summary').textContent = `${importCandidate.pet.name} · ${importCandidate.coins} 金币 · ${getLevel(importCandidate)} 级。确认将替换本地试玩存档。`; $('import-summary').hidden = false; $('confirm-import').hidden = false; $('save-dialog-status').textContent = ''; }
  catch { $('save-dialog-status').textContent = '无法读取这份存档，请选择游戏导出的 JSON 备份。'; }
  event.target.value = '';
});
$('confirm-import').addEventListener('click', () => { if (!importCandidate) return; local = importCandidate; importCandidate = null; saveLocal(); $('confirm-import').hidden = true; $('save-dialog-status').textContent = code ? '本地备份已恢复；当前仍在云端小家。' : '本地备份已恢复。'; render(); });

const start = Date.UTC(2026, 0, 1) - 8 * 3600000;
$('anniversary-label').textContent = `在一起第 ${Math.max(1, Math.floor((Date.now() - start) / 86400000) + 1)} 天 · 从 2026.01.01 开始`;
const notes = ['今天也想偏爱你一点。', '小小的世界，也想和你一起经营。', '有你在，日常也是限量版浪漫。'];
$('daily-love').textContent = notes[Math.floor(Date.now() / 86400000) % notes.length];
for (const [name, columns, rows, variable] of [['pet-sprites', 3, 1, 'pet'], ['farm-sprites', 5, 1, 'plant'], ['furniture-sprites', 4, 2, 'furniture']]) {
  const image = new Image(); image.onload = () => document.documentElement.style.setProperty(`--${variable}-ratio`, image.naturalWidth / columns / (image.naturalHeight / rows)); image.onerror = () => toast('部分插画加载失败，请检查网络后刷新。'); image.src = `./assets/${name}.png`;
}
render();
if (!storageOK) toast('原存档未被覆盖。请检查浏览器存储，或导入备份。');
if (/^[a-f0-9]{32}$/.test(savedCode) && cloudConfig.apiBase) connect(savedCode);
setInterval(() => { if (!document.hidden) render(); }, 1000);
