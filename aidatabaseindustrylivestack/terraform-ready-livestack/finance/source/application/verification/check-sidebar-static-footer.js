#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_FILE = path.join(ROOT, 'frontend', 'src', 'App.jsx');
const STYLES_FILE = path.join(ROOT, 'frontend', 'src', 'styles', 'index.css');
const appSource = fs.readFileSync(APP_FILE, 'utf8');
const styles = fs.readFileSync(STYLES_FILE, 'utf8');
const failures = [];

function fail(message) {
  failures.push(message);
}

function getRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...styles.matchAll(new RegExp(`(?:^|[\\s,])${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'gm'))];
  if (!matches.length) {
    fail(`Missing CSS rule for ${selector}.`);
    return '';
  }
  return matches.map((match) => match[1]).join('\n');
}

function expectDeclaration(rule, selector, declaration) {
  if (!rule.includes(declaration)) {
    fail(`${selector} is missing "${declaration}".`);
  }
}

const sidebar = getRule('.app-sidebar');
expectDeclaration(sidebar, '.app-sidebar', 'position: sticky;');
expectDeclaration(sidebar, '.app-sidebar', 'top: 0;');
expectDeclaration(sidebar, '.app-sidebar', 'height: 100vh;');
expectDeclaration(sidebar, '.app-sidebar', 'max-height: 100vh;');
expectDeclaration(sidebar, '.app-sidebar', 'display: flex;');
expectDeclaration(sidebar, '.app-sidebar', 'flex-direction: column;');

const sidebarHeader = getRule('.app-sidebar-header');
expectDeclaration(sidebarHeader, '.app-sidebar-header', 'flex-shrink: 0;');

const sidebarFooter = getRule('.app-sidebar-footer');
expectDeclaration(sidebarFooter, '.app-sidebar-footer', 'margin-top: auto;');
expectDeclaration(sidebarFooter, '.app-sidebar-footer', 'flex-shrink: 0;');

const nav = getRule('.app-nav');
expectDeclaration(nav, '.app-nav', 'min-height: 0;');
expectDeclaration(nav, '.app-nav', 'flex: 1 1 auto;');
expectDeclaration(nav, '.app-nav', 'overflow-y: auto;');

const mobileSidebarMatch = styles.match(/@media \(max-width: 960px\)\s*\{[\s\S]*?\.app-sidebar\s*\{([\s\S]*?)\}/m);
if (!mobileSidebarMatch) {
  fail('Missing mobile .app-sidebar override inside max-width: 960px media query.');
} else {
  const mobileSidebar = mobileSidebarMatch[1];
  expectDeclaration(mobileSidebar, '@media max-width 960px .app-sidebar', 'position: static;');
  expectDeclaration(mobileSidebar, '@media max-width 960px .app-sidebar', 'height: auto;');
  expectDeclaration(mobileSidebar, '@media max-width 960px .app-sidebar', 'max-height: none;');
}

if (!appSource.includes('Active finance dataset')) {
  fail('App.jsx should label the sidebar dataset card as "Active finance dataset".');
}

if (failures.length) {
  console.error('Sidebar static footer check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Sidebar static footer check passed.');
