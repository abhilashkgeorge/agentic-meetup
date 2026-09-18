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
// THE COST OF THAT LINE, found the first time the bundle reached into
// react-native-reanimated (expo-gl requires it): reanimated and react-native-worklets
// each keep their own nested semver@7 because the workspace root holds semver@6 for
// the build tooling, and with hierarchical lookup off Metro never looks in a nested
// node_modules -- so `semver/functions/satisfies` resolved to the root's v6, which has
// no `functions/`. The app therefore lists semver@7 itself, so the first path above
// holds a copy Metro can see.

// three.js model loading, for the avatar surface
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');

// ONE three, not two. three's package.json `exports` hands `three.module.js` to an
// `import` and `three.cjs` to a `require`, and @react-three/fiber's build does both --
// so with package exports on (the Expo default) Metro bundled the library twice and
// three itself said so on the console: "Multiple instances of Three.js being
// imported." Two copies double the memory and break every `instanceof` between
// them. Exact 'three' only; subpaths such as three/examples/jsm pass through.
// `exports` hides the subpath, but a bare require resolves the `require` condition,
// which IS the CJS build.
const threeCjs = require.resolve('three', { paths: [workspaceRoot] });
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeCjs };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
