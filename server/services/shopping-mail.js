import { esc } from '../../public/utils/html-escape.js';

export function groupOpenItems(items = [], categories = []) {
  const rank = new Map(categories.map((c, index) => [c.name, index]));
  const groups = new Map();
  for (const item of items) {
    if (item.is_checked) continue;
    const name = item.category || '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(item);
  }
  return [...groups.entries()]
    .sort((a, b) => (rank.get(a[0]) ?? categories.length) - (rank.get(b[0]) ?? categories.length))
    .map(([category, entries]) => ({ category, items: entries }));
}

function itemLabel(item) {
  const name = String(item?.name ?? '').trim();
  const quantity = String(item?.quantity ?? '').trim();
  return quantity ? `${name} (${quantity})` : name;
}

export function countOpenItems(items = []) {
  return items.filter((item) => !item.is_checked).length;
}

export function subjectFor({ listName, openCount }) {
  const name = String(listName ?? '').replace(/[\r\n]+/g, ' ').trim();
  return name ? `Shopping list: ${name} (${openCount})` : `Shopping list (${openCount})`;
}

export function renderText({ listName, senderName, groups, sentAt }) {
  const lines = [];
  lines.push(senderName ? `${senderName} sent you this shopping list.` : 'Shopping list');
  if (listName) lines.push(listName);
  lines.push('');
  for (const group of groups) {
    if (group.category) lines.push(`${group.category}:`);
    for (const item of group.items) lines.push(`  - ${itemLabel(item)}`);
    lines.push('');
  }


  lines.push(`This is a snapshot taken on ${sentAt}. Items ticked off afterwards are not reflected here.`);
  return lines.join('\n');
}

export function renderHtml({ listName, senderName, groups, sentAt }) {
  const parts = [];
  parts.push(`<p>${esc(senderName ? `${senderName} sent you this shopping list.` : 'Shopping list')}</p>`);
  if (listName) parts.push(`<p><strong>${esc(listName)}</strong></p>`);
  for (const group of groups) {
    if (group.category) parts.push(`<p><strong>${esc(group.category)}</strong></p>`);
    parts.push(`<ul>${group.items.map((item) => `<li>${esc(itemLabel(item))}</li>`).join('')}</ul>`);
  }
  parts.push(`<p><small>${esc(`This is a snapshot taken on ${sentAt}. Items ticked off afterwards are not reflected here.`)}</small></p>`);
  return parts.join('');
}

export function buildShoppingListMail({ list, items, categories, senderName, sentAt }) {
  const openCount = countOpenItems(items);
  if (openCount === 0) throw new Error('This shopping list has no open items to send.');
  const groups = groupOpenItems(items, categories);
  const context = { listName: list?.name ?? '', senderName, groups, sentAt };
  return {
    subject: subjectFor({ listName: context.listName, openCount }),
    text: renderText(context),
    html: renderHtml(context),
    openCount,
  };
}
