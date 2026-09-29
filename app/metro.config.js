const { getDefaultConfig } = require('expo/metro-config');
const fs = require('node:fs');
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

// LIVEKIT KEEPS ITS OWN COPIES, and with hierarchical lookup off Metro never saw them.
// The park's voice (2026-09-29): @livekit/react-native carries @livekit/components-react
// (there is none at the root) and web-streams-polyfill 4 (the root has 3) in its own
// node_modules, and the webrtc package its own debug and ms. On the phone voice was off:
// "Unable to resolve module @livekit/components-react". So for a file inside a LiveKit
// package, and only there, the package's own node_modules is looked in first, as Node
// would -- never for React, which must stay one copy.
const LIVEKIT = path.join(workspaceRoot, 'node_modules', '@livekit') + path.sep;
const SINGLE = /^(react|react-native|react-dom)(\/|$)/;
function ownCopy(origin, moduleName) {
  if (!origin || !origin.startsWith(LIVEKIT) || SINGLE.test(moduleName)) return null;
  if (moduleName.startsWith('.') || path.isAbsolute(moduleName)) return null;
  const parts = moduleName.split('/');
  const pkg = moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  for (let dir = path.dirname(origin); dir.startsWith(LIVEKIT); dir = path.dirname(dir)) {
    const nm = path.join(dir, 'node_modules');
    if (fs.existsSync(path.join(nm, pkg, 'package.json'))) return nm;
  }
  return null;
}

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') return { type: 'sourceFile', filePath: threeCjs };
  const own = ownCopy(context.originModulePath, moduleName);
  const ctx = own ? { ...context, nodeModulesPaths: [own, ...context.nodeModulesPaths] } : context;
  return (resolveRequest ?? context.resolveRequest)(ctx, moduleName, platform);
};

module.exports = config;
