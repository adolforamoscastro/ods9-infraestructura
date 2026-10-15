(() => {
  "use strict";
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const roomEl = document.getElementById("room-name");
  const statusEl = document.getElementById("status");
  const messageEl = document.getElementById("game-message");
  const restartBtn = document.getElementById("restart");

  const W = canvas.width, H = canvas.height;
  const rooms = [
    { name: "Sala", x: 35, y: 35, w: 400, h: 180, walls: ["top","right","bottom","left"] },
    { name: "Cocina", x: 465, y: 35, w: 400, h: 180, walls: ["top","right","bottom","left"] },
    { name: "Baño", x: 35, y: 245, w: 400, h: 180, walls: ["top","right","bottom","left"] },
    { name: "Dormitorio", x: 465, y: 245, w: 400, h: 180, walls: ["top","right","bottom","left"] }
  ];
  const wallNames = ["top", "right", "bottom", "left"];
  const keys = new Set();
  let player, score, leaks, elapsed, ended, lastFrame, spawnClock, repairedCount;

  function reset() {
    player = { x: 450, y: 230, r: 10, speed: 205 };
    score = 0; elapsed = 0; ended = false; lastFrame = 0; spawnClock = 0; repairedCount = 0;
    leaks = [];
    rooms.forEach((room, ri) => wallNames.forEach((side, wi) => {
      leaks.push({ room: ri, side, heat: Math.random() * .18, age: 0, active: false, seed: Math.random() * 10, offset: .22 + Math.random() * .56 });
    }));
    leaks.slice(0, 3).forEach((leak, i) => { leak.active = true; leak.heat = .28 + i * .08; });
    message("Usa las flechas o WASD para moverte. Acércate a una pared caliente y pulsa ESPACIO.");
    updateHud();
    draw();
  }

  function message(text) { messageEl.textContent = text; }
  function updateHud() {
    scoreEl.textContent = String(score).padStart(4, "0");
    const current = rooms.find(r => player.x >= r.x && player.x <= r.x+r.w && player.y >= r.y && player.y <= r.y+r.h);
    roomEl.textContent = current ? current.name : "Pasillo";
    const maxHeat = Math.max(0, ...leaks.filter(l => l.active).map(l => l.heat));
    statusEl.className = maxHeat > .82 ? "status-danger" : maxHeat > .52 ? "status-warning" : "status-safe";
    statusEl.textContent = maxHeat > .82 ? "PELIGRO" : maxHeat > .52 ? "ALERTA" : "ESTABLE";
  }
  function wallPoint(leak) {
    const r = rooms[leak.room], o = leak.offset;
    if (leak.side === "top") return { x: r.x + r.w*o, y: r.y };
    if (leak.side === "bottom") return { x: r.x + r.w*o, y: r.y+r.h };
    if (leak.side === "left") return { x: r.x, y: r.y+r.h*o };
    return { x: r.x+r.w, y: r.y+r.h*o };
  }
  function distToLeak(leak) {
    const p = wallPoint(leak);
    return Math.hypot(player.x-p.x, player.y-p.y);
  }
  function repair() {
    if (ended) { reset(); return; }
    const nearby = leaks.filter(l => l.active).sort((a,b) => distToLeak(a)-distToLeak(b))[0];
    if (nearby && distToLeak(nearby) < 54) {
      nearby.active = false; nearby.heat = 0; score += 100; repairedCount++;
      message("¡Filtración reparada! +100 puntos. Sigue revisando las habitaciones.");
      if (repairedCount === 16) {
        ended = true; message("¡Excelente trabajo! Reparaste todas las filtraciones. Pulsa Reiniciar para jugar otra vez.");
      }
      updateHud();
    } else {
      message("Acércate más a una pared amarilla o roja antes de pulsar ESPACIO.");
    }
  }
  function roundedRect(x,y,w,h,r,fill,stroke) {
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fillStyle=fill; ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
  }
  function drawRoom(room, ri) {
    roundedRect(room.x,room.y,room.w,room.h,7,"#f0f2df","#b8cbb0");
    ctx.fillStyle="#dce7ce";
    for(let x=room.x+22;x<room.x+room.w-10;x+=26){ctx.fillRect(x,room.y+15,1,room.h-30);}
    for(let y=room.y+20;y<room.y+room.h-10;y+=26){ctx.fillRect(room.x+12,y,room.w-24,1);}
    // Furniture gives each room a distinct visual identity.
    if(ri===0){roundedRect(room.x+125,room.y+62,135,60,8,"#b3c9a4","#8fae8c");roundedRect(room.x+145,room.y+72,44,18,4,"#e9efdd");roundedRect(room.x+195,room.y+72,44,18,4,"#e9efdd");}
    if(ri===1){roundedRect(room.x+65,room.y+55,270,55,5,"#c2d0ad","#91ad8b");for(let i=0;i<3;i++)roundedRect(room.x+85+i*82,room.y+66,54,28,3,"#e4ebd5");}
    if(ri===2){roundedRect(room.x+260,room.y+45,65,80,18,"#bfd0b8","#93ad91");roundedRect(room.x+274,room.y+56,37,25,10,"#edf1df");}
    if(ri===3){roundedRect(room.x+90,room.y+50,175,82,6,"#b1c7a2","#8eaa85");roundedRect(room.x+105,room.y+61,64,25,4,"#e6ecda");roundedRect(room.x+176,room.y+61,64,25,4,"#e6ecda");}
    ctx.fillStyle="#46664c";ctx.font="bold 13px Manrope, Arial";ctx.fillText(room.name.toUpperCase(),room.x+14,room.y+25);
    // Doorway gaps in the room outlines.
    ctx.fillStyle="#f0f2df";
    ctx.fillRect(room.x+room.w*.45,room.y-3,45,7);
    ctx.fillRect(room.x+room.w-3,room.y+room.h*.45,7,38);
  }
  function drawLeak(leak, now) {
    if(!leak.active) return;
    const r=rooms[leak.room], p=wallPoint(leak);
    const len=34, horizontal=leak.side==="top"||leak.side==="bottom";
    const heat=leak.heat, color=heat>.78?"#e94f3d":heat>.48?"#f2b83f":"#f6dc66";
    ctx.save();ctx.lineCap="round";
    // A glowing patch plus a clear colored segment on the wall.
    ctx.shadowBlur=heat>.75?18:10;ctx.shadowColor=color;ctx.strokeStyle=color;ctx.lineWidth=8;
    ctx.beginPath();
    if(horizontal){ctx.moveTo(p.x-len/2,p.y);ctx.lineTo(p.x+len/2,p.y);}
    else{ctx.moveTo(p.x,p.y-len/2);ctx.lineTo(p.x,p.y+len/2);}
    ctx.stroke();ctx.shadowBlur=0;
    ctx.fillStyle=color;ctx.globalAlpha=.18+.12*Math.sin(now/180+leak.seed);
    ctx.beginPath();ctx.arc(p.x,p.y,18+heat*12,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  function drawPlayer() {
    // Simple friendly repair technician, drawn directly on canvas.
    ctx.save();ctx.translate(player.x,player.y);
    ctx.fillStyle="#1c3d37";ctx.beginPath();ctx.ellipse(0,11,12,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#426c5a";ctx.beginPath();ctx.roundRect(-8,-1,16,17,5);ctx.fill();
    ctx.fillStyle="#efb88d";ctx.beginPath();ctx.arc(0,-8,7,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#e3efbd";ctx.beginPath();ctx.arc(0,-11,8,Math.PI,Math.PI*2);ctx.fill();
    ctx.fillStyle="#f8f6e9";ctx.fillRect(-4,-8,2,2);ctx.fillRect(3,-8,2,2);
    ctx.restore();
  }
  function draw(now=0) {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="#dce8d0";ctx.fillRect(0,0,W,H);
    // Hallway paths connect the four rooms.
    ctx.fillStyle="#c9d9be";ctx.fillRect(435,35,30,390);ctx.fillRect(35,215,830,30);
    rooms.forEach(drawRoom);
    leaks.forEach(l=>drawLeak(l,now));
    if(!ended) drawPlayer();
    if(ended) {
      ctx.fillStyle="#102e2bcc";ctx.fillRect(0,0,W,H);
      ctx.fillStyle="#f5f8ed";ctx.textAlign="center";ctx.font="800 32px Manrope, Arial";
      ctx.fillText(repairedCount===16?"¡INFRAESTRUCTURA SEGURA!":"FIN DEL JUEGO",W/2,H/2-12);
      ctx.font="14px Manrope, Arial";ctx.fillText(repairedCount===16?`Puntuación final: ${score}`:"Una pared permaneció demasiado tiempo en rojo.",W/2,H/2+20);
      ctx.font="12px Manrope, Arial";ctx.fillText("Pulsa Reiniciar para volver a intentarlo",W/2,H/2+48);ctx.textAlign="left";
    }
  }
  function loop(timestamp) {
    if(!lastFrame) lastFrame=timestamp;
    const dt=Math.min((timestamp-lastFrame)/1000,.04);lastFrame=timestamp;
    if(!ended) {
      let dx=0,dy=0;
      if(keys.has("arrowleft")||keys.has("a"))dx--;
      if(keys.has("arrowright")||keys.has("d"))dx++;
      if(keys.has("arrowup")||keys.has("w"))dy--;
      if(keys.has("arrowdown")||keys.has("s"))dy++;
      if(dx&&dy){dx*=.7071;dy*=.7071;}
      player.x=Math.max(18,Math.min(W-18,player.x+dx*player.speed*dt));
      player.y=Math.max(18,Math.min(H-18,player.y+dy*player.speed*dt));
      elapsed+=dt;spawnClock+=dt;
      // Add new leaks gradually so the player has to inspect multiple rooms.
      if(spawnClock>5.5 && leaks.some(l=>!l.active && l.heat===0)===false && repairedCount<16) {
        const candidates=leaks.filter(l=>!l.active && l.heat>0);
        if(candidates.length){const next=candidates[Math.floor(Math.random()*candidates.length)];next.active=true;next.heat=.25;}
        spawnClock=0;
      } else if(spawnClock>5.5) {
        const inactive=leaks.filter(l=>!l.active && l.heat<.01);
        if(inactive.length && repairedCount<16){const next=inactive[Math.floor(Math.random()*inactive.length)];next.active=true;next.heat=.22;}
        spawnClock=0;
      }
      leaks.forEach(l=>{
        if(!l.active)return;
        l.heat=Math.min(1,l.heat+dt*.105);
        l.age+=dt;
        if(l.heat>=1){ended=true;message(`¡Game over! La filtración en ${rooms[l.room].name} permaneció demasiado tiempo en rojo.`);}
      });
      updateHud();
    }
    draw(timestamp);
    requestAnimationFrame(loop);
  }
  document.addEventListener("keydown",e=>{
    const key=e.key.toLowerCase();
    if(["arrowup","arrowdown","arrowleft","arrowright"," "].includes(key))e.preventDefault();
    if(key===" "){if(!e.repeat)repair();return;}
    keys.add(key);
  });
  document.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur",()=>keys.clear());
  restartBtn.addEventListener("click",reset);
  reset();
  requestAnimationFrame(loop);
})();
