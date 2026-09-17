// Verify actual browser GLTF decoding and wheel dependencies without GPU rendering.
const page = await (await fetch('http://127.0.0.1:9287/json/new?http://127.0.0.1:4287/favicon.ico', {method:'PUT'})).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, {once:true}));
const timer = setTimeout(() => { console.error('Model check timed out'); ws.close(); process.exitCode = 1; }, 90000);
ws.addEventListener('message', ({data}) => {
  const result = JSON.parse(data);
  if (result.id !== 1) return;
  clearTimeout(timer);
  console.log(JSON.stringify(result.result ?? result.error, null, 2));
  if (result.error || result.result?.exceptionDetails) process.exitCode = 1;
  ws.close();
});
await new Promise(r => setTimeout(r, 1000));
ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{awaitPromise:true, returnByValue:true, expression:`(async () => {
  const {sketchfabModels} = await import('/src/vehicles/imported-models.js');
  const {GARAGE_CARS} = await import('/src/settings/car-customization.js');
  const result = [];
  for (const {id} of GARAGE_CARS) {
    const car = await sketchfabModels.loadCar(id);
    if (car.wheels.length !== 4 || car.wheels.some(w => !w.children.length)) throw Error(id + ': missing wheels');
    result.push({id, bodyMeshes:car.body.children.length, wheels:car.wheels.length});
  }
  return result;
})()`}}));
