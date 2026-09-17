// Offline production-art renderer. Runs only in the finite Playwright art task.
// Uses existing approved game meshes/materials; does not mutate runtime assets.
import { Scene, WebGLRenderer, PerspectiveCamera, Box3, Vector3, SRGBColorSpace, e0, eo } from '/src/vendor/three.js';
import { sketchfabModels } from '/src/vehicles/imported-models.js';
const scene = new Scene(), camera = new PerspectiveCamera(32, 4 / 3, .1, 5000);
const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(960, 720); renderer.setPixelRatio(1); renderer.outputColorSpace = SRGBColorSpace;
renderer.setClearColor(0x000000, 0); renderer.toneMappingExposure = 1.2;
scene.add(new e0(0xd5f4ff, 0x143456, 2));
const sun = new eo(0xffe4bd, 3); sun.position.set(150, 300, 100); scene.add(sun);
const rim = new eo(0x9feaff, 2); rim.position.set(-150, 120, -120); scene.add(rim);
const car = await sketchfabModels.preview('fennec');
car.traverse(object => { if (object.material) object.material = Array.isArray(object.material) ? object.material.map(m => m.clone()) : object.material.clone(); });
const ball = await sketchfabModels.loadBall(45);
function crop(source) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (pixels[(y * canvas.width + x) * 4 + 3] > 5) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right <= left || bottom <= top) throw Error('Artwork mesh produced an empty render');
  const result = document.createElement('canvas'); result.width = right - left + 5; result.height = bottom - top + 5;
  result.getContext('2d').drawImage(canvas, left - 2, top - 2, result.width, result.height, 0, 0, result.width, result.height);
  return result;
}
function subject(object, paint) {
  if (paint) car.traverse(mesh => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) if (m?.uniforms?.uGaragePaint) {
      m.uniforms.uGaragePaint.value = 1; m.uniforms.uFace.value.set(paint); m.uniforms.uPearl.value.set(paint);
      m.uniforms.uRoughness.value = .3; m.uniforms.uMetalness.value = .64; m.uniforms.uFog.value = 0;
    }
  });
  scene.add(object); object.rotation.set(-.05, -.12, .07); object.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(object), center = bounds.getCenter(new Vector3()), span = bounds.getSize(new Vector3());
  const radius = Math.max(span.x, span.y, span.z);
  camera.position.copy(center).add(new Vector3(1.38, .94, 1.58).multiplyScalar(radius)); camera.lookAt(center);
  renderer.render(scene, camera); const image = crop(renderer.domElement); scene.remove(object); return image;
}
const blue = subject(car, '#18a8ed'), orange = subject(car, '#ff9a24'), sphere = subject(ball);
const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 625;
const ctx = canvas.getContext('2d');
function background(ranked = false) {
  const grad = ctx.createLinearGradient(0, 0, 1000, 625); grad.addColorStop(0, '#18a7e1'); grad.addColorStop(.5, '#0b75b5'); grad.addColorStop(1, '#062441');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 1000, 625);
  const halo = ctx.createRadialGradient(540, 190, 10, 500, 280, 480); halo.addColorStop(0, ranked ? '#95dfffaa' : '#8dfaffaa'); halo.addColorStop(1, '#38cbff00');
  ctx.fillStyle = halo; ctx.fillRect(0, 0, 1000, 625);
  ctx.strokeStyle = '#a4eaff45'; ctx.lineWidth = 3;
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-140 + i * 205, 700); ctx.lineTo(310 + i * 145, -70); ctx.stroke(); }
  ctx.strokeStyle = '#acf3ff50'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(500, 535, 650, 140, 0, Math.PI, 2 * Math.PI); ctx.stroke();
  ctx.fillStyle = '#ffffffaa'; for (const [x, y, r] of [[55, 138, 3], [795, 87, 4], [685, 175, 2], [139, 369, 2], [920, 336, 3]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fill(); }
}
function draw(image, x, y, width, mirror = false, glow = '#42d8ff') {
  ctx.save(); ctx.translate(x + (mirror ? width : 0), y); if (mirror) ctx.scale(-1, 1);
  ctx.shadowColor = glow; ctx.shadowBlur = 28; ctx.drawImage(image, 0, 0, width, width * image.height / image.width);
  ctx.restore();
}
function trail(x, y, flip = false) {
  ctx.save(); ctx.translate(x, y); if (flip) ctx.scale(-1, 1);
  for (let i = 0; i < 3; i++) { ctx.strokeStyle = ['#affbffa0', '#42d8ffd0', '#ffffffe0'][i]; ctx.lineWidth = 8 - i * 2; ctx.beginPath(); ctx.moveTo(-100 - i * 15, 70 + i * 13); ctx.quadraticCurveTo(-20, 35 + i * 13, 30, 5 + i * 13); ctx.stroke(); }
  ctx.restore();
}
function robot() {
  ctx.save(); ctx.translate(230, 180); ctx.rotate(-.17);
  ctx.fillStyle = '#103454'; ctx.strokeStyle = '#bcf7ff'; ctx.lineWidth = 8; ctx.shadowColor = '#55ddff'; ctx.shadowBlur = 24;
  ctx.beginPath(); ctx.roundRect(-90, -65, 180, 137, 27); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -65); ctx.lineTo(0, -96); ctx.stroke(); ctx.fillStyle = '#88ffcc'; ctx.beginPath(); ctx.arc(0, -108, 13, 0, 7); ctx.fill();
  ctx.fillStyle = '#2e90ba'; ctx.beginPath(); ctx.roundRect(-67, -38, 134, 56, 12); ctx.fill();
  ctx.strokeStyle = '#d7ffff'; ctx.lineWidth = 12; ctx.lineCap = 'round';
  for (const x of [-36, 36]) { ctx.beginPath(); ctx.moveTo(x - 6, -10); ctx.lineTo(x + 6, -10); ctx.stroke(); }
  ctx.strokeStyle = '#7fffd4'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-28, 48); ctx.lineTo(28, 48); ctx.stroke(); ctx.restore();
}
async function rankEmblem() {
  const img = new Image(); img.src = '/assets/online/ranks.svg#rank-21'; await img.decode();
  ctx.save(); ctx.shadowColor = '#ffe69c'; ctx.shadowBlur = 30; ctx.drawImage(img, 325, 30, 350, 350); ctx.restore();
}
window.renderOnlineArtwork = async kind => {
  background(kind === 'ranked');
  if (kind.startsWith('team-')) {
    const n = Number(kind.slice(-1));
    const layouts = n === 1 ? [[-25, 235, 470]] : n === 2 ? [[60, 95, 350], [-20, 305, 420]] : [[110, 55, 300], [38, 218, 330], [-10, 390, 350]];
    for (const [x, y, w] of layouts) { trail(x + 15, y + 70); draw(blue, x, y, w); trail(1000 - x - 15, y + 70, true); draw(orange, 1000 - x - w, y, w, true, '#ffbf54'); }
    draw(sphere, n === 1 ? 390 : 413, n === 1 ? 162 : 242, n === 1 ? 230 : 180, false, '#adf6ff');
  } else if (kind === 'bots') {
    robot(); trail(310, 450); draw(orange, 290, 236, 665, false, '#ffcc70'); draw(sphere, 733, 63, 150);
  } else {
    await rankEmblem(); draw(blue, -5, 330, 435); draw(orange, 565, 330, 435, true, '#ffd374');
  }
  return canvas.toDataURL('image/webp', .92).split(',')[1];
};
window.onlineArtworkReady = true;
