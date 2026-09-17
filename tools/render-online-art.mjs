import { mkdir, writeFile } from 'node:fs/promises';
const out = new URL('../public/assets/online/', import.meta.url);
await mkdir(out, { recursive: true });
// Original editable vector compositions. No external images, fonts or emblems.
const car = `<g id="car"><ellipse cx="119" cy="153" rx="113" ry="22" fill="#031425" opacity=".42"/>
<path d="M13 90 43 53 103 27 169 39 193 78 222 97 210 130 69 153 8 123Z" fill="currentColor" stroke="#08233f" stroke-width="5" stroke-linejoin="round"/>
<path d="m44 53 63-21 59 10 20 39-104 29-54-29Z" fill="#e6fbff" opacity=".42"/>
<path d="m63 57 48-15 43 8 18 31-69 18Z" fill="#093147" stroke="#b0edff" stroke-width="3"/>
<path d="m29 81 71 28 111-22 11 10-12 33-141 23L8 123l5-33Z" fill="currentColor"/>
<path d="m14 108 58 18 137-26-5 20-131 29-61-23Z" fill="#071b30"/>
<path d="m77 128 110-22-8 11-92 20Z" fill="#3c546a"/>
<path d="m29 83 53 17 123-24-35 19-88 24-61-19Z" fill="#fff" opacity=".33"/>
<path d="m19 102 44 14-1 10-43-13Z M87 119l29-5-1 9-29 6Z M164 103l34-7-4 11-33 6Z" fill="#bafaff"/>
<g fill="#092033" stroke="#06111f" stroke-width="5"><ellipse cx="57" cy="130" rx="21" ry="29" transform="rotate(-9 57 130)"/><ellipse cx="189" cy="107" rx="19" ry="26" transform="rotate(9 189 107)"/></g>
<g fill="#7aa4b8" stroke="#183b51" stroke-width="5"><ellipse cx="57" cy="130" rx="11" ry="18"/><ellipse cx="189" cy="107" rx="10" ry="16"/></g>
<path d="m18 64 12-15 65 20-5 10Z" fill="#15384e"/><path d="m124 42 13 41" stroke="#d0f5ff" stroke-width="5" opacity=".65"/>
<path d="m94 117 46-10" stroke="#fff" stroke-width="3" opacity=".7"/></g>`;
const ball = `<g id="ball"><circle r="43" fill="url(#metal)" stroke="#022438" stroke-width="5"/><path d="m-14-40 19 24 34 8M5-16-6 14-37 19M-6 14l20 24M-15-2-40-17" fill="none" stroke="#0b324c" stroke-width="9"/><path d="m-13-36 17 22 31 8M2-14-8 12-35 17M-5 17l18 19" fill="none" stroke="#71e7ff" stroke-width="2"/><circle cx="-13" cy="-20" r="12" fill="#fff" opacity=".48"/></g>`;
let illustration = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="#126eaa"/><stop offset="1" stop-color="#04233f"/></linearGradient><radialGradient id="aura"><stop stop-color="#b1ffff" stop-opacity=".8"/><stop offset="1" stop-color="#04bbeb" stop-opacity="0"/></radialGradient><linearGradient id="metal" x2=".8" y2="1"><stop stop-color="#fff"/><stop offset=".5" stop-color="#bfdeeb"/><stop offset="1" stop-color="#527c9c"/></linearGradient>${car}${ball}</defs>`;
const ids = ['team-1', 'team-2', 'team-3', 'bots', 'ranked'];
for (const [index, id] of ids.entries()) {
  illustration += `<view id="${id}" viewBox="0 ${index * 500} 800 500"/><g transform="translate(0 ${index * 500})"><rect width="800" height="500" fill="url(#bg)"/><ellipse cx="400" cy="190" rx="350" ry="230" fill="url(#aura)"/>
  <path d="m-50 470 190-440 230 110 68-210 80 228L800 35l-60 387Z" fill="#1fd2ef" opacity=".13"/>
  <path d="M-20 337Q400 214 820 337M-20 352Q400 229 820 352" fill="none" stroke="#8deeff" stroke-width="3" opacity=".32"/>`;
  if (index < 3) {
    const n = index + 1;
    for (let side = 0; side < 2; side++) for (let p = n - 1; p >= 0; p--) {
      const scale = n === 1 ? 1.26 : n === 2 ? .99 : .83;
      const x = side ? 770 - p * 64 : 28 + p * 66, y = 186 - p * 56;
      illustration += `<g transform="translate(${x} ${y}) scale(${side ? -scale : scale} ${scale})" color="${side ? '#ff9b2f' : '#28b7ff'}"><use href="#car"/></g>`;
    }
    illustration += `<g transform="translate(405 ${index === 2 ? 270 : 250}) scale(${index ? 1.06 : 1.3})"><use href="#ball"/></g>`;
    illustration += `<path d="M368 168 397 132l-11 46 25-23-8 49" fill="none" stroke="#e7fdff" stroke-width="7"/>`;
  } else if (id === 'bots') {
    illustration += `<g transform="translate(285 202) rotate(-8) scale(1.42)" color="#fb923d"><use href="#car"/></g>
    <g transform="translate(154 119)"><path d="M-56-41Q-56-60-35-60H42Q61-60 61-40V25Q61 47 39 47H-33Q-56 47-56 26Z" fill="#0a273f" stroke="#8eeeff" stroke-width="7"/><path d="M4-60v-22" stroke="#b4f6ff" stroke-width="8"/><circle cy="-88" cx="4" r="10" fill="#5eedc9"/><rect x="-35" y="-25" width="76" height="32" rx="9" fill="#175577"/><path d="M-20-9h9M17-9h9" stroke="#d2ffff" stroke-width="10" stroke-linecap="round"/><path d="M-13 28h34" stroke="#5beed0" stroke-width="7"/></g>
    <g transform="translate(656 155) scale(.84)"><use href="#ball"/></g><path d="m55 330 103-22M41 359l150-30" stroke="#94f6ed" stroke-width="12" stroke-linecap="round"/>`;
  } else {
    illustration += `<path d="m401 34 126 74-25 146-101 75-102-75-24-146Z" fill="#062c4a" stroke="#ffda77" stroke-width="9"/><path d="m401 68 88 52-18 113-70 53-71-53-18-113Z" fill="#186899" stroke="#fff1b2" stroke-width="3"/><path d="m401 104 45 68-45 66-45-66Z" fill="#ffe086"/><path d="m338 173 26 34-24 17-33-65M464 173l-26 34 24 17 33-65" fill="#ffc158"/>
    <g transform="translate(105 275) scale(.88)" color="#38bafa"><use href="#car"/></g><g transform="translate(700 263) scale(-.88 .88)" color="#ffac4b"><use href="#car"/></g>`;
  }
  illustration += '<path d="m91 97 15 5-5 16-15-5ZM682 70l19-6 5 17-18 5ZM710 283l9 4-3 13-10-5Z" fill="#b9fbff" opacity=".8"/></g>';
}
illustration += '</svg>';
await writeFile(new URL('illustrations.svg', out), illustration);
const colors = ['#7894a6','#d79465','#bcd4e7','#ffd166','#5ce0da','#70baff','#cda5ff','#ff6b8b','#f1f8ff'];
let ranks = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><defs><linearGradient id="shine" x2="1" y2="1"><stop stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>';
for (let i = 0; i < 23; i++) {
  const tier = i === 0 ? 0 : Math.min(8, 1 + Math.floor((i - 1) / 3)), sub = (i - 1) % 3 + 1, c = colors[tier];
  ranks += `<view id="rank-${i}" viewBox="0 ${i * 180} 180 180"/><g transform="translate(0 ${i * 180})"><path d="m90 14 55 28 12 63-27 38-40 25-40-25-27-38 12-63Z" fill="#0a233c" stroke="${c}" stroke-width="5"/>`;
  if (!i) ranks += '<path d="m90 45 27 44-27 44-27-44Z" fill="none" stroke="#839bb0" stroke-width="5"/><circle cx="90" cy="89" r="9" fill="#839bb0"/>';
  else {
    if (tier >= 3) ranks += `<path d="m41 68-23-8 9 33 25 18M139 68l23-8-9 33-25 18" fill="${c}"/>`;
    if (tier >= 5) ranks += `<path d="m29 105-18-7 23 34 22 6M151 105l18-7-23 34-22 6" fill="${c}"/>`;
    if (tier >= 7) ranks += `<path d="m58 34 10-24 22 17 22-17 10 24-32 13Z" fill="${c}"/>`;
    const side = 19 + tier * 2;
    ranks += `<path d="m90 43 ${side} 43-${side} 41-${side}-41Z" fill="${c}"/><path d="m90 47 ${side - 4} 39-18-8-5 44-16-36Z" fill="url(#shine)"/>`;
    for (let j = 0; j < sub; j++) ranks += `<path d="m${90 - (sub - 1) * 11 + j * 22} 133 6 7-6 7-6-7Z" fill="${c}"/>`;
    if (i === 22) ranks += '<path d="M90 34v26M90 111v18M52 86h24M105 86h24M62 55l17 18M103 101l16 17M62 117l17-17M103 71l16-17" stroke="#d0faff" stroke-width="4"/>';
  }
  ranks += '</g>';
}
ranks += '</svg>';
await writeFile(new URL('ranks.svg', out), ranks);
console.log('Created five original playlist/mode illustrations and 23 editable rank badges.');
