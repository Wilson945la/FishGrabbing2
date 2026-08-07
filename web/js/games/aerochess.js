(() => {
  'use strict';

  const N = 15, CELL_PX = 55, PAD = 16, C0 = 4, C1 = 10;
  const T_EMPTY = 0, T_PATH = 2, T_START = 3, T_HOME = 4, T_CENTER = 5;
  const PLAYER_COLORS = [
    [232,70,90],[255,205,60],[85,180,230],[95,195,80]
  ];
  const PIECE_COLORS = [
    [170,25,40],[190,135,0],[15,85,155],[25,110,25]
  ];
  const COLOR_NAMES = ['红','黄','蓝','绿'];
  const CLASS_NAMES = ['red','yellow','blue','green'];

  const OUTER_COORDS = [
    [0,7],[0,8],[0,9],[0,10],[1,10],[2,10],[3,10],[4,10],[4,11],[4,12],[4,13],
    [4,14],[5,14],[6,14],[7,14],[8,14],[9,14],[10,14],[10,13],[10,12],[10,11],
    [10,10],[11,10],[12,10],[13,10],[14,10],[14,9],[14,8],[14,7],[14,6],[14,5],
    [14,4],[13,4],[12,4],[11,4],[10,4],[10,3],[10,2],[10,1],[10,0],[9,0],[8,0],
    [7,0],[6,0],[5,0],[4,0],[4,1],[4,2],[4,3],[4,4],[3,4],[2,4],[1,4],[0,4],[0,5],[0,6]
  ];
  const CYCLE = [2,1,3,0];
  const START_PATH_IDX = [3,17,31,45];
  const START_COL_IDX = [3,0,2,1];
  const START_KEY = [10*N+14, 4*N+0, 14*N+4, 0*N+10];
  const START_INDEX = [17,45,31,3];
  const TURN_IN_INDEX = [14,42,28,0];
  const HOME_CELL = -1, FINISH_CELL = -2;
  const EFFECTIVE_OUTER = 51, HOME_RUNWAY_CELLS = 6;
  const TOTAL_PROGRESS = EFFECTIVE_OUTER + HOME_RUNWAY_CELLS;
  const FINISH_PROGRESS = TOTAL_PROGRESS - 1;
  const FLY_FROM_STEP = 18, FLY_TO_STEP = 30;
  const FLY_COLLISION = [[7,3,1],[7,11,0],[3,7,3],[11,7,2]];
  const BASE_STARTS = [[11,11],[0,0],[11,0],[0,11]];

  const CELL_TYPE = Array.from({length:N},()=>new Int8Array(N).fill(T_EMPTY));
  const CELL_COLOR = Array.from({length:N},()=>new Int8Array(N).fill(-1));
  (function initCellMap(){
    let nsp=0;
    for(let i=0;i<56;i++){
      const [r,c]=OUTER_COORDS[i];
      let isStart=false,sc=-1;
      for(let s=0;s<4;s++) if(i===START_PATH_IDX[s]){isStart=true;sc=START_COL_IDX[s];break;}
      if(isStart){CELL_TYPE[r][c]=T_START;CELL_COLOR[r][c]=sc;}
      else{CELL_TYPE[r][c]=T_PATH;CELL_COLOR[r][c]=CYCLE[(nsp+2)%4];nsp++;}
    }
    for(let r=1;r<=6;r++){CELL_TYPE[r][7]=T_HOME;CELL_COLOR[r][7]=3;}
    for(let c=8;c<=13;c++){CELL_TYPE[7][c]=T_HOME;CELL_COLOR[7][c]=0;}
    for(let r=8;r<=13;r++){CELL_TYPE[r][7]=T_HOME;CELL_COLOR[r][7]=2;}
    for(let c=1;c<=6;c++){CELL_TYPE[7][c]=T_HOME;CELL_COLOR[7][c]=1;}
    CELL_TYPE[7][7]=T_CENTER;CELL_COLOR[7][7]=-1;
  })();

  const OUTER_PATH_CELLKEY = OUTER_COORDS.map(([r,c])=>r*N+c);
  const EFFECTIVE_PATH = Array.from({length:4},()=>new Int32Array(EFFECTIVE_OUTER));
  (function(){
    for(let color=0;color<4;color++){
      EFFECTIVE_PATH[color][0]=OUTER_PATH_CELLKEY[START_INDEX[color]];
      let pos=1; const stopAfter=(TURN_IN_INDEX[color]+1)%56;
      for(let step=1;step<56;step++){
        const idx=(START_INDEX[color]+step)%56;
        if(idx===stopAfter)break;
        let other=false;
        for(let s=0;s<4;s++) if(s!==color&&idx===START_INDEX[s]){other=true;break;}
        if(other)continue;
        EFFECTIVE_PATH[color][pos]=OUTER_PATH_CELLKEY[idx];pos++;
      }
    }
  })();
  const HOME_RUNWAY_KEYS = Array.from({length:4},()=>new Int32Array(HOME_RUNWAY_CELLS));
  (function(){
    for(let i=0;i<HOME_RUNWAY_CELLS;i++){
      HOME_RUNWAY_KEYS[3][i]=(1+i)*N+7;
      HOME_RUNWAY_KEYS[0][i]=7*N+(13-i);
      HOME_RUNWAY_KEYS[2][i]=(13-i)*N+7;
      HOME_RUNWAY_KEYS[1][i]=7*N+(1+i);
    }
  })();

  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const rndInt=(n)=>Math.floor(Math.random()*n);
  function cellColorAtKey(k){const r=Math.floor(k/N),c=k%N;if(r<0||r>=N||c<0||c>=N)return -1;return CELL_COLOR[r][c];}
  function mulberry32(a){return function(){let t=a+=0x6D2B79F5;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

  // ---- 模块状态 ----
  let container, boardCanvas, boardCtx, diceCanvas, diceCtx, statusEl, playersEl, hintEl;
  let boardScale=1;
  let root=null; // 模块根 dom（用于 unmount）
  let pulseTimer=null;
  let state=null; // 游戏状态对象

  function buildDOM(c){
    root=document.createElement('div');
    root.style.cssText='width:100%;max-width:460px;display:flex;flex-direction:column;align-items:center;';
    root.innerHTML=`
      <div class="ac-top">
        <span class="ac-status" id="ac-status">准备开始…</span>
      </div>
      <div class="ac-board-wrap"><canvas class="ac-board" id="ac-board"></canvas></div>
      <div class="ac-players" id="ac-players"></div>
      <div class="ac-dice-row">
        <canvas class="ac-dice" id="ac-dice" width="92" height="92"></canvas>
      </div>
      <p class="ac-hint">点击骰子掷骰。摇到6起飞·摇6可再掷，掷骰后点击棋子移动。<br>同色跳格·飞行线直达·连摇3个6全回基地。</p>`;
    c.appendChild(root);
    boardCanvas=root.querySelector('#ac-board');
    diceCanvas=root.querySelector('#ac-dice');
    statusEl=root.querySelector('#ac-status');
    playersEl=root.querySelector('#ac-players');
    hintEl=root.querySelector('.ac-hint');
    boardCtx=boardCanvas.getContext('2d');
    diceCtx=diceCanvas.getContext('2d');
  }

  function resizeBoard(){
    const wrap=boardCanvas.parentElement;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    let cssSize=Math.min((wrap&&wrap.clientWidth)||window.innerWidth-32, 460);
    if(cssSize<80) cssSize=Math.min(window.innerWidth-32, 460);
    const boardPx=N*CELL_PX+PAD*2;
    boardScale=cssSize/boardPx;
    boardCanvas.width=Math.floor(cssSize*dpr);
    boardCanvas.height=Math.floor(cssSize*dpr);
    boardCanvas.style.width=cssSize+'px';
    boardCanvas.style.height=cssSize+'px';
    boardCtx.setTransform(dpr,0,0,dpr,0,0);
    drawBoard();
  }

  const css=(c)=>`rgb(${c[0]},${c[1]},${c[2]})`;
  function roundRect(x,y,w,h,r){const g=boardCtx;const rr=Math.min(r,w/2,h/2);g.beginPath();g.moveTo(x+rr,y);g.arcTo(x+w,y,x+w,y+h,rr);g.arcTo(x+w,y+h,x,y+h,rr);g.arcTo(x,y+h,x,y,rr);g.arcTo(x,y,x+w,y,rr);g.closePath();}

  function drawBoard(){
    if(!boardCtx)return;
    const cw=boardCanvas.clientWidth, ch=boardCanvas.clientHeight;
    boardCtx.save(); boardCtx.setTransform(1,0,0,1,0,0); boardCtx.clearRect(0,0,boardCanvas.width,boardCanvas.height); boardCtx.restore();
    const boardPx=N*CELL_PX+PAD*2;
    const ox=(cw-boardPx*boardScale)/2, oy=(ch-boardPx*boardScale)/2;
    boardCtx.save(); boardCtx.translate(ox,oy); boardCtx.scale(boardScale,boardScale);
    boardCtx.fillStyle='#f0ead8'; roundRect(PAD,PAD,N*CELL_PX,N*CELL_PX,12); boardCtx.fill();
    drawCornerBase(1,0,0); drawCornerBase(3,0,11); drawCornerBase(2,11,0); drawCornerBase(0,11,11);
    const armW=C1-C0+1;
    boardCtx.fillStyle='#fcf6e6';
    roundRect(PAD+C0*CELL_PX,PAD,armW*CELL_PX,N*CELL_PX,8);boardCtx.fill();
    roundRect(PAD,PAD+C0*CELL_PX,N*CELL_PX,armW*CELL_PX,8);boardCtx.fill();
    for(let r=0;r<N;r++)for(let c=0;c<N;c++){
      const t=CELL_TYPE[r][c]; if(t===T_EMPTY)continue;
      const x=PAD+c*CELL_PX,y=PAD+r*CELL_PX,col=CELL_COLOR[r][c];
      if(t===T_PATH)drawPathCell(col,x,y);
      else if(t===T_START)drawStartCell(col,x,y);
      else if(t===T_HOME)drawHomeCell(col,x,y);
      else if(t===T_CENTER)drawCenterCell(x,y);
    }
    drawFlyLines();
    drawAllPieces();
    boardCtx.restore();
  }
  function drawPathCell(col,x,y){boardCtx.fillStyle=css(PLAYER_COLORS[col]);roundRect(x+1,y+1,CELL_PX-2,CELL_PX-2,5);boardCtx.fill();}
  function drawStartCell(col,x,y){boardCtx.fillStyle='#fff';roundRect(x+1,y+1,CELL_PX-2,CELL_PX-2,5);boardCtx.fill();boardCtx.strokeStyle=css(PLAYER_COLORS[col]);boardCtx.lineWidth=2;boardCtx.stroke();const d=CELL_PX/2-2;boardCtx.fillStyle=css(PLAYER_COLORS[col]);boardCtx.beginPath();boardCtx.arc(x+CELL_PX/2,y+CELL_PX/2,d/2,0,Math.PI*2);boardCtx.fill();}
  function drawHomeCell(col,x,y){boardCtx.fillStyle=css(PLAYER_COLORS[col]);roundRect(x+1,y+1,CELL_PX-2,CELL_PX-2,CELL_PX/3);boardCtx.fill();}
  function drawCenterCell(x,y){const cx=x+CELL_PX/2,cy=y+CELL_PX/2,r=CELL_PX/2-2;const sec=[3,0,2,1];for(let i=0;i<4;i++){boardCtx.fillStyle=css(PLAYER_COLORS[sec[i]]);boardCtx.beginPath();boardCtx.moveTo(cx,cy);boardCtx.arc(cx,cy,r,(i*90-45)*Math.PI/180,((i+1)*90-45)*Math.PI/180);boardCtx.closePath();boardCtx.fill();}}
  function drawFlyLines(){const lines=[[3,4,4,10],[4,11,10,10],[11,10,10,4],[10,3,4,4]];const cols=[[85,180,230],[255,205,60],[95,195,80],[232,70,90]];boardCtx.save();boardCtx.setLineDash([10,6]);boardCtx.lineWidth=3;for(let i=0;i<4;i++){const[r1,c1,r2,c2]=lines[i];boardCtx.strokeStyle=css(cols[i]);boardCtx.beginPath();boardCtx.moveTo(PAD+c1*CELL_PX+CELL_PX/2,PAD+r1*CELL_PX+CELL_PX/2);boardCtx.lineTo(PAD+c2*CELL_PX+CELL_PX/2,PAD+r2*CELL_PX+CELL_PX/2);boardCtx.stroke();}boardCtx.restore();}
  function drawCornerBase(colorIdx,sr,sc){
    const bx=PAD+sc*CELL_PX+CELL_PX/2, by=PAD+sr*CELL_PX+CELL_PX/2, size=3*CELL_PX;
    boardCtx.fillStyle=css(PLAYER_COLORS[colorIdx]);roundRect(bx,by,size,size,14);boardCtx.fill();
    boardCtx.strokeStyle='#fff';boardCtx.lineWidth=2.5;boardCtx.stroke();
    const sp=size/4, slots=[[bx+sp,by+sp],[bx+size-sp,by+sp],[bx+sp,by+size-sp],[bx+size-sp,by+size-sp]];
    for(const[sx,sy]of slots){boardCtx.fillStyle='#fff';boardCtx.beginPath();boardCtx.arc(sx,sy,15,0,Math.PI*2);boardCtx.fill();boardCtx.strokeStyle='#666';boardCtx.lineWidth=1;boardCtx.stroke();}
    const clickable=state.waiting&&state.movable===colorIdx&&state.takeoff.has(state.lastDice);
    let si=0;
    for(let i=0;i<4;i++)if(state.pieces[colorIdx][i]===HOME_CELL){drawPieceAt(slots[si][0],slots[si][1],36,colorIdx,clickable);si++;}
    for(let i=0;i<4;i++)if(state.pieces[colorIdx][i]===FINISH_CELL){drawCheckmark(slots[si][0],slots[si][1],36,colorIdx);si++;}
  }
  function drawAllPieces(){
    for(const[kStr,list]of state.boardPieces){
      const k=Number(kStr), r=Math.floor(k/N), c=k%N;
      if(r<0||r>=N||c<0||c>=N)continue;
      const x=PAD+c*CELL_PX, y=PAD+r*CELL_PX;
      for(let i=0;i<list.length;i++){const p=list[i];const dx=(i%2)*5-2,dy=Math.floor(i/2)*5-2;const clickable=state.waiting&&p.color===state.movable;drawPieceAt(x+CELL_PX/2+dx,y+CELL_PX/2+dy,CELL_PX-12,p.color,clickable);}
    }
  }
  function drawCheckmark(cx,cy,size,ci){const r=size/2;boardCtx.fillStyle=css(PIECE_COLORS[ci]);boardCtx.beginPath();boardCtx.arc(cx,cy,r,0,Math.PI*2);boardCtx.fill();boardCtx.strokeStyle='#fff';boardCtx.lineWidth=1.5;boardCtx.stroke();boardCtx.strokeStyle='#fff';boardCtx.lineWidth=3;boardCtx.lineCap='round';boardCtx.lineJoin='round';boardCtx.beginPath();boardCtx.moveTo(cx-r*0.45,cy+r*0.05);boardCtx.lineTo(cx-r*0.1,cy+r*0.4);boardCtx.lineTo(cx+r*0.5,cy-r*0.35);boardCtx.stroke();}
  function drawPieceAt(cx,cy,size,ci,clickable){
    const r=size/2, cur=state.curColor;
    if(ci===cur&&!state.over){boardCtx.fillStyle='rgba(255,235,100,0.55)';boardCtx.beginPath();boardCtx.arc(cx,cy,r+3,0,Math.PI*2);boardCtx.fill();}
    if(clickable){boardCtx.strokeStyle=state.pulse?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.35)';boardCtx.lineWidth=2.5;boardCtx.beginPath();boardCtx.arc(cx,cy,r+5,0,Math.PI*2);boardCtx.stroke();}
    boardCtx.fillStyle='#fff';boardCtx.beginPath();boardCtx.arc(cx,cy,r,0,Math.PI*2);boardCtx.fill();
    const pc=PIECE_COLORS[ci], outer=Math.max(3,Math.floor(size/10));
    boardCtx.strokeStyle=css(pc);boardCtx.lineWidth=outer;boardCtx.beginPath();boardCtx.arc(cx,cy,r-outer/2,0,Math.PI*2);boardCtx.stroke();
    const pad=Math.max(4,Math.floor(size/6)), ir=r-pad;
    boardCtx.lineWidth=Math.max(1,Math.floor(outer/3));boardCtx.beginPath();boardCtx.arc(cx,cy,ir,0,Math.PI*2);boardCtx.stroke();
    boardCtx.save();boardCtx.translate(cx,cy);
    const ROT=[-Math.PI*3/4,Math.PI/4,-Math.PI/4,Math.PI*3/4];boardCtx.rotate(ROT[ci]);
    boardCtx.fillStyle=css(pc);
    const L=ir*2-4;
    if(L>=8){const t=Math.max(2,Math.floor(L/11)),W=L,Tw=Math.max(4,Math.floor(L/3));
      boardCtx.beginPath();boardCtx.ellipse(0,0,t,L/2,0,0,Math.PI*2);boardCtx.fill();
      boardCtx.beginPath();boardCtx.moveTo(t,-L/6);boardCtx.lineTo(t,L/6);boardCtx.lineTo(W/2,0);boardCtx.closePath();boardCtx.fill();
      boardCtx.beginPath();boardCtx.moveTo(-t,-L/6);boardCtx.lineTo(-t,L/6);boardCtx.lineTo(-W/2,0);boardCtx.closePath();boardCtx.fill();
      boardCtx.beginPath();boardCtx.moveTo(t,L/4);boardCtx.lineTo(t,L/2-t);boardCtx.lineTo(Tw/2,L/2-t);boardCtx.closePath();boardCtx.fill();
      boardCtx.beginPath();boardCtx.moveTo(-t,L/4);boardCtx.lineTo(-t,L/2-t);boardCtx.lineTo(-Tw/2,L/2-t);boardCtx.closePath();boardCtx.fill();
      boardCtx.fillStyle='rgba(0,0,0,0.5)';boardCtx.beginPath();boardCtx.arc(0,-L/2+2,Math.max(1,t-1),0,Math.PI*2);boardCtx.fill();}
    boardCtx.restore();
  }

  function drawDice(value){
    const ctx=diceCtx, size=72, x=10,y=10;
    ctx.clearRect(0,0,92,92);
    ctx.fillStyle='rgba(0,0,0,0.15)';roundRectCtx(ctx,x+3,y+4,size,size,14);ctx.fill();
    ctx.fillStyle='#fff';roundRectCtx(ctx,x,y,size,size,14);ctx.fill();
    ctx.strokeStyle='#aaabaf';ctx.lineWidth=1.5;ctx.stroke();
    if(value>=1&&value<=6)drawDicePips(ctx,value,x,y,size);
    else{ctx.fillStyle='#bebec3';ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('?',x+size/2,y+size/2);}
  }
  function roundRectCtx(ctx,x,y,w,h,r){const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();}
  function drawDicePips(ctx,v,x,y,size){const pad=size/6,cell=(size-2*pad)/2,pip=size/9,ctrs=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)ctrs.push([x+pad+cell*j,y+pad+cell*i]);const layout=[[],[4],[0,8],[0,4,8],[0,2,6,8],[0,2,4,6,8],[0,2,3,5,6,8]];ctx.fillStyle='#222';for(const idx of layout[v]){const[px,py]=ctrs[idx];ctx.beginPath();ctx.arc(px,py,pip/2,0,Math.PI*2);ctx.fill();}}

  // ===================== 游戏逻辑 =====================
  function initState(){
    const seed=Date.now(), rng=mulberry32(seed);
    const colors=[0,1,2,3];
    for(let i=colors.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[colors[i],colors[j]]=[colors[j],colors[i]];}
    const players=['你','机器人1','机器人2','机器人3'];
    const colorMap=new Map();
    players.forEach((p,i)=>colorMap.set(p,colors[i]));
    const curIdx=Math.floor(rng()*players.length);
    return {
      players, colorMap, curIdx,
      pieces:Array.from({length:4},()=>new Int32Array(4).fill(HOME_CELL)),
      prog:Array.from({length:4},()=>new Int32Array(4).fill(HOME_CELL)),
      boardPieces:new Map(),
      lastDice:0, sixCount:0,
      waiting:false, movable:-1, animating:false,
      pulse:false, over:false,
      takeoff:new Set([6]),
      curColor:-1,
      forcedSix:false, graceTurns:3, graceTriggered:false,
    };
  }
  const myColor=()=>state.colorMap.get('你')??0;
  const curPlayer=()=>state.players[state.curIdx];
  const isMy=()=>!state.over&&curPlayer()==='你';
  const curPlayerColor=()=>state.over?-1:(state.colorMap.get(curPlayer())??-1);

  function myName(){return '你';}
  function allAtHome(c){for(let i=0;i<4;i++)if(state.pieces[c][i]!==HOME_CELL)return false;return true;}
  function hasHome(c){for(let i=0;i<4;i++)if(state.pieces[c][i]===HOME_CELL)return true;return false;}
  function checkWin(c){for(let i=0;i<4;i++)if(state.pieces[c][i]!==FINISH_CELL)return false;return true;}
  function posToKey(c,p){if(p>=TOTAL_PROGRESS)return FINISH_CELL;if(p<0)return HOME_CELL;if(p<EFFECTIVE_OUTER)return EFFECTIVE_PATH[c][p%EFFECTIVE_OUTER];const ri=p-EFFECTIVE_OUTER;if(ri<HOME_RUNWAY_CELLS)return HOME_RUNWAY_KEYS[c][ri];return FINISH_CELL;}
  function putPiece(c,i,k){if(k<0)return;if(!state.boardPieces.has(k))state.boardPieces.set(k,[]);state.boardPieces.get(k).push({color:c,idx:i});}
  function rmPiece(c,i,k){if(k<0)return;const cell=state.boardPieces.get(k);if(!cell)return;const j=cell.findIndex(p=>p.color===c&&p.idx===i);if(j>=0)cell.splice(j,1);}
  function checkCollision(cc,k){if(k<0)return;const cell=state.boardPieces.get(k);if(!cell||!cell.length)return;const v=cell.filter(p=>p.color!==cc);if(!v.length)return;for(const x of v){state.pieces[x.color][x.idx]=HOME_CELL;state.prog[x.color][x.idx]=HOME_CELL;}cell.splice(0,cell.length,...cell.filter(p=>p.color===cc));statusEl.textContent=`${COLOR_NAMES[cc]}色击落 ${v.map(x=>COLOR_NAMES[x.color]).join('、')}色 飞机！`;}
  function checkFlyCollision(fc){const[r,c,tc]=FLY_COLLISION[fc];const k=r*N+c;const cell=state.boardPieces.get(k);if(!cell||!cell.length)return;const v=cell.filter(p=>p.color===tc);if(!v.length)return;for(const x of v){state.pieces[x.color][x.idx]=HOME_CELL;state.prog[x.color][x.idx]=HOME_CELL;}cell.splice(0,cell.length,...cell.filter(p=>p.color!==tc));statusEl.textContent=`${COLOR_NAMES[fc]}色飞行撞回 ${COLOR_NAMES[tc]}色飞机！`;}

  async function rollFinal(finalDice){
    state.lastDice=finalDice;
    const color=myColor();
    if(state.lastDice===6)state.sixCount++;else state.sixCount=0;
    if(!state.takeoff.has(state.lastDice)&&allAtHome(color)){await endTurn();return;}
    const moves=getMoves(color);
    if(!moves.length){await endTurn();return;}
    state.waiting=true;state.movable=color;
    statusEl.textContent=`掷出 ${finalDice} 点，请点击要移动的棋子`;
    startPulse();drawBoard();
  }
  function getMoves(color){const m=[];for(let i=0;i<4;i++)if(state.pieces[color][i]>=0&&state.pieces[color][i]!==FINISH_CELL)m.push({color,idx:i,type:0});if(state.takeoff.has(state.lastDice))for(let i=0;i<4;i++)if(state.pieces[color][i]===HOME_CELL)m.push({color,idx:i,type:1});return m;}

  async function onPiece(c,i,home){
    if(!state.waiting||c!==state.movable||state.animating)return;
    state.waiting=false;state.animating=true;stopPulse();
    if(home)await takeOff(c,i);else await moveAnimated(c,i,state.lastDice);
    await afterMove(c);
  }
  async function afterMove(c){
    state.animating=false;
    if(checkWin(c)){gameOver(c);return;}
    if(state.sixCount>=3){sendHome(c);await endTurn();return;}
    if(state.lastDice===6){refresh();return;}
    await endTurn();
  }
  function sendHome(c){for(let i=0;i<4;i++)if(state.pieces[c][i]!==FINISH_CELL){const ok=state.pieces[c][i];if(ok>=0)rmPiece(c,i,ok);state.pieces[c][i]=HOME_CELL;state.prog[c][i]=HOME_CELL;}drawBoard();statusEl.textContent=`${COLOR_NAMES[c]}色连续3次6点，所有飞机返回机场！`;}
  async function takeOff(c,i){if(state.pieces[c][i]!==HOME_CELL)return;const sk=START_KEY[c];state.pieces[c][i]=sk;state.prog[c][i]=0;putPiece(c,i,sk);drawBoard();await sleep(300);checkCollision(c,sk);drawBoard();}
  async function moveAnimated(c,i,steps){
    const op=state.prog[c][i];if(op<0)return;
    const progs=[];let cur=op,rem=steps,bounced=false;
    while(rem>0&&cur<FINISH_PROGRESS){cur++;rem--;progs.push(cur);}
    while(rem>0){cur--;rem--;progs.push(cur);bounced=true;}
    await stepByStep(c,i,progs);
    const fk=state.pieces[c][i],fp=state.prog[c][i];
    if(fk!==FINISH_CELL&&fk>=0)checkCollision(c,fk);
    if(fp===FINISH_PROGRESS){rmPiece(c,i,fk);state.pieces[c][i]=FINISH_CELL;drawBoard();return;}
    if(bounced)return;
    await postCheck(c,i,false);
  }
  async function stepByStep(c,i,progs){
    for(const np of progs){const nk=posToKey(c,np),ok=state.pieces[c][i];rmPiece(c,i,ok);state.prog[c][i]=np;state.pieces[c][i]=nk;if(nk!==FINISH_CELL)putPiece(c,i,nk);drawBoard();await sleep(180);}
  }
  async function postCheck(c,i,afterJump){
    const p=state.prog[c][i];if(p>=EFFECTIVE_OUTER||p<0)return;
    if(p%EFFECTIVE_OUTER===FLY_FROM_STEP){await fly(c,i);if(!afterJump)await jump(c,i);}
    else if(!afterJump)await jump(c,i);
  }
  async function jump(c,i){
    const cp=state.prog[c][i];if(cp<0||cp>=EFFECTIVE_OUTER)return;const ck=state.pieces[c][i];if(ck<0)return;if(cellColorAtKey(ck)!==c)return;
    const ls=Math.floor(cp/EFFECTIVE_OUTER)*EFFECTIVE_OUTER,le=Math.min(ls+EFFECTIVE_OUTER,EFFECTIVE_OUTER);
    let np=-1;for(let p=cp+1;p<le;p++){const k=posToKey(c,p);if(cellColorAtKey(k)===c){np=p;break;}}
    if(np===-1)return;
    if(heteroBetween(c,cp,np))return;
    const progs=[];for(let p=cp+1;p<=np;p++)progs.push(p);
    await stepByStep(c,i,progs);
    const tk=state.pieces[c][i];if(tk>=0)checkCollision(c,tk);drawBoard();
    if(state.prog[c][i]%EFFECTIVE_OUTER===FLY_FROM_STEP)await fly(c,i);
  }
  async function fly(c,i){
    const fp=state.prog[c][i];const ls=Math.floor(fp/EFFECTIVE_OUTER)*EFFECTIVE_OUTER;const ft=ls+FLY_TO_STEP;if(fp===ft)return;
    const fk=state.pieces[c][i],tk=posToKey(c,ft);rmPiece(c,i,fk);drawBoard();await sleep(380);
    state.prog[c][i]=ft;state.pieces[c][i]=tk;putPiece(c,i,tk);checkCollision(c,tk);checkFlyCollision(c);drawBoard();await sleep(280);
  }
  function heteroBetween(c,from,to){for(let p=from+1;p<to;p++){const k=posToKey(c,p);const cell=state.boardPieces.get(k);if(!cell||cell.length<2)continue;const cs=new Set(cell.map(x=>x.color));if(cs.size>=2)return true;}return false;}

  async function endTurn(){state.sixCount=0;state.curIdx=(state.curIdx+1)%state.players.length;refresh();}
  function refresh(){
    state.curColor=curPlayerColor();
    playersEl.innerHTML='';
    for(let i=0;i<4;i++){
      let name='';for(const[n,col]of state.colorMap)if(col===i){name=n;break;}
      let fin=0;for(let p=0;p<4;p++)if(state.pieces[i][p]===FINISH_CELL)fin++;
      const li=document.createElement('div');
      li.className='ac-player'+(i===state.curColor?` active ${CLASS_NAMES[i]}`:'');
      li.innerHTML=`<span>${COLOR_NAMES[i]} ${name||'（空）'}</span><span>${fin}/4</span>`;
      playersEl.appendChild(li);
    }
    if(!state.over){const cur=curPlayer();statusEl.textContent=`当前回合：${cur}（${COLOR_NAMES[state.colorMap.get(cur)]}色）`;const can=isMy()&&!state.waiting&&!state.animating;diceCanvas.classList.toggle('can-roll',can);diceCanvas.style.cursor=can?'pointer':'default';}
    drawBoard();maybeBot();
  }
  function gameOver(winner){
    state.over=true;stopPulse();diceCanvas.classList.remove('can-roll');diceCanvas.style.cursor='default';
    let wn='';for(const[n,col]of state.colorMap)if(col===winner){wn=n;break;}
    statusEl.textContent=`${COLOR_NAMES[winner]}色 ${wn} 获胜！`;
  }
  function startPulse(){stopPulse();state.pulse=false;pulseTimer=setInterval(()=>{state.pulse=!state.pulse;drawBoard();},500);}
  function stopPulse(){if(pulseTimer){clearInterval(pulseTimer);pulseTimer=null;}}

  function isBot(n){return n&&n.startsWith('机器人');}
  async function maybeBot(){
    if(state.over||state.animating)return;
    const cur=curPlayer();if(!isBot(cur))return;
    await sleep(800);await botRoll();
  }
  async function botRoll(){
    if(state.over)return;const cur=curPlayer();if(!isBot(cur))return;
    const fd=rndInt(6)+1;const color=state.colorMap.get(cur);
    statusEl.textContent=`${COLOR_NAMES[color]}色机器人正在摇骰子…`;
    await animateDice(fd);
    state.lastDice=fd;if(fd===6)state.sixCount++;else state.sixCount=0;
    if(!state.takeoff.has(fd)&&allAtHome(color)){await endTurn();return;}
    if(state.takeoff.has(fd)&&hasHome(color)){
      let sm=false;for(let i=0;i<4;i++)if(state.pieces[color][i]>=0&&state.prog[color][i]>40){sm=true;break;}
      if(!sm){let hi=-1;for(let i=0;i<4;i++)if(state.pieces[color][i]===HOME_CELL){hi=i;break;}if(hi>=0){state.animating=true;await takeOff(color,hi);await afterMove(color);return;}await endTurn();return;}
    }
    state.animating=true;
    const mv=[];for(let i=0;i<4;i++)if(state.pieces[color][i]>=0)mv.push(i);
    if(!mv.length){state.animating=false;await endTurn();return;}
    let bi=mv[0];for(const i of mv)if(state.prog[color][i]>state.prog[color][bi])bi=i;
    await moveAnimated(color,bi,fd);await afterMove(color);
  }
  async function animateDice(fd){
    // 16 帧 × 80ms ≈ 1.28s，骰子滚动更清楚、更有手感
    for(let t=0;t<16;t++){drawDice(t===15?fd:rndInt(6)+1);await sleep(80);}
  }

  // 开局前3次：若未摇到6，则下次必为6；该保证仅生效一次且只在前3次内
  function humanRollValue(){
    if(state.forcedSix && !state.graceTriggered){
      state.forcedSix=false; state.graceTriggered=true;
      if(state.graceTurns>0)state.graceTurns--;
      return 6;
    }
    const fd=rndInt(6)+1;
    if(state.graceTurns>1 && fd!==6 && !state.graceTriggered) state.forcedSix=true;
    if(state.graceTurns>0)state.graceTurns--;
    return fd;
  }
  function rollHuman(){if(!isMy()||state.animating||state.waiting)return;const fd=humanRollValue();animateDice(fd).then(()=>rollFinal(fd));}
  function onClick(e){
    if(!state.waiting)return;const color=state.movable;if(color<0)return;
    const rect=boardCanvas.getBoundingClientRect();
    // 全程以 CSS 像素计算，避免 devicePixelRatio 造成的错位（多数手机 dpr=3 时旧算法会整体压缩点击坐标）
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    const boardPx=N*CELL_PX+PAD*2;
    const ox=(rect.width-boardPx*boardScale)/2+PAD*boardScale;
    const oy=(rect.height-boardPx*boardScale)/2+PAD*boardScale;
    const bx=mx-ox,by=my-oy;
    const col=Math.floor(bx/(CELL_PX*boardScale)),row=Math.floor(by/(CELL_PX*boardScale));
    // 1) 路径上的棋子
    if(bx>=0&&by>=0&&bx<N*CELL_PX*boardScale&&by<N*CELL_PX*boardScale){
      const k=row*N+col;const cell=state.boardPieces.get(k);
      if(cell)for(const p of cell)if(p.color===color){onPiece(color,p.idx,false);return;}
    }
    // 2) 基地起飞：以点击所在 3x3 方块判定，匹配实际绘制的基地范围
    if(state.takeoff.has(state.lastDice)&&hasHome(color)){
      const[sr,sc]=BASE_STARTS[color];
      if(row>=sr&&row<=sr+2&&col>=sc&&col<=sc+2){
        for(let i=0;i<4;i++)if(state.pieces[color][i]===HOME_CELL){onPiece(color,i,true);return;}
      }
    }
  }

  function onResize(){if(boardCanvas){resizeBoard();drawDice(state?state.lastDice:0);}}

  let ro=null;
  function observeSize(){
    if(!('ResizeObserver' in window) || !boardCanvas || !boardCanvas.parentElement) return;
    ro=new ResizeObserver(()=>{resizeBoard();drawDice(state?state.lastDice:0);});
    ro.observe(boardCanvas.parentElement);
  }

  const module={
    mount(c){
      buildDOM(c);
      state=initState();
      resizeBoard();
      // 部分浏览器 mount 时容器尚未完成 layout，延迟再算一次尺寸
      setTimeout(resizeBoard, 0);
      setTimeout(resizeBoard, 150);
      drawDice(0);
      diceCanvas.addEventListener('pointerdown',rollHuman);
      boardCanvas.addEventListener('pointerdown',onClick);
      window.addEventListener('resize',onResize);
      observeSize();
      refresh();
      // 布局稳定后再重绘一次，确保尺寸正确
      requestAnimationFrame(()=>{resizeBoard();drawDice(state?state.lastDice:0);drawBoard();});
    },
    unmount(){
      stopPulse();
      if(ro){ro.disconnect();ro=null;}
      if(boardCanvas)boardCanvas.removeEventListener('pointerdown',onClick);
      if(diceCanvas)diceCanvas.removeEventListener('pointerdown',rollHuman);
      window.removeEventListener('resize',onResize);
      if(root&&root.parentElement)root.parentElement.removeChild(root);
      container=null;boardCanvas=null;state=null;root=null;
    }
  };
  window.GameModules=window.GameModules||{};window.GameModules.aerochess=module;
})();
