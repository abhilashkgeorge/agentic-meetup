const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// three.js model loading goes through Metro's asset pipeline
config.resolver.assetExts.push('glb', 'gltf', 'bin', 'hdr');
module.exports = config;
