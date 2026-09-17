// Deterministic native fixtures. These setters are never exposed over the network.
export function placeCars(arena, { contact = false } = {}) {
    const m = arena.module;
    for (let slot = 0; slot < arena.configs.length; slot++) {
        const forward = slot % 2 === 0 ? 1 : -1, lane = Math.floor(slot / 2);
        const values = [contact ? lane * 300 : 500 + lane * 650, -forward * (contact ? 500 + lane * 400 : 2500), 17,
            0, forward, 0, -forward, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 100, 1, 0, 0, 0, 0];
        m.HEAPF32.set(values, arena.scratch / 4);
        if (m._physics_setCarState(slot, arena.scratch) !== 1)
            throw Error('Fixture placement failed');
    }
    arena.setBall([0, 0, 93, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    m._physics_step(0);
}
export const contactFixture = arena => placeCars(arena, { contact: true });
export const drive = t => [1, t > 3500 && t < 7000 ? .35 : 0, 0, 0, 0, +(t > 2200 && t < 2320), +(t < 1900), 0];
export const aerial = t => [1, 0, t > 1800 && t < 3500 ? -.5 : 0, 0, t > 2000 && t < 3000 ? .2 : 0,
    +(t > 1800 && t < 1950 || t > 2300 && t < 2400), +(t < 4000), 0];
export const charge = t => [1, 0, 0, 0, 0, 0, +(t < 1000), 0];
export const opponent = (t, i) => [1, Math.sin(t / 500 + i) * .3, 0, 0, 0, +(t % 2400 > 200 && t % 2400 < 350), +(t % 1800 < 500), 0];
