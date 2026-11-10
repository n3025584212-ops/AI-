#!/usr/bin/env node
/**
 * 设计约束体检：统计 src/ 下 CSS 的字号、颜色、圆角离散度与令牌使用率。
 * 用法：node scripts/design-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.css'));
const text = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

const count = (re) => {
  const m = text.match(re) || [];
  const map = new Map();
  for (const raw of m) {
    const k = raw.replace(/^.*?:\s*/, '').trim();
    map.set(k, (map.get(k) || 0) + 1);
  }
  return map;
};

const fontSizes = count(/font-size:\s*[\d.]+(?:px|rem|em)/g);
const radii = count(/border-radius:\s*[\d.]+px/g);
const hexTotal = (text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
const hexUnique = new Set((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map(s => s.toLowerCase())).size;
const tokenUse = (text.match(/var\(--ds-[a-z0-9-]+\)/g) || []).length;

const small = [...fontSizes.entries()]
  .filter(([k]) => parseFloat(k) <= 9)
  .reduce((a, [, n]) => a + n, 0);
const totalFont = [...fontSizes.values()].reduce((a, n) => a + n, 0);

const top = (map, n = 6) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

const pad = (s, n) => String(s).padEnd(n, ' ');
const line = (k, v) => console.log(pad(k, 22) + v);

console.log('=== QCDKR 设计约束体检 ===');
line('CSS 文件数', files.length);
console.log('');
line('字号种类', fontSizes.size);
for (const [k, v] of top(fontSizes, 8)) console.log('  ' + pad(k, 12) + v + ' 处');
line('≤9px 占比', small + ' / ' + totalFont + ' = ' + Math.round((small / totalFont) * 100) + '%');
console.log('');
line('圆角种类', radii.size);
console.log('  ' + top(radii, 8).map(([k, v]) => k + '×' + v).join('  '));
console.log('');
line('十六进制颜色', hexUnique + ' 种 / ' + hexTotal + ' 处');
line('--ds-* 令牌引用', tokenUse + ' 处');
line('令牌覆盖率', totalFont ? Math.round((tokenUse / (hexTotal + tokenUse)) * 100) + '%（按颜色+令牌合计）' : '0%');
