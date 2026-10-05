globalThis.ProgressEvent ??= class extends Event { constructor(t,i={}){super(t);Object.assign(this,i);} };
const { makeGarden } = await import('./src/features/world/garden.ts');
const { buildGarden } = await import('./src/features/world/garden-mesh.ts');
const g = makeGarden('cubbon-park');
const built = buildGarden(g, { night: false, accent: '#6d5efc' });
let calls = 0, tris = 0;
const rows = [];
built.group.traverse((o) => {
  if (!o.isMesh) return;
  const geo = o.geometry;
  const per = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
  const n = o.isInstancedMesh ? o.count : 1;
  calls++; tris += per * n;
  rows.push([o.name || o.type, n, Math.round(per), Math.round(per * n)]);
});
rows.sort((a, b) => b[3] - a[3]);
console.log('park ground: ' + calls + ' draw calls, ' + Math.round(tris).toLocaleString() + ' triangles');
for (const [n, c, p, t] of rows.slice(0, 10)) {
  console.log('  ' + String(n).padEnd(16), String(c).padStart(6) + ' x', String(p).padStart(5), '=', t.toLocaleString());
}
