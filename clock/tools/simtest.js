/* Headless check on the balance and stepping loop.
 * Usage: node tools/simtest.js
 * Healthy: a handful of steps per minute, no double swings, 0% out of support.
 */
const path = require('path');
global.window = { CLOCK: {} };
['util','rig','draw2d','schedule','figure'].forEach(f => require(path.resolve(__dirname,'..','js',f+'.js')));
const C = global.window.CLOCK, U = C.util;
const w=1440,h=900, R=Math.min(w*0.345,h*0.325), H=R*1.25, cy=h*0.5;
const L={w,h,dpr:1,cx:w/2,cy,R,fig:{H,feetY:cy+R*0.78,baseX:w/2+R*0.10},panel:{}};
const fig = new C.Figure(1234);
let t0 = new Date(2026,8,19,10,36,0,0).getTime();
let steps=0, lastSwing=[0,0], maxHip=-1e9, minHip=1e9, comOut=0, frames=0, nan=0;
let prevFoot=[0,0], flips=0, prevDir=[0,0];
for (let i=0;i<60*120;i++){          // 120 s at 60fps
  const now = new Date(t0 + i*1000/60);
  const S = C.schedule.read(now, L);
  const SA = C.schedule.read(new Date(t0 + i*1000/60 + 210), L);
  fig.update(1/60, S, L, (t0+i*1000/60)/1000, SA);
  const p = fig.pose(L, (t0+i*1000/60)/1000);
  frames++;
  for (const key of ['pelvis','shL','handB','kneeL','ankR']) {
    if (!isFinite(p[key].x)||!isFinite(p[key].y)) nan++;
  }
  const f=fig.body.feet;
  for (let k=0;k<2;k++){
    const moving = f[k].state !== 'plant';
    if (moving && !lastSwing[k]) {
      steps++;
      const dir = Math.sign(f[k].to - f[k].x);
      if (dir!==0 && dir===-prevDir[k]) flips++;
      prevDir[k]=dir;
    }
    lastSwing[k]=moving;
  }
  const span=[Math.min(f[0].x,f[1].x),Math.max(f[0].x,f[1].x)];
  const com = U.lerp(fig.body.pos.x, 0, 0.2);
  if (com < span[0]-0.02*H || com > span[1]+0.02*H) comOut++;
  maxHip=Math.max(maxHip,p.pelvis.y); minHip=Math.min(minHip,p.pelvis.y);
  // both feet swinging at once would be a fall
  if (f[0].state!=='plant' && f[1].state!=='plant') console.log('!! both feet off the ground at frame',i);
}
console.log('frames',frames,'NaN',nan);
console.log('steps in 120s:',steps, ' (=',(steps/2).toFixed(1),'per minute per foot)');
console.log('direction reversals between consecutive steps of same foot:',flips);
console.log('hip height range px:',(maxHip-minHip).toFixed(1),'=',((maxHip-minHip)/H*100).toFixed(1),'% of H');
console.log('frames with COM outside support:',comOut, (100*comOut/frames).toFixed(1)+'%');
console.log('final stance width:',Math.abs(fig.body.feet[0].x-fig.body.feet[1].x).toFixed(1),'px =',(Math.abs(fig.body.feet[0].x-fig.body.feet[1].x)/H).toFixed(3),'H');
