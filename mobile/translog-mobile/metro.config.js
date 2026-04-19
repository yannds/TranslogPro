// Metro config — étend la portée de watchFolders pour permettre les imports
// qui dépassent la racine du package (partage des locales i18n avec le frontend web).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Repo root — un cran au-dessus du monorepo mobile.
const repoRoot = path.resolve(__dirname, '../..');

config.watchFolders = [repoRoot];

// Autorise la résolution des node_modules du repo root ET du projet mobile
// (évite le "Can't find module" pour des deps hissées au root).
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];

// Unstable : force un seul module `react` (évite les hooks invalides si le
// root a une autre version).
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
