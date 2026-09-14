const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Monorepo wiring. Without these three lines Metro cannot resolve @clone/shared
// (it lives outside the app dir) or the hoisted react-native at the workspace root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Hoisting means one copy of react/react-native; disabling hierarchical lookup
// stops Metro walking up and finding a second one, which produces the classic
// "Invalid hook call" / two-copies-of-React failure.
config.resolver.disableHierarchicalLookup = true;

// three.js model loading, for the avatar surface
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');

module.exports = config;
